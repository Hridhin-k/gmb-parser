import { lookup } from "node:dns/promises";
import { generateAi } from "@/lib/ai/service";
import {
  brandProfileSchema,
  brandProfilePrompt,
  isBlockedHostname,
  isPrivateAddress,
  htmlToText,
  normalizeBrandProfile,
  normalizeWebsiteUrl,
  pickSiteLinks,
  type BrandProfile,
  type SitePage,
} from "@/lib/brand-profile";
import { createAdminClient } from "@/lib/db/client";
import type { Database, Json } from "@/lib/types/database-schema";
import { getPool } from "@/lib/db/pool";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AuditService } from "@/lib/services/audit";
import { assertScoped } from "@/lib/services/access";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";

const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 400_000;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 4;
const KNOWN_THEME_LIMIT = 40;

async function assertPublicHost(url: URL): Promise<void> {
  if (isBlockedHostname(url.hostname)) throw new ValidationError("That address is not a public website.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = /^[\d.]+$|:/.test(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new ValidationError("We could not find that website. Check the address.");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ValidationError("That address is not a public website.");
  }
}

/** One page of HTML, or null. Every redirect hop is checked again; size and time are capped. */
async function fetchHtml(start: URL): Promise<{ html: string; url: URL } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: { "User-Agent": "RevuPilotBot/1.0 (brand profile)", Accept: "text/html" },
        cache: "no-store",
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      try {
        url = new URL(location, url);
      } catch {
        return null;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      continue;
    }
    if (!response.ok) return null;
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < PAGE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return { html: Buffer.concat(chunks).toString("utf8"), url };
  }
  return null;
}

/** The home page plus the few same-site pages that describe the business. */
export async function fetchSitePages(website: URL): Promise<SitePage[]> {
  const home = await fetchHtml(website);
  if (!home) throw new ValidationError("We could not read that website. Check the address, or write the profile yourself.");
  const pages: SitePage[] = [{ url: home.url.toString(), text: htmlToText(home.html) }];
  for (const link of pickSiteLinks(home.html, home.url, MAX_PAGES - 1)) {
    const page = await fetchHtml(link);
    if (page) pages.push({ url: page.url.toString(), text: htmlToText(page.html, 4000) });
  }
  const readable = pages.filter((page) => page.text.length >= 80);
  if (readable.length === 0) {
    throw new ValidationError("That website has no readable text (it may load its content with scripts). Write the profile yourself.");
  }
  return readable;
}

async function loadClient(workspaceId: string, clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_clients")
    .select("id, name, brand_name, website, notes")
    .eq("id", clientId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data || data.notes === UNASSIGNED_CLIENT_MARKER) {
    throw new AuthorizationError("That client is not in this organization.");
  }
  return data;
}

/** Reads the client's saved website, drafts a profile with the model, and returns it for review. Nothing is saved. */
export async function draftBrandProfile(input: {
  workspaceId: string;
  userId: string;
  clientId: string;
}): Promise<{ profile: BrandProfile; pages: string[] }> {
  await assertScoped({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: "manage_locations",
    target: { kind: "client", id: input.clientId },
  });
  const client = await loadClient(input.workspaceId, input.clientId);
  const website = client.website ? normalizeWebsiteUrl(client.website) : null;
  if (!website) throw new ValidationError("Save the business's website first, then build its profile.");

  return draftFromWebsite({ workspaceId: input.workspaceId, userId: input.userId, clientId: input.clientId, businessName: client.brand_name || client.name, website });
}

/** Reads a public website and has the model write a brand profile. Nothing is saved. */
export async function draftFromWebsite(input: {
  workspaceId: string;
  userId?: string;
  clientId?: string;
  businessName: string;
  website: URL;
}): Promise<{ profile: BrandProfile; pages: string[] }> {
  const pages = await fetchSitePages(input.website);
  const result = await generateAi({
    workspaceId: input.workspaceId,
    task: "insight",
    audit: { userId: input.userId, clientId: input.clientId },
    operation: "insight_brief",
    prompt: brandProfilePrompt(input.businessName, pages),
    schema: brandProfileSchema,
    temperature: 0.2,
    maxOutputTokens: 1500,
    timeoutMs: 60_000,
  });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    parsed = null;
  }
  const profile = normalizeBrandProfile(parsed);
  if (!profile) throw new AppError("The AI could not write a profile from that website. Try again, or write it yourself.", "AI_INVALID_RESPONSE", 502);
  logger.info("brand_profile.drafted", { workspaceId: input.workspaceId, pages: pages.length });
  return { profile, pages: pages.map((page) => page.url) };
}

export async function saveBrandProfile(input: {
  workspaceId: string;
  userId: string;
  clientId: string;
  profile: unknown;
  source: "website" | "manual";
}): Promise<BrandProfile | null> {
  await assertScoped({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: "manage_locations",
    target: { kind: "client", id: input.clientId },
  });
  await loadClient(input.workspaceId, input.clientId);
  const profile = normalizeBrandProfile(input.profile);
  const admin = createAdminClient();
  const { error } = await admin
    .from("grm_clients")
    .update({
      brand_profile: profile as unknown as Json | null,
      brand_profile_source: profile ? input.source : null,
      brand_profile_updated_at: profile ? new Date().toISOString() : null,
    })
    .eq("id", input.clientId)
    .eq("workspace_id", input.workspaceId);
  if (error) throw new AppError("Could not save the brand profile.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "client.brand_profile_saved",
    entityType: "grm_clients",
    entityId: input.clientId,
    metadata: { source: input.source, cleared: !profile },
  });
  return profile;
}

export interface ClientBrandContext {
  profile: BrandProfile | null;
  knownThemes: string[];
}

/** Brand profile and theme vocabulary per client, for the clients in one analysis batch group. */
export async function loadBrandContexts(
  workspaceId: string,
  clientIds: readonly string[]
): Promise<Map<string, ClientBrandContext>> {
  const contexts = new Map<string, ClientBrandContext>();
  const ids = [...new Set(clientIds)];
  if (ids.length === 0) return contexts;
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_clients")
    .select("id, brand_profile")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  for (const row of data ?? []) {
    contexts.set(row.id, { profile: normalizeBrandProfile(row.brand_profile), knownThemes: [] });
  }
  const themes = await getPool()
    .query<{ client_id: string; topic: string }>(
      `SELECT client_id, topic FROM (
         SELECT client_id, topic,
                row_number() OVER (PARTITION BY client_id ORDER BY count(*) DESC) AS rank
           FROM public.grm_review_observations
          WHERE workspace_id = $1 AND client_id = ANY($2::uuid[]) AND topic <> 'other'
          GROUP BY client_id, topic
       ) ranked
       WHERE rank <= $3`,
      [workspaceId, ids, KNOWN_THEME_LIMIT]
    )
    .then((result) => result.rows)
    .catch(() => []);
  for (const row of themes) {
    const context = contexts.get(row.client_id) ?? { profile: null, knownThemes: [] };
    context.knownThemes.push(row.topic);
    contexts.set(row.client_id, context);
  }
  return contexts;
}

/**
 * Copies the profile written during setup onto the business, when the workspace
 * has exactly one and it has no profile of its own. A workspace with several
 * businesses keeps each one's profile separate.
 */
export async function applySetupBrandToClient(workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  const [setup, clients] = await Promise.all([
    admin.from("grm_onboarding").select("website, brand_profile, brand_profile_source").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("grm_clients").select("id, website, brand_profile, notes").eq("workspace_id", workspaceId),
  ]);
  const real = (clients.data ?? []).filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER);
  if (!setup.data || real.length !== 1) return;
  const client = real[0];
  const profile = normalizeBrandProfile(setup.data.brand_profile);
  const patch: Database["public"]["Tables"]["grm_clients"]["Update"] = {};
  if (profile && !client.brand_profile) {
    patch.brand_profile = profile as unknown as Json;
    patch.brand_profile_source = setup.data.brand_profile_source === "website" ? "website" : "manual";
    patch.brand_profile_updated_at = new Date().toISOString();
  }
  if (setup.data.website && !client.website) patch.website = setup.data.website;
  if (Object.keys(patch).length === 0) return;
  await admin.from("grm_clients").update(patch).eq("id", client.id).eq("workspace_id", workspaceId);
}
