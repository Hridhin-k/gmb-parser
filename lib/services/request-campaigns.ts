import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit";
import { sendRequestMessage } from "@/lib/request-delivery";
import { renderQrPdf, qrSvg } from "@/lib/request-qr";
import { locationDisplayName } from "@/lib/ui/location-place";
import { googleReviewRequestUrl } from "@/lib/services/review-requests";
import { ValidationError } from "@/lib/errors";
import {
  COOLDOWN_DEFAULT,
  REQUEST_RETRY_LIMIT,
  REQUEST_RETRY_MS,
  classifyCustomers,
  customerPageModel,
  defaultTemplate,
  importCounts,
  isRequestLanguage,
  parseCustomerCsv,
  readRequestEnv,
  receiptCoverage,
  renderTemplate,
  requestChannelOptions,
  requestMetricCells,
  type ClassifiedCustomer,
  type ContactHistory,
  type MetricCell,
  type RequestChannel,
  type RequestChannelOption,
  type RequestLanguage,
} from "@/lib/review-requests";

function token(): string {
  return randomBytes(16).toString("base64url");
}

export function requestOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

interface BoardCampaign {
  id: string;
  name: string;
  channel: string;
  status: string;
  language: string;
  source: string;
  created_at: string;
  sent_at: string | null;
  reminder_enabled: boolean;
  preview_eligible: number;
  preview_suppressed: number;
  preview_opted_out: number;
  preview_missing_contact: number;
  preview_unknown_store: number;
  preview_duplicates: number;
  locations: number;
  location_ids: string[];
  sent: number;
  delivered: number;
  opened: number;
  failed: number;
  queued: number;
  unavailable: number;
  suppressed: number;
  last_error: string | null;
}

interface BoardQr {
  location_id: string;
  token: string;
  language: string;
  scans: number;
  feedback: number;
}

interface BoardPayload {
  sent: number;
  delivered: number;
  opened: number;
  message_clicks: number;
  scans: number;
  feedback: number;
  opted_out: number;
  campaigns: BoardCampaign[];
  qr: BoardQr[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  channel: RequestChannel;
  status: string;
  language: string;
  source: string;
  createdAt: string;
  sentAt: string | null;
  locations: number;
  locationIds: string[];
  sent: number;
  delivered: number;
  opened: number;
  failed: number;
  queued: number;
  unavailable: number;
  suppressed: number;
  lastError: string | null;
  preview: {
    eligible: number;
    suppressed: number;
    optedOut: number;
    missingContact: number;
    unknownStore: number;
    duplicates: number;
  };
}

export interface QrSummary {
  locationId: string;
  token: string;
  url: string;
  scans: number;
  feedback: number;
}

export interface RequestBoard {
  policyDays: number;
  channels: RequestChannelOption[];
  metrics: MetricCell[];
  campaigns: CampaignSummary[];
  qrByLocation: Map<string, QrSummary>;
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asBoard(value: unknown): BoardPayload {
  const row = (value ?? {}) as Partial<BoardPayload>;
  return {
    sent: asNumber(row.sent),
    delivered: asNumber(row.delivered),
    opened: asNumber(row.opened),
    message_clicks: asNumber(row.message_clicks),
    scans: asNumber(row.scans),
    feedback: asNumber(row.feedback),
    opted_out: asNumber(row.opted_out),
    campaigns: Array.isArray(row.campaigns) ? row.campaigns : [],
    qr: Array.isArray(row.qr) ? row.qr : [],
  };
}

async function policyDays(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_request_policies")
    .select("cooldown_days")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.cooldown_days ?? COOLDOWN_DEFAULT;
}

export async function loadRequestBoard(workspaceId: string): Promise<RequestBoard> {
  const admin = createAdminClient();
  const [policy, boardResult] = await Promise.all([
    policyDays(workspaceId),
    admin.rpc("grm_request_board", { p_workspace: workspaceId }),
  ]);
  if (boardResult.error) throw new Error(boardResult.error.message);
  const board = asBoard(boardResult.data);
  const env = readRequestEnv(process.env);
  const coverage = receiptCoverage(env);
  const origin = requestOrigin();
  const qrByLocation = new Map<string, QrSummary>();
  for (const item of board.qr) {
    qrByLocation.set(item.location_id, {
      locationId: item.location_id,
      token: item.token,
      url: `${origin}/r/${item.token}`,
      scans: asNumber(item.scans),
      feedback: asNumber(item.feedback),
    });
  }
  return {
    policyDays: policy,
    channels: requestChannelOptions(env),
    metrics: requestMetricCells({
      sent: board.sent,
      delivered: board.delivered,
      opened: board.opened,
      clicked: board.message_clicks + board.scans,
      feedback: board.feedback,
      optedOut: board.opted_out,
      deliveryReceipts: coverage.delivery,
      openReceipts: coverage.opens,
    }),
    campaigns: board.campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      channel: campaign.channel as RequestChannel,
      status: campaign.status,
      language: campaign.language,
      source: campaign.source,
      createdAt: campaign.created_at,
      sentAt: campaign.sent_at,
      locations: asNumber(campaign.locations),
      locationIds: Array.isArray(campaign.location_ids) ? campaign.location_ids : [],
      sent: asNumber(campaign.sent),
      delivered: asNumber(campaign.delivered),
      opened: asNumber(campaign.opened),
      failed: asNumber(campaign.failed),
      queued: asNumber(campaign.queued),
      unavailable: asNumber(campaign.unavailable),
      suppressed: asNumber(campaign.suppressed),
      lastError: campaign.last_error,
      preview: {
        eligible: asNumber(campaign.preview_eligible),
        suppressed: asNumber(campaign.preview_suppressed),
        optedOut: asNumber(campaign.preview_opted_out),
        missingContact: asNumber(campaign.preview_missing_contact),
        unknownStore: asNumber(campaign.preview_unknown_store),
        duplicates: asNumber(campaign.preview_duplicates),
      },
    })),
    qrByLocation,
  };
}

async function workspaceLocations(workspaceId: string, locationIds: string[]) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_google_locations")
    .select("id, location_title, store_code, address_formatted, place_id, client_id, grm_clients(name)")
    .eq("workspace_id", workspaceId)
    .in("id", locationIds);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function ensureQr(workspaceId: string, locationIds: string[], language: RequestLanguage | null) {
  const admin = createAdminClient();
  if (locationIds.length === 0) return;
  const { data: existing, error } = await admin
    .from("grm_request_qr")
    .select("location_id")
    .eq("workspace_id", workspaceId)
    .in("location_id", locationIds);
  if (error) throw new Error(error.message);
  const have = new Set((existing ?? []).map((row) => row.location_id));
  const missing = locationIds.filter((id) => !have.has(id));
  if (missing.length > 0) {
    const { error: insertError } = await admin.from("grm_request_qr").insert(
      missing.map((locationId) => ({
        workspace_id: workspaceId,
        location_id: locationId,
        token: token(),
        language: language ?? "en",
      }))
    );
    if (insertError) throw new Error(insertError.message);
  }
  if (!language) return;
  const { error: updateError } = await admin
    .from("grm_request_qr")
    .update({ language })
    .eq("workspace_id", workspaceId)
    .in("location_id", locationIds);
  if (updateError) throw new Error(updateError.message);
}

export async function ensureLocationQr(workspaceId: string, locationIds: string[]) {
  await ensureQr(workspaceId, locationIds, null);
}

async function historyFor(workspaceId: string, rows: ClassifiedCustomer[]): Promise<ContactHistory[]> {
  const admin = createAdminClient();
  const keys = [...new Set(rows.map((row) => row.key).filter((key): key is string => Boolean(key)))];
  const phones = [...new Set(rows.map((row) => row.phoneKey).filter((key): key is string => Boolean(key)))];
  if (keys.length === 0 && phones.length === 0) return [];
  const [byKey, byPhone] = await Promise.all([
    keys.length
      ? admin.from("grm_request_customers").select("id, dedupe_key, phone_key, email, opted_out_at").eq("workspace_id", workspaceId).in("dedupe_key", keys)
      : Promise.resolve({ data: [], error: null }),
    phones.length
      ? admin.from("grm_request_customers").select("id, dedupe_key, phone_key, email, opted_out_at").eq("workspace_id", workspaceId).in("phone_key", phones)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byKey.error) throw new Error(byKey.error.message);
  if (byPhone.error) throw new Error(byPhone.error.message);
  const customers = new Map<string, { id: string; dedupe_key: string; phone_key: string | null; email: string | null; opted_out_at: string | null }>();
  for (const row of [...(byKey.data ?? []), ...(byPhone.data ?? [])]) customers.set(row.id, row);
  const ids = [...customers.keys()];
  const accepted = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await admin
      .from("grm_request_messages")
      .select("customer_id, accepted_at")
      .in("customer_id", ids)
      .eq("is_test", false)
      .not("accepted_at", "is", null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.customer_id || !row.accepted_at) continue;
      const current = accepted.get(row.customer_id);
      if (!current || row.accepted_at > current) accepted.set(row.customer_id, row.accepted_at);
    }
  }
  return [...customers.values()].map((row) => ({
    key: row.dedupe_key,
    phoneKey: row.phone_key,
    email: row.email,
    acceptedAt: accepted.get(row.id) ?? null,
    optedOut: Boolean(row.opted_out_at),
  }));
}

async function upsertCustomers(workspaceId: string, rows: ClassifiedCustomer[]) {
  const admin = createAdminClient();
  const keep = rows.filter((row) => row.key && row.locationId && (row.outcome === "eligible" || row.outcome === "suppressed" || row.outcome === "opted_out"));
  const ids = new Map<string, string>();
  for (const row of keep) {
    const existing = await admin
      .from("grm_request_customers")
      .select("id, opted_out_at")
      .eq("workspace_id", workspaceId)
      .eq("dedupe_key", row.key!)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      const patch: { name: string; email: string | null; phone: string | null; phone_key: string | null; location_id: string | null; opted_out_at?: string } = {
        name: row.name,
        email: row.email,
        phone: row.phone,
        phone_key: row.phoneKey,
        location_id: row.locationId,
      };
      if (row.optedOut && !existing.data.opted_out_at) patch.opted_out_at = new Date().toISOString();
      const { error } = await admin.from("grm_request_customers").update(patch).eq("id", existing.data.id);
      if (error) throw new Error(error.message);
      ids.set(row.key!, existing.data.id);
    } else {
      const { data, error } = await admin
        .from("grm_request_customers")
        .insert({
          workspace_id: workspaceId,
          name: row.name,
          email: row.email,
          phone: row.phone,
          phone_key: row.phoneKey,
          location_id: row.locationId,
          dedupe_key: row.key!,
          opted_out_at: row.optedOut ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Could not save the customer.");
      ids.set(row.key!, data.id);
    }
  }
  return ids;
}

export async function saveRequestCampaign(
  workspaceId: string,
  userId: string,
  input: {
    name: string;
    channel: RequestChannel;
    language: RequestLanguage;
    template: string;
    reminder: boolean;
    locationIds: string[];
    csv?: string;
  }
): Promise<string> {
  const locations = await workspaceLocations(workspaceId, input.locationIds);
  if (locations.length === 0) throw new ValidationError("Choose a location in this workspace.");
  const locationIds = locations.map((location) => location.id);
  const channel = requestChannelOptions(readRequestEnv(process.env)).find((item) => item.id === input.channel);
  if (!channel?.available) throw new ValidationError(channel?.reason ?? "This channel is not available.");
  const template = input.template.trim() || (input.channel === "qr" ? "" : defaultTemplate(input.language));
  if (input.channel !== "qr" && !template.trim()) throw new ValidationError("Write the message customers will receive.");

  let classified: ClassifiedCustomer[] = [];
  if (input.channel !== "qr") {
    if (!input.csv?.trim()) throw new ValidationError("Upload a CSV of customers before sending.");
    const parsed = parseCustomerCsv(input.csv);
    const stores = locations.map((location) => ({ id: location.id, storeCode: location.store_code }));
    const draftRows = parsed.map((row) => ({ ...row, outcome: "eligible" as const, locationId: null }));
    const history = await historyFor(workspaceId, draftRows);
    classified = classifyCustomers(parsed, stores, history, new Date(), await policyDays(workspaceId), locationIds);
  }
  const counts = importCounts(classified);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_request_campaigns")
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      channel: input.channel,
      language: input.language,
      template,
      reminder_enabled: input.channel === "qr" ? false : input.reminder,
      source: input.channel === "qr" ? "qr" : "csv",
      status: "draft",
      created_by: userId,
      preview_eligible: counts.eligible,
      preview_suppressed: counts.suppressed,
      preview_opted_out: counts.optedOut,
      preview_missing_contact: counts.missingContact,
      preview_unknown_store: counts.unknownStore,
      preview_duplicates: counts.duplicates,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the campaign.");

  const { error: linkError } = await admin.from("grm_request_campaign_locations").insert(
    locationIds.map((locationId) => ({ campaign_id: data.id, location_id: locationId }))
  );
  if (linkError) throw new Error(linkError.message);

  if (input.channel === "qr") {
    await ensureQr(workspaceId, locationIds, input.language);
  } else {
    const ids = await upsertCustomers(workspaceId, classified);
    const recipients = classified
      .filter((row) => row.key && ids.has(row.key) && (row.outcome === "eligible" || row.outcome === "suppressed" || row.outcome === "opted_out"))
      .map((row) => ({
        campaign_id: data.id,
        customer_id: ids.get(row.key!)!,
        location_id: row.locationId,
        decision: row.outcome,
      }));
    if (recipients.length > 0) {
      const { error: recipientError } = await admin.from("grm_request_recipients").insert(recipients);
      if (recipientError) throw new Error(recipientError.message);
    }
  }

  await AuditService.log({
    workspaceId,
    userId,
    action: "request.saved",
    entityType: "request_campaign",
    entityId: data.id,
  });
  return data.id;
}

async function locationLabel(location: {
  location_title: string | null;
  store_code: string | null;
  address_formatted: string | null;
  grm_clients: { name: string } | { name: string }[] | null;
}): Promise<string> {
  const client = Array.isArray(location.grm_clients) ? location.grm_clients[0] : location.grm_clients;
  return locationDisplayName({
    title: location.location_title ?? "",
    brand: client?.name,
    storeCode: location.store_code,
    address: location.address_formatted,
  });
}

async function dispatchMessage(input: {
  workspaceId: string;
  messageId: string;
  channel: Exclude<RequestChannel, "qr">;
  to: string;
  body: string;
  attempts: number;
}) {
  const admin = createAdminClient();
  const env = readRequestEnv(process.env);
  const option = requestChannelOptions(env).find((item) => item.id === input.channel);
  const attempts = input.attempts + 1;
  if (!option?.available) {
    await admin
      .from("grm_request_messages")
      .update({
        status: "unavailable",
        attempts,
        retryable: false,
        error: option?.reason ?? "This channel is not available.",
      })
      .eq("id", input.messageId);
    return "unavailable" as const;
  }
  const callback =
    input.channel === "sms" ? `${requestOrigin()}/api/requests/hooks/twilio` : undefined;
  const result = await sendRequestMessage(env, {
    channel: input.channel,
    to: input.to,
    body: input.body,
    statusCallback: callback,
  });
  const retryable = result.retryable && attempts < REQUEST_RETRY_LIMIT;
  await admin
    .from("grm_request_messages")
    .update({
      status: result.delivered ? "delivered" : result.state === "accepted" ? "accepted" : "failed",
      attempts,
      retryable,
      provider_ref: result.providerRef,
      error: result.state === "failed" ? result.detail : null,
      accepted_at: result.state === "accepted" ? new Date().toISOString() : null,
      delivered_at: result.delivered ? new Date().toISOString() : null,
      next_attempt_at: retryable ? new Date(Date.now() + REQUEST_RETRY_MS).toISOString() : null,
    })
    .eq("id", input.messageId);
  if (result.state === "accepted") {
    await admin.from("grm_request_events").insert({
      workspace_id: input.workspaceId,
      message_id: input.messageId,
      kind: result.delivered ? "delivered" : "accepted",
      detail: result.detail,
    });
  }
  return result.state === "accepted" ? ("accepted" as const) : ("failed" as const);
}

export async function sendRequestCampaign(workspaceId: string, userId: string, campaignId: string) {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from("grm_request_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!campaign) throw new ValidationError("That campaign was not found.");
  if (campaign.status === "sent" || campaign.status === "ready" || campaign.status === "sending") {
    throw new ValidationError("This campaign has already been sent.");
  }
  const channel = campaign.channel as RequestChannel;
  const option = requestChannelOptions(readRequestEnv(process.env)).find((item) => item.id === channel);
  if (!option?.available) throw new ValidationError(option?.reason ?? "This channel is not available.");

  if (channel === "qr") {
    const { data: links } = await admin.from("grm_request_campaign_locations").select("location_id").eq("campaign_id", campaignId);
    await ensureQr(workspaceId, (links ?? []).map((link) => link.location_id), isRequestLanguage(campaign.language) ? campaign.language : "en");
    await admin.from("grm_request_campaigns").update({ status: "ready", sent_at: new Date().toISOString() }).eq("id", campaignId);
    await AuditService.log({ workspaceId, userId, action: "request.sent", entityType: "request_campaign", entityId: campaignId });
    return { accepted: 0, failed: 0, unavailable: 0 };
  }

  const { data: claimed, error: claimError } = await admin
    .from("grm_request_campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new ValidationError("This campaign has already been sent.");

  const { data: recipients, error: recipientError } = await admin
    .from("grm_request_recipients")
    .select("customer_id, location_id, decision, grm_request_customers(name, email, phone, opted_out_at)")
    .eq("campaign_id", campaignId);
  if (recipientError) throw new Error(recipientError.message);

  const locationIds = [...new Set((recipients ?? []).map((row) => row.location_id).filter((id): id is string => Boolean(id)))];
  const locations = locationIds.length ? await workspaceLocations(workspaceId, locationIds) : [];
  const labels = new Map<string, string>();
  for (const location of locations) labels.set(location.id, await locationLabel(location));

  let accepted = 0;
  let failed = 0;
  let unavailable = 0;
  const language = isRequestLanguage(campaign.language) ? campaign.language : "en";
  const origin = requestOrigin();

  for (const recipient of recipients ?? []) {
    const customer = Array.isArray(recipient.grm_request_customers)
      ? recipient.grm_request_customers[0]
      : recipient.grm_request_customers;
    if (!customer || recipient.decision !== "eligible" || customer.opted_out_at) continue;
    const to = channel === "email" ? customer.email : customer.phone;
    const messageToken = token();
    const { data: message, error: insertError } = await admin
      .from("grm_request_messages")
      .insert({
        workspace_id: workspaceId,
        campaign_id: campaignId,
        customer_id: recipient.customer_id,
        location_id: recipient.location_id,
        channel,
        token: messageToken,
        status: to ? "queued" : "failed",
        attempts: to ? 0 : 1,
        retryable: false,
        error: to ? null : channel === "email" ? "This customer has no email." : "This customer has no phone number.",
        queued_at: to ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (insertError || !message) {
      if (insertError?.code === "23505") continue;
      throw new Error(insertError?.message ?? "Could not record the message.");
    }
    if (!to) {
      failed += 1;
      continue;
    }
    const link = `${origin}/r/${messageToken}`;
    const body = renderTemplate(campaign.template, language, {
      name: customer.name,
      location: labels.get(recipient.location_id ?? "") ?? "your visit",
      link,
      optout: `${link}#stop`,
    });
    const result = await dispatchMessage({
      workspaceId,
      messageId: message.id,
      channel,
      to,
      body,
      attempts: 0,
    });
    if (result === "accepted") accepted += 1;
    else if (result === "unavailable") unavailable += 1;
    else failed += 1;
  }

  await admin
    .from("grm_request_campaigns")
    .update({ status: accepted > 0 ? "sent" : "failed", sent_at: new Date().toISOString() })
    .eq("id", campaignId);
  await AuditService.log({ workspaceId, userId, action: "request.sent", entityType: "request_campaign", entityId: campaignId });
  return { accepted, failed, unavailable };
}

export async function sendRequestTest(
  workspaceId: string,
  userId: string,
  userEmail: string | null,
  campaignId: string,
  input: { email?: string; phone?: string }
) {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from("grm_request_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!campaign) throw new ValidationError("That campaign was not found.");
  const channel = campaign.channel as RequestChannel;
  if (channel === "qr") throw new ValidationError("A QR code is not a message. Open the preview on the location’s code.");
  const option = requestChannelOptions(readRequestEnv(process.env)).find((item) => item.id === channel);
  if (!option?.available) throw new ValidationError(option?.reason ?? "This channel is not available.");
  const to = channel === "email" ? (input.email ?? userEmail ?? "") : (input.phone ?? "");
  if (!to) throw new ValidationError(channel === "email" ? "Choose an email for the test." : "Enter a phone number for the test.");
  if (channel === "email" && to.toLowerCase() !== (userEmail ?? "").toLowerCase()) {
    throw new ValidationError("A test email goes to the address you are signed in with.");
  }
  const { data: link } = await admin.from("grm_request_campaign_locations").select("location_id").eq("campaign_id", campaignId).limit(1).maybeSingle();
  const locations = link ? await workspaceLocations(workspaceId, [link.location_id]) : [];
  const label = locations[0] ? await locationLabel(locations[0]) : "your visit";
  const messageToken = token();
  const language = isRequestLanguage(campaign.language) ? campaign.language : "en";
  const page = `${requestOrigin()}/r/${messageToken}`;
  const { data: message, error: insertError } = await admin
    .from("grm_request_messages")
    .insert({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      location_id: link?.location_id ?? null,
      channel,
      token: messageToken,
      status: "queued",
      is_test: true,
      queued_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError || !message) throw new Error(insertError?.message ?? "Could not record the test.");
  const result = await dispatchMessage({
    workspaceId,
    messageId: message.id,
    channel,
    to,
    body: renderTemplate(campaign.template || defaultTemplate(language), language, {
      name: "there",
      location: label,
      link: page,
      optout: `${page}#stop`,
    }),
    attempts: 0,
  });
  await AuditService.log({ workspaceId, userId, action: "request.tested", entityType: "request_campaign", entityId: campaignId });
  if (result !== "accepted") throw new ValidationError("The test was not accepted by the provider. The outcome is on this campaign.");
}

export async function removeRequestCampaign(workspaceId: string, userId: string, campaignId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("grm_request_campaigns").delete().eq("id", campaignId).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  await AuditService.log({ workspaceId, userId, action: "request.deleted", entityType: "request_campaign", entityId: campaignId });
}

export async function saveRequestPolicy(workspaceId: string, userId: string, cooldownDays: number) {
  const admin = createAdminClient();
  const { error } = await admin.from("grm_request_policies").upsert({
    workspace_id: workspaceId,
    cooldown_days: cooldownDays,
  });
  if (error) throw new Error(error.message);
  await AuditService.log({
    workspaceId,
    userId,
    action: "request.policy_updated",
    entityType: "request_policy",
    entityId: workspaceId,
    metadata: { cooldownDays },
  });
}

export interface PublicRequest {
  token: string;
  language: string;
  locationName: string;
  googleUrl: string | null;
  model: ReturnType<typeof customerPageModel>;
  stopped: boolean;
}

async function loadPublic(tokenValue: string) {
  const admin = createAdminClient();
  const message = await admin
    .from("grm_request_messages")
    .select("id, workspace_id, location_id, customer_id, campaign_id, clicked_at, grm_request_campaigns(language)")
    .eq("token", tokenValue)
    .maybeSingle();
  if (message.error) throw new Error(message.error.message);
  if (message.data) {
    const campaign = Array.isArray(message.data.grm_request_campaigns)
      ? message.data.grm_request_campaigns[0]
      : message.data.grm_request_campaigns;
    return { kind: "message" as const, row: message.data, language: campaign?.language ?? "en" };
  }
  const qr = await admin
    .from("grm_request_qr")
    .select("id, workspace_id, location_id, language")
    .eq("token", tokenValue)
    .maybeSingle();
  if (qr.error) throw new Error(qr.error.message);
  if (!qr.data) return null;
  return { kind: "qr" as const, row: qr.data, language: qr.data.language };
}

export async function openPublicRequest(tokenValue: string): Promise<PublicRequest | null> {
  const found = await loadPublic(tokenValue);
  if (!found || !found.row.location_id) return null;
  const admin = createAdminClient();
  const { data: location, error } = await admin
    .from("grm_google_locations")
    .select("location_title, store_code, address_formatted, place_id, grm_clients(name)")
    .eq("id", found.row.location_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!location) return null;
  const locationName = await locationLabel(location);
  const placeId = location.place_id?.trim() || null;
  const language = isRequestLanguage(found.language) ? found.language : "en";
  if (found.kind === "message") {
    if (!found.row.clicked_at) {
      await admin.from("grm_request_messages").update({ clicked_at: new Date().toISOString() }).eq("id", found.row.id).is("clicked_at", null);
    }
    await admin.from("grm_request_events").insert({
      workspace_id: found.row.workspace_id,
      message_id: found.row.id,
      kind: "clicked",
    });
  } else {
    await admin.from("grm_request_events").insert({
      workspace_id: found.row.workspace_id,
      qr_id: found.row.id,
      kind: "scan",
    });
  }
  return {
    token: tokenValue,
    language,
    locationName,
    googleUrl: placeId ? googleReviewRequestUrl(placeId) : null,
    model: customerPageModel(language, locationName, placeId ? googleReviewRequestUrl(placeId) : null),
    stopped: false,
  };
}

export async function publicGoogleUrl(tokenValue: string): Promise<string | null> {
  const found = await loadPublic(tokenValue);
  if (!found?.row.location_id) return null;
  const admin = createAdminClient();
  const { data: location } = await admin.from("grm_google_locations").select("place_id").eq("id", found.row.location_id).maybeSingle();
  const placeId = location?.place_id?.trim();
  if (!placeId) return null;
  if (found.kind === "message") {
    await admin.from("grm_request_messages").update({ google_clicked_at: new Date().toISOString() }).eq("id", found.row.id).is("google_clicked_at", null);
    await admin.from("grm_request_events").insert({ workspace_id: found.row.workspace_id, message_id: found.row.id, kind: "google_click" });
  } else {
    await admin.from("grm_request_events").insert({ workspace_id: found.row.workspace_id, qr_id: found.row.id, kind: "google_click" });
  }
  return googleReviewRequestUrl(placeId);
}

export async function savePublicFeedback(tokenValue: string, body: string) {
  const found = await loadPublic(tokenValue);
  if (!found) throw new ValidationError("This request link is not valid.");
  const admin = createAdminClient();
  const { error } = await admin.from("grm_request_feedback").insert({
    workspace_id: found.row.workspace_id,
    location_id: found.row.location_id,
    message_id: found.kind === "message" ? found.row.id : null,
    qr_id: found.kind === "qr" ? found.row.id : null,
    body,
  });
  if (error?.code === "23505") return;
  if (error) throw new Error(error.message);
  await admin.from("grm_request_events").insert({
    workspace_id: found.row.workspace_id,
    message_id: found.kind === "message" ? found.row.id : null,
    qr_id: found.kind === "qr" ? found.row.id : null,
    kind: "feedback",
  });
}

export async function optOutPublic(tokenValue: string): Promise<boolean> {
  const found = await loadPublic(tokenValue);
  if (!found) throw new ValidationError("This request link is not valid.");
  if (found.kind !== "message" || !("customer_id" in found.row) || !found.row.customer_id) return false;
  const admin = createAdminClient();
  await admin.from("grm_request_customers").update({ opted_out_at: new Date().toISOString() }).eq("id", found.row.customer_id).is("opted_out_at", null);
  await admin.from("grm_request_events").insert({
    workspace_id: found.row.workspace_id,
    message_id: found.row.id,
    kind: "opted_out",
  });
  return true;
}

export async function qrDownload(
  workspaceId: string,
  format: "svg" | "pdf",
  locationId: string | null,
  locationIds: string[] | null = null
) {
  const admin = createAdminClient();
  let query = admin
    .from("grm_request_qr")
    .select("token, location_id, grm_google_locations(location_title, store_code, address_formatted, grm_clients(name))")
    .eq("workspace_id", workspaceId);
  if (locationId) query = query.eq("location_id", locationId);
  if (locationIds) query = query.in("location_id", locationIds.length ? locationIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const cards = await Promise.all(
    (data ?? []).map(async (row) => {
      const location = Array.isArray(row.grm_google_locations) ? row.grm_google_locations[0] : row.grm_google_locations;
      const title = location ? await locationLabel(location) : "Location";
      return { title, url: `${requestOrigin()}/r/${row.token}` };
    })
  );
  if (cards.length === 0) throw new ValidationError("No QR code is ready for that location.");
  if (format === "svg") {
    if (cards.length !== 1) throw new ValidationError("Choose one location to download an SVG.");
    return { body: qrSvg(cards[0].url), contentType: "image/svg+xml", filename: "review-qr.svg" };
  }
  return {
    body: Buffer.from(renderQrPdf(cards)),
    contentType: "application/pdf",
    filename: cards.length === 1 ? "review-qr.pdf" : "review-qr-cards.pdf",
  };
}

export async function applyProviderReceipt(providerRef: string, kind: "delivered" | "opened" | "failed", detail: string) {
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("grm_request_messages")
    .select("id, workspace_id")
    .eq("provider_ref", providerRef)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!message) return;
  if (kind === "delivered") {
    await admin.from("grm_request_messages").update({ status: "delivered", delivered_at: new Date().toISOString(), retryable: false }).eq("id", message.id);
  } else if (kind === "opened") {
    await admin.from("grm_request_messages").update({ opened_at: new Date().toISOString() }).eq("id", message.id);
  } else {
    await admin.from("grm_request_messages").update({ status: "failed", retryable: false, error: detail }).eq("id", message.id);
  }
  await admin.from("grm_request_events").insert({
    workspace_id: message.workspace_id,
    message_id: message.id,
    kind: kind === "failed" ? "failed" : kind,
    detail,
  });
}

export async function runRequestJobs(now = new Date()): Promise<{ retried: number; reminded: number }> {
  const admin = createAdminClient();
  const env = readRequestEnv(process.env);
  const { data: due, error } = await admin
    .from("grm_request_messages")
    .select("id, workspace_id, channel, attempts, customer_id, location_id, campaign_id, token, grm_request_customers(email, phone, name)")
    .in("status", ["failed", "queued"])
    .eq("retryable", true)
    .lte("next_attempt_at", now.toISOString())
    .lt("attempts", REQUEST_RETRY_LIMIT)
    .limit(40);
  if (error) throw new Error(error.message);
  let retried = 0;
  for (const message of due ?? []) {
    const customer = Array.isArray(message.grm_request_customers) ? message.grm_request_customers[0] : message.grm_request_customers;
    const channel = message.channel as Exclude<RequestChannel, "qr">;
    const to = channel === "email" ? customer?.email : customer?.phone;
    if (!to || !message.campaign_id) continue;
    const { data: campaign } = await admin.from("grm_request_campaigns").select("template, language").eq("id", message.campaign_id).maybeSingle();
    if (!campaign) continue;
    const locations = message.location_id ? await workspaceLocations(message.workspace_id, [message.location_id]) : [];
    const label = locations[0] ? await locationLabel(locations[0]) : "your visit";
    const language = isRequestLanguage(campaign.language) ? campaign.language : "en";
    const link = `${requestOrigin()}/r/${message.token}`;
    const option = requestChannelOptions(env).find((item) => item.id === channel);
    if (!option?.available) continue;
    await dispatchMessage({
      workspaceId: message.workspace_id,
      messageId: message.id,
      channel,
      to,
      body: renderTemplate(campaign.template, language, {
        name: customer?.name ?? "",
        location: label,
        link,
        optout: `${link}#stop`,
      }),
      attempts: message.attempts,
    });
    retried += 1;
  }

  const { data: campaigns, error: campaignError } = await admin
    .from("grm_request_campaigns")
    .select("id, workspace_id, channel, language, template, reminder_after_days")
    .eq("reminder_enabled", true)
    .eq("status", "sent")
    .limit(20);
  if (campaignError) throw new Error(campaignError.message);
  let reminded = 0;
  for (const campaign of campaigns ?? []) {
    const cutoff = new Date(now.getTime() - campaign.reminder_after_days * 24 * 60 * 60 * 1000).toISOString();
    const { data: messages } = await admin
      .from("grm_request_messages")
      .select("id, token, location_id, customer_id, grm_request_customers(name, email, phone, opted_out_at)")
      .eq("campaign_id", campaign.id)
      .eq("is_test", false)
      .eq("is_reminder", false)
      .in("status", ["accepted", "delivered"])
      .is("clicked_at", null)
      .is("google_clicked_at", null)
      .lt("accepted_at", cutoff)
      .limit(20);
    for (const message of messages ?? []) {
      const customer = Array.isArray(message.grm_request_customers) ? message.grm_request_customers[0] : message.grm_request_customers;
      if (!customer || customer.opted_out_at) continue;
      const channel = campaign.channel as Exclude<RequestChannel, "qr">;
      const to = channel === "email" ? customer.email : customer.phone;
      if (!to) continue;
      const { data: existing } = await admin.from("grm_request_messages").select("id").eq("reminder_of", message.id).maybeSingle();
      if (existing) continue;
      const reminderToken = token();
      const { data: reminder, error: reminderError } = await admin
        .from("grm_request_messages")
        .insert({
          workspace_id: campaign.workspace_id,
          campaign_id: campaign.id,
          customer_id: message.customer_id,
          location_id: message.location_id,
          channel,
          token: reminderToken,
          status: "queued",
          is_reminder: true,
          reminder_of: message.id,
          queued_at: now.toISOString(),
        })
        .select("id")
        .single();
      if (reminderError?.code === "23505" || !reminder) continue;
      const locations = message.location_id ? await workspaceLocations(campaign.workspace_id, [message.location_id]) : [];
      const label = locations[0] ? await locationLabel(locations[0]) : "your visit";
      const language = isRequestLanguage(campaign.language) ? campaign.language : "en";
      const link = `${requestOrigin()}/r/${reminderToken}`;
      await dispatchMessage({
        workspaceId: campaign.workspace_id,
        messageId: reminder.id,
        channel,
        to,
        body: renderTemplate(campaign.template, language, {
          name: customer.name,
          location: label,
          link,
          optout: `${link}#stop`,
        }),
        attempts: 0,
      });
      reminded += 1;
    }
  }
  return { retried, reminded };
}
