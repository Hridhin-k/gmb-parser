import type { Json } from "@/lib/types/supabase";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import { readScopeRequest } from "@/lib/scope";
import { parseDateRange, type DateRange } from "@/lib/date-range";
import {
  extractGeminiText,
  GEMINI_FAST_MODEL_ID,
  GEMINI_THINKING_MINIMAL,
  classifyGeminiError,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { SUMMARY_DEFAULT_TIMEZONE, summaryWindow, windowContains, type SummaryWindow } from "@/lib/intelligence/summary-window";
import { authorizeSummaryScope, SummaryAccessError, type AuthorizedSummaryScope } from "@/lib/intelligence/summary-scope";
import type { SummaryDocument, SummaryReview } from "@/lib/intelligence/summary-aggregate";
import {
  INSIGHT_ANALYSIS_VERSION,
  INSIGHT_PROMPT_VERSION,
  applyModelProse,
  claimsMatch,
  discoverFindings,
  evidenceExcerpt,
  planInsightWrite,
  type InsightClusterRef,
  type InsightFinding,
  type InsightReportDraft,
  type InsightReview,
  type StoredInsight,
} from "@/lib/intelligence/insight";
import { excerptSupportsClaim } from "@/lib/intelligence/claim-support";
import { commitIsCurrent, freshnessLabel, FRESHNESS_HEADLINES, type FreshnessLabel } from "@/lib/intelligence/freshness";
import { loadSummaryReviews, saveScopedSummary } from "@/lib/services/summary-service";
import { loadAuthorisedTenantBundle } from "@/lib/services/ai-config";
import { insightContextBlock, presentTopics, topicExtensionsFromKnowledge } from "@/lib/intelligence/tenant-context";
import { usageFromResponse } from "@/lib/services/intelligence-extract";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";
import {
  briefAllowedNumbers,
  briefClaimsClean,
  briefNumbersAllowed,
  deterministicBrief,
  validateSynthesis,
  type ReportBrief,
  type ReportSynthesisItem,
} from "@/lib/intelligence/brief";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { parseStoredDeepDive, type FindingDeepDive } from "@/lib/intelligence/deep-dive";

type Admin = ReturnType<typeof createAdminClient>;

export interface InsightGenerationResult {
  status: "ready" | "processing";
  reused: boolean;
  reportId: string | null;
  version: number;
  insufficient: boolean;
  insufficientReason: string | null;
}

export interface InsightEvidenceView {
  reviewId: string | null;
  excerpt: string | null;
  href: string | null;
  removed: boolean;
}

export interface InsightFindingView {
  key: string;
  title: string;
  explanation: string;
  category: string;
  whyItMatters: string;
  action: string | null;
  quality: string;
  confidence: string;
  hypothesis: boolean;
  evidenceCount: number;
  sampleSize: number;
  metrics: InsightFinding["metrics"];
  reviewIds: string[];
  locationIds: string[];
  topicCodes: string[];
  clusterIds: string[];
  escalationHref: string | null;
  evidence: InsightEvidenceView[];
}

export interface InsightBoard {
  unavailable: string | null;
  notice: string | null;
  freshness: {
    label: FreshnessLabel;
    headline: string;
    detail: string;
    generatedAt: string | null;
    period: string | null;
    labelledStale: boolean;
  } | null;
  narrative: string | null;
  report: {
    id: string;
    version: number;
    generatedAt: string | null;
    rangeLabel: string;
    configVersion: number | null;
    rulesHash: string | null;
    insufficient: boolean;
    insufficientReason: string | null;
    issueCounts: Array<{ label: string; count: number }>;
    brief: ReportBrief | null;
    synthesis: ReportSynthesisItem[];
    deepDives: Record<string, FindingDeepDive>;
    findings: InsightFindingView[];
  } | null;
}

function toInsightReview(workspaceId: string, review: SummaryReview): InsightReview {
  return {
    id: review.id,
    workspaceId,
    locationId: review.locationId,
    createdAt: review.createdAt ?? "",
    stars: review.stars,
    overall: review.overall,
    issues: review.issues,
    praise: review.praise,
    excerpts: review.excerpts,
    aspects: review.aspects ?? [],
    staffMentions: review.staffMentions ?? [],
    requests: review.requests ?? [],
    clusterIds: review.clusterIds ?? [],
    severe: review.severe === true,
  };
}

async function loadClusterRefs(admin: Admin, workspaceId: string, reviews: readonly InsightReview[]): Promise<InsightClusterRef[]> {
  const ids = [...new Set(reviews.flatMap((review) => review.clusterIds))].slice(0, 100);
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("grm_semantic_clusters")
    .select("id, title, topic_key, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .in("id", ids);
  if (error || !data) return [];
  return data.map((cluster) => ({
    id: cluster.id,
    title: cluster.title,
    topicKey: cluster.topic_key,
    reviewIds: reviews.filter((review) => review.clusterIds.includes(cluster.id)).map((review) => review.id),
  }));
}

async function snapshotsAgree(admin: Admin, workspaceId: string, summaryId: string, document: SummaryDocument): Promise<boolean> {
  const { data: definitions, error } = await admin
    .from("grm_metric_definitions")
    .select("id, metric_key")
    .is("workspace_id", null)
    .in("metric_key", ["review_count", "average_rating"]);
  if (error || !definitions || definitions.length === 0) return true;
  const { data: snapshots, error: snapError } = await admin
    .from("grm_metric_snapshots")
    .select("definition_id, value")
    .eq("workspace_id", workspaceId)
    .eq("summary_id", summaryId);
  if (snapError || !snapshots || snapshots.length === 0) return true;
  const keys = new Map(definitions.map((row) => [row.id, row.metric_key]));
  for (const row of snapshots) {
    const key = keys.get(row.definition_id);
    if (key === "review_count" && row.value !== document.coverage.reviewCount) return false;
    if (key === "average_rating") {
      const live = document.metrics.averageRating;
      if (row.value === null || live === null) {
        if (row.value !== live) return false;
      } else if (Math.abs(row.value - live) > 0.0001) return false;
    }
  }
  return true;
}

type FindingProse = { title?: string; explanation?: string; whyItMatters?: string; action?: string | null };

/**
 * One model call rewrites every finding in the report. Allowed numbers are
 * listed per finding, and applyModelProse still discards any rewrite that
 * invents a number, so a bad batch entry costs wording, not correctness.
 */
function proseBatchPrompt(
  items: Array<{ finding: InsightFinding; excerpts: readonly string[] }>,
  document: SummaryDocument,
  tenantBlock = ""
): string {
  const sections = items.map(({ finding, excerpts }) => {
    const numbers = finding.metrics.flatMap((item) => (item.value === null ? [String(item.sampleSize)] : [String(item.value), String(item.sampleSize)]));
    numbers.push(String(finding.evidenceCount), String(finding.sampleSize));
    return [
      `Finding key: ${finding.key}`,
      `You may use only these numbers for this finding: ${[...new Set(numbers)].join(", ")}.`,
      `Title: ${finding.title}`,
      `Explanation: ${finding.explanation}`,
      `Why it matters: ${finding.whyItMatters}`,
      `Action: ${finding.action ?? ""}`,
      ...finding.metrics.map((item) => `${item.key}=${item.value ?? "null"} (${item.definition})`),
      ...excerpts.map((excerpt) => `Quotation: ${excerpt}`),
    ].join("\n");
  });
  const briefFacts = [
    "Brief facts. The brief may use only these numbers:",
    `reviews counted=${document.coverage.reviewCount}, extracted reviews=${document.coverage.extractedCount}, outlets with reviews in this window=${document.locations.filter((row) => row.reviewCount > 0).length} (when the brief says how many outlets the reviews cover, use exactly this figure), average rating=${document.metrics.averageRating?.toFixed(2) ?? "n/a"}, 1-3 star share percent=${document.metrics.negativeShare === null ? "n/a" : Math.round(document.metrics.negativeShare * 100)}`,
    `Most praised: ${document.praise.slice(0, 5).map((row) => `${row.label} (${row.reviews} reviews)`).join(", ") || "none recorded"}`,
    `Most mentioned issues: ${document.issues.slice(0, 5).map((row) => `${row.label} (${row.reviews} reviews)`).join(", ") || "none recorded"}`,
    "Also write \"brief\": a 3-5 sentence leadership summary of this scope and window. Lead with complaints and low ratings. Then up to 4 risks (issue patterns) and up to 4 highlights (praise patterns), using only the brief facts and finding numbers above. Keep a complaint in risks even when the same topic is also praised. Write each risk as \"Label — complaints in N reviews\" and each highlight as \"Label — praised in N reviews\". Skip the bucket topic Other.",
    "Also write \"synthesis\": up to 5 executive conclusions. Put complaints, low ratings, weak outlets, and staff named in unhappy reviews first. Praise is secondary. Each names one real pattern in plain words (title), explains what the evidence shows and why it matters (summary, 2-3 sentences), gives one concrete next step (action), and lists the finding keys it rests on (keys). Prefer conclusions that connect findings — a drag plus the requests behind it, a named person plus the outlet on their reviews, one weak outlet plus its phrase. Use only numbers from the cited findings or the brief facts. If the findings are thin, return fewer items or an empty list.",
  ];
  return [
    tenantBlock,
    "Use only this organisation's notes. Do not introduce another brand's rules or examples.",
    "Rewrite each finding in plain sentences.",
    "Do not add a count, a percentage, or a rating beyond the numbers listed for that finding.",
    "Do not say a change is statistically significant.",
    "Do not say an action will improve or raise the rating.",
    "Do not say the topic caused the rating.",
    "Reviewer names are not included. Do not invent any.",
    "Keep every sentence already inside quotation marks. Do not replace it with a paraphrase.",
    "Keep each complaint topic separate. Praise of a different topic in the same review stays separate.",
    "A finding about one review is a visit to investigate. Do not dismiss it for being rare.",
    "When a finding says no complaint quotation is stored, do not assign those reviews a topic.",
    'Return JSON: {"brief":{"summary":"","highlights":[""],"risks":[""]},"synthesis":[{"title":"","summary":"","action":"","keys":[""]}],"findings":[{"key":"","title":"","explanation":"","whyItMatters":"","action":""}]}',
    "",
    briefFacts.join("\n"),
    "",
    sections.join("\n\n"),
  ].join("\n");
}

async function requestInsightProseBatch(
  admin: Admin,
  workspaceId: string,
  items: Array<{ finding: InsightFinding; excerpts: readonly string[] }>,
  document: SummaryDocument,
  tenantBlock = ""
): Promise<{ prose: Map<string, FindingProse>; brief: ReportBrief | null; synthesis: ReportSynthesisItem[] }> {
  const out = new Map<string, FindingProse>();
  const empty = { prose: out, brief: null, synthesis: [] as ReportSynthesisItem[] };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || items.length === 0) return empty;
  const budget = await getAiBudget(admin, workspaceId);
  if (budget.exceeded) {
    logger.info("intelligence.insight_prose_budget_skip", { workspaceId, spentUsd: budget.spentUsd });
    return empty;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(geminiGenerateUrl(apiKey, GEMINI_FAST_MODEL_ID), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: proseBatchPrompt(items, document, tenantBlock) }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: GEMINI_THINKING_MINIMAL,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      logGeminiFailure("intelligence.insight_prose_failed", response.status, body);
      const classified = classifyGeminiError(response.status, body);
      throw new Error(`${classified.type}: ${classified.message}`);
    }
    const data = await response.json();
    const usage = usageFromResponse(data);
    await recordAiUsage(admin, {
      workspaceId,
      operation: "insight_prose",
      model: GEMINI_FAST_MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    const { text } = extractGeminiText(data);
    if (!text) return empty;
    const parsed = JSON.parse(text) as {
      findings?: Array<FindingProse & { key?: string }>;
      brief?: { summary?: unknown; highlights?: unknown; risks?: unknown };
      synthesis?: unknown;
    };
    for (const item of parsed.findings ?? []) {
      if (typeof item?.key === "string") out.set(item.key, item);
    }
    // The brief is wording over the same summary facts. Any number that is
    // not in the allowed set (or a banned claim) discards the model brief;
    // the deterministic brief is used instead.
    let brief: ReportBrief | null = null;
    const rawBrief = parsed.brief;
    if (rawBrief && typeof rawBrief.summary === "string" && rawBrief.summary.trim()) {
      const lines = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 240)).slice(0, 4)
          : [];
      const candidate: ReportBrief = {
        summary: rawBrief.summary.trim().slice(0, 1200),
        highlights: lines(rawBrief.highlights),
        risks: lines(rawBrief.risks),
        model: GEMINI_FAST_MODEL_ID,
      };
      const allowed = [
        ...briefAllowedNumbers(document),
        ...items.flatMap(({ finding }) => [
          finding.evidenceCount,
          finding.sampleSize,
          ...finding.metrics.flatMap((metric) => [metric.value ?? Number.NaN, metric.sampleSize]),
        ]),
      ].filter(Number.isFinite);
      const texts = [candidate.summary, ...candidate.highlights, ...candidate.risks];
      if (texts.every((line) => briefClaimsClean(line)) && briefNumbersAllowed(texts, allowed)) {
        brief = candidate;
      } else {
        logger.warn("intelligence.insight_brief_discarded", { workspaceId });
      }
    }
    // Synthesis items survive only when every cited key exists and every
    // number comes from a cited finding or the brief facts.
    const synthesis = validateSynthesis(parsed.synthesis, items.map((item) => item.finding), document);
    return { prose: out, brief, synthesis };
  } catch (error) {
    logger.warn("intelligence.insight_prose_skipped", {
      message: error instanceof Error ? error.message : "insight prose skipped",
    });
    return empty;
  } finally {
    clearTimeout(timeout);
  }
}

async function interpretFindings(
  findings: InsightFinding[],
  input: Parameters<typeof claimsMatch>[1],
  document: SummaryDocument,
  tenantBlock = "",
  admin?: Admin,
  workspaceId?: string
): Promise<{ findings: InsightFinding[]; brief: ReportBrief | null; synthesis: ReportSynthesisItem[] }> {
  // The single prose call sees the deepest findings first and is capped,
  // so prompt size (and cost) stays bounded however many findings exist.
  const DEEP_FIRST = ["rating_drag", "location_drag", "rare_severe", "recurring_issue", "emerging_topic", "fan_friction", "anomaly", "staff_mention", "customer_request", "micro_topic"];
  const complaintWeight = (finding: InsightFinding) => finding.metrics.find((item) => item.key === "staff_complaint_reviews")?.value ?? 0;
  const prioritised = [...findings].sort((a, b) => {
    const rank = (category: string) => {
      const index = DEEP_FIRST.indexOf(category);
      return index === -1 ? DEEP_FIRST.length : index;
    };
    return rank(a.category) - rank(b.category) || complaintWeight(b) - complaintWeight(a) || b.evidenceCount - a.evidenceCount;
  });
  const items = prioritised.slice(0, 16).map((finding) => ({
    finding,
    excerpts: finding.reviewIds.flatMap((id) => {
      const review = input.reviews.find((item) => item.id === id);
      const texts = [
        ...(review?.excerpts ?? []).map((excerpt) => excerpt.text),
        ...(review?.requests ?? []),
      ];
      return texts.slice(0, 2).map((text) => text.replace(/\s+/g, " ").trim().slice(0, 180));
    }).filter(Boolean).slice(0, 6),
  }));
  const { prose, brief, synthesis } =
    admin && workspaceId
      ? await requestInsightProseBatch(admin, workspaceId, items, document, tenantBlock)
      : { prose: new Map<string, FindingProse>(), brief: null, synthesis: [] as ReportSynthesisItem[] };
  const next: InsightFinding[] = [];
  for (const finding of findings) {
    const draft = prose.get(finding.key);
    let applied = draft ? applyModelProse(finding, draft, GEMINI_FAST_MODEL_ID) : finding;
    const requiredQuotes = [...finding.explanation.matchAll(/“([^”]{12,})”/g)].map((match) => match[1]);
    if (requiredQuotes.some((quote) => !applied.explanation.includes(quote))) {
      applied = { ...applied, explanation: finding.explanation, action: finding.action };
    }
    if (claimsMatch(applied, input)) next.push(applied);
  }
  return { findings: next, brief, synthesis };
}

async function openReportJob(admin: Admin, workspaceId: string, sourceHash: string): Promise<boolean> {
  const { data, error } = await admin
    .from("grm_intelligence_jobs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("operation", "build_report")
    .eq("source_hash", sourceHash)
    .in("status", ["queued", "running"])
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

async function existingReports(admin: Admin, workspaceId: string, summaryId: string): Promise<StoredInsight[]> {
  const { data, error } = await admin
    .from("grm_insight_reports")
    .select("id, source_hash, report_version, status, findings")
    .eq("workspace_id", workspaceId)
    .eq("summary_id", summaryId)
    .eq("prompt_version", INSIGHT_PROMPT_VERSION);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    sourceHash: row.source_hash,
    version: row.report_version,
    status: row.status === "ready" || row.status === "failed" || row.status === "stale" ? row.status : "pending",
    findings: [],
  }));
}

function inputKey(scope: AuthorizedSummaryScope, window: SummaryWindow): string {
  return [
    scope.scopeType,
    scope.scopeId,
    window.kind,
    window.start ?? "",
    window.end ?? "",
    window.comparison?.start ?? "",
    window.comparison?.end ?? "",
    INSIGHT_ANALYSIS_VERSION,
  ].join("|");
}

async function persistReport(
  admin: Admin,
  scope: AuthorizedSummaryScope,
  summaryId: string,
  document: SummaryDocument,
  draft: InsightReportDraft,
  reviews: readonly InsightReview[],
  version: number,
  provenance: { configVersion: number; rulesHash: string },
  brief: ReportBrief,
  synthesis: ReportSynthesisItem[] = []
): Promise<string> {
  const now = new Date().toISOString();
  const { data: report, error } = await admin
    .from("grm_insight_reports")
    .insert({
      workspace_id: scope.workspaceId,
      summary_id: summaryId,
      prompt_version: INSIGHT_PROMPT_VERSION,
      model: draft.findings.some((finding) => finding.model !== "none") ? GEMINI_FAST_MODEL_ID : "none",
      status: "pending",
      findings: draft.findings as unknown as Json,
      recommendations: draft.recommendations as unknown as Json,
      metrics: {
        reviewCount: document.coverage.reviewCount,
        averageRating: document.metrics.averageRating,
        negativeShare: document.metrics.negativeShare,
        insufficient: draft.insufficient,
        insufficientReason: draft.insufficientReason,
        brief: brief as unknown as Json,
        synthesis: synthesis as unknown as Json,
        summarySourceHash: document.sourceHash,
        configVersion: provenance.configVersion,
        rulesHash: provenance.rulesHash,
      } as Json,
      generated_at: now,
      source_hash: draft.sourceHash,
      report_version: version,
      input_key: inputKey(scope, document.range),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const byId = new Map(reviews.map((review) => [review.id, review]));
  const evidence = draft.findings.flatMap((finding) =>
    finding.reviewIds.map((reviewId) => {
      const review = byId.get(reviewId);
      const excerpt = evidenceExcerpt(review?.excerpts ?? [], finding.topicCodes, finding.category);
      return {
        workspace_id: scope.workspaceId,
        report_id: report.id,
        finding_key: finding.key,
        review_id: reviewId,
        excerpt,
      };
    })
  );
  if (evidence.length > 0) {
    const { error: evidenceError } = await admin.from("grm_insight_evidence").insert(evidence);
    if (evidenceError) {
      await admin
        .from("grm_insight_reports")
        .update({ status: "failed" })
        .eq("id", report.id)
        .eq("workspace_id", scope.workspaceId);
      throw new Error(evidenceError.message);
    }
  }
  const { error: readyError } = await admin
    .from("grm_insight_reports")
    .update({ status: "ready", generated_at: now })
    .eq("id", report.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("status", "pending");
  if (readyError) throw new Error(readyError.message);
  return report.id;
}

export async function generateInsightReport(
  admin: Admin,
  input: {
    userId: string;
    workspaceId: string;
    clientId?: string | null;
    groupId?: string | null;
    locationId?: string | null;
    range: DateRange;
    force?: boolean;
  }
): Promise<InsightGenerationResult> {
  const catalog = await loadScopeCatalog(input.userId, input.workspaceId);
  if (!catalog) throw new SummaryAccessError();
  const scope = authorizeSummaryScope(
    catalog,
    readScopeRequest({ client: input.clientId, group: input.groupId, location: input.locationId })
  );
  const window = summaryWindow(input.range, SUMMARY_DEFAULT_TIMEZONE);
  const loaded = await loadSummaryReviews(admin, scope.workspaceId, scope.locationIds);
  const summary = await saveScopedSummary(admin, scope, window, loaded, loaded);
  if (summary.status !== "ready" || !summary.document || !summary.summaryId) {
    return { status: "processing", reused: true, reportId: null, version: 0, insufficient: false, insufficientReason: null };
  }
  const all = loaded.map((review) => toInsightReview(scope.workspaceId, review));
  const reviews = all.filter((review) => windowContains(window, review.createdAt || null));
  const previous = window.comparison
    ? all.filter((review) => windowContains({ kind: "bounded", start: window.comparison?.start ?? null, end: window.comparison?.end ?? null }, review.createdAt || null))
    : [];
  const clusters = await loadClusterRefs(admin, scope.workspaceId, reviews);
  const insightInput = {
    workspaceId: scope.workspaceId,
    clientId: scope.clientId,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    locationIds: scope.locationIds,
    window,
    summary: summary.document,
    reviews,
    previousReviews: previous,
    clusters,
  };
  let draft = discoverFindings(insightInput);
  if (!(await snapshotsAgree(admin, scope.workspaceId, summary.summaryId, summary.document))) {
    draft = {
      ...draft,
      insufficient: true,
      insufficientReason: "Stored metrics do not match this summary, so no finding is reported.",
      findings: [],
      recommendations: [],
    };
  }
  const tenant = await loadAuthorisedTenantBundle(scope.workspaceId, {
    workspaceId: scope.workspaceId,
    clientId: scope.clientId,
    groupId: scope.groupId,
    parentGroupId: scope.parentGroupId,
    locationId: scope.locationId,
  }).catch(() => null);
  const tenantBlock = tenant
    ? insightContextBlock({
        reviewCount: summary.document.coverage.reviewCount,
        priorities: [tenant.knowledge.find((row) => row.kind === "instruction")?.body ?? ""].filter(Boolean),
        policies: [],
        labels: presentTopics(
          [...new Set(draft.findings.flatMap((finding) => finding.topicCodes))],
          topicExtensionsFromKnowledge(tenant.knowledge)
        ),
      })
    : "";
  // One generation produces both the findings and the leadership brief.
  // The brief is written from the same summary document, never from raw
  // reviews, and falls back to deterministic wording when the model brief
  // is unavailable, over budget, or invents a number.
  let brief: ReportBrief = deterministicBrief(summary.document);
  let synthesis: ReportSynthesisItem[] = [];
  if (draft.findings.length > 0 && !draft.insufficient) {
    const interpreted = await interpretFindings(draft.findings, insightInput, summary.document, tenantBlock, admin, scope.workspaceId);
    if (interpreted.brief) brief = interpreted.brief;
    synthesis = interpreted.synthesis;
    draft = interpreted.findings.length > 0
      ? { ...draft, findings: interpreted.findings, recommendations: interpreted.findings.filter((finding) => finding.action).map((finding) => ({ findingKey: finding.key, action: finding.action as string })) }
      : { ...draft, insufficient: true, insufficientReason: "The reviews in this window do not meet the evidence rules for a finding.", findings: [], recommendations: [] };
  }
  const stored = await existingReports(admin, scope.workspaceId, summary.summaryId);
  const open = await openReportJob(admin, scope.workspaceId, draft.sourceHash);
  const plan = planInsightWrite(stored, draft.sourceHash, input.force === true, open);
  if (plan.action === "processing") {
    return { status: "processing", reused: true, reportId: null, version: 0, insufficient: draft.insufficient, insufficientReason: draft.insufficientReason };
  }
  if (plan.action === "reuse" && plan.id) {
    return { status: "ready", reused: true, reportId: plan.id, version: plan.version, insufficient: draft.insufficient, insufficientReason: draft.insufficientReason };
  }
  const { data: job, error: jobError } = await admin
    .from("grm_intelligence_jobs")
    .insert({
      workspace_id: scope.workspaceId,
      operation: "build_report",
      status: "running",
      summary_id: summary.summaryId,
      source_hash: draft.sourceHash,
      analysis_version: INSIGHT_ANALYSIS_VERSION,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobError) {
    if (jobError.code === "23505") {
      return { status: "processing", reused: true, reportId: null, version: 0, insufficient: draft.insufficient, insufficientReason: draft.insufficientReason };
    }
    throw new Error(jobError.message);
  }
  try {
    const { data: liveSummary, error: liveError } = await admin
      .from("grm_scope_summaries")
      .select("source_hash")
      .eq("id", summary.summaryId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (liveError) throw new Error(liveError.message);
    if (
      !liveSummary ||
      !commitIsCurrent(
        { sourceHash: summary.document.sourceHash, analysisVersion: "summary-v1" },
        { sourceHash: liveSummary.source_hash, analysisVersion: "summary-v1" }
      )
    ) {
      await admin
        .from("grm_intelligence_jobs")
        .update({ status: "cancelled", finished_at: new Date().toISOString(), last_error: "Superseded by a newer summary", error_class: null })
        .eq("id", job.id)
        .eq("workspace_id", scope.workspaceId);
      return { status: "processing", reused: true, reportId: null, version: 0, insufficient: draft.insufficient, insufficientReason: draft.insufficientReason };
    }
    const reportId = await persistReport(admin, scope, summary.summaryId, summary.document, draft, reviews, plan.version, {
      configVersion: tenant?.version ?? 0,
      rulesHash: tenant?.rulesHash ?? "",
    }, brief, synthesis);
    const { error } = await admin
      .from("grm_intelligence_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), last_error: null, error_class: null })
      .eq("id", job.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
    return { status: "ready", reused: false, reportId, version: plan.version, insufficient: draft.insufficient, insufficientReason: draft.insufficientReason };
  } catch (error) {
    const message = error instanceof Error ? error.message : "insight report failed";
    await admin
      .from("grm_intelligence_jobs")
      .update({ status: "failed", error_class: "unknown", last_error: message.slice(0, 500), finished_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("workspace_id", scope.workspaceId);
    throw error;
  }
}

function parseStoredBrief(value: unknown): ReportBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { summary?: unknown; highlights?: unknown; risks?: unknown; model?: unknown };
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  const lines = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4)
      : [];
  return {
    summary: raw.summary,
    highlights: lines(raw.highlights),
    risks: lines(raw.risks),
    model: typeof raw.model === "string" ? raw.model : "none",
  };
}

/** Stored synthesis is re-checked against the findings actually shown. */
function parseStoredSynthesis(value: unknown, findings: readonly InsightFinding[]): ReportSynthesisItem[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set(findings.map((finding) => finding.key));
  const out: ReportSynthesisItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { title?: unknown; summary?: unknown; action?: unknown; keys?: unknown };
    if (typeof raw.title !== "string" || typeof raw.summary !== "string") continue;
    const cited = (Array.isArray(raw.keys) ? raw.keys : []).filter((key): key is string => typeof key === "string" && keys.has(key));
    if (cited.length === 0) continue;
    out.push({
      title: raw.title,
      summary: raw.summary,
      action: typeof raw.action === "string" ? raw.action : "",
      keys: [...new Set(cited)],
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** Stored deep dives, kept only for findings actually shown. */
function parseStoredDeepDives(value: unknown, findings: readonly InsightFinding[]): Record<string, FindingDeepDive> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const keys = new Set(findings.map((finding) => finding.key));
  const out: Record<string, FindingDeepDive> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!keys.has(key)) continue;
    const parsed = parseStoredDeepDive(raw);
    if (parsed) out[key] = parsed;
  }
  return out;
}

function asRecord(value: Json): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const COMPLAINT_CATEGORIES = new Set([
  "rating_drag",
  "location_drag",
  "rare_severe",
  "recurring_issue",
  "emerging_topic",
  "fan_friction",
  "anomaly",
  "trend",
  "location_comparison",
]);

function countedComplaints(document: unknown): {
  issues: Array<{ code: string; label: string; count: number }>;
  reviewIds: Map<string, string[]>;
  sampleSize: number;
} {
  const empty = { issues: [], reviewIds: new Map<string, string[]>(), sampleSize: 0 };
  if (!document || typeof document !== "object" || Array.isArray(document)) return empty;
  const record = document as {
    coverage?: { reviewCount?: number };
    issues?: Array<{ code?: string; label?: string; reviews?: number }>;
    evidence?: Array<{ reviewId?: string; topicCode?: string; polarity?: string }>;
  };
  const issues = (record.issues ?? []).flatMap((row) => {
    if (!row.code || !row.label || typeof row.reviews !== "number" || row.reviews <= 0) return [];
    if (row.label.toLowerCase() === "other" || row.code === "other") return [];
    return [{ code: row.code, label: row.label, count: row.reviews }];
  });
  const reviewIds = new Map<string, string[]>();
  for (const item of record.evidence ?? []) {
    if (!item.reviewId || !item.topicCode || item.polarity !== "complaint") continue;
    const list = reviewIds.get(item.topicCode) ?? [];
    if (!list.includes(item.reviewId)) list.push(item.reviewId);
    reviewIds.set(item.topicCode, list);
  }
  return { issues, reviewIds, sampleSize: record.coverage?.reviewCount ?? 0 };
}

/** Complaint counts already stored on the summary, shown when the report never made a finding for them. */
function complaintsMissingFrom(
  findings: readonly InsightFindingView[],
  counted: ReturnType<typeof countedComplaints>,
): InsightFindingView[] {
  const covered = new Set(
    findings.filter((finding) => COMPLAINT_CATEGORIES.has(finding.category)).flatMap((finding) => finding.topicCodes),
  );
  return counted.issues
    .filter((row) => !covered.has(row.code) && (counted.reviewIds.get(row.code)?.length ?? 0) > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8)
    .map((row) => {
      const reviewIds = (counted.reviewIds.get(row.code) ?? []).slice(0, 25);
      const quality = row.count >= 3 ? "supported" : "hypothesis";
      return {
        key: `complaint-count:${row.code}`,
        title: `${row.label} complaints in this window`,
        explanation: `${row.count.toLocaleString("en-US")} reviews in this window complain about ${row.label}. Praise of the same topic is counted separately and is not subtracted.`,
        category: "recurring_issue",
        whyItMatters: "These reviews name this complaint in their own words.",
        action: "Read the cited reviews before deciding what to change.",
        quality,
        confidence: row.count >= 3 ? "high" : row.count >= 2 ? "medium" : "low",
        hypothesis: quality === "hypothesis",
        evidenceCount: row.count,
        sampleSize: counted.sampleSize,
        metrics: [],
        reviewIds,
        locationIds: [],
        topicCodes: [row.code],
        clusterIds: [],
        escalationHref: null,
        evidence: reviewIds.map((reviewId) => ({
          reviewId,
          excerpt: null,
          href: `/reviews?review=${reviewId}`,
          removed: false,
        })),
      };
    });
}

export async function loadInsightBoard(
  admin: Admin,
  input: {
    userId: string;
    workspaceId: string;
    clientId?: string | null;
    groupId?: string | null;
    locationId?: string | null;
    range: DateRange;
  }
): Promise<InsightBoard> {
  try {
    const catalog = await loadScopeCatalog(input.userId, input.workspaceId);
    if (!catalog) return { unavailable: "This scope is not available to the signed-in member.", notice: null, freshness: null, narrative: null, report: null };
    const scope = authorizeSummaryScope(
      catalog,
      readScopeRequest({ client: input.clientId, group: input.groupId, location: input.locationId })
    );
    const window = summaryWindow(input.range, SUMMARY_DEFAULT_TIMEZONE);
    let lookup = admin
      .from("grm_scope_summaries")
      .select("id, status, source_hash, range_label, summary, document")
      .eq("workspace_id", scope.workspaceId)
      .eq("scope_type", scope.scopeType)
      .eq("scope_id", scope.scopeId)
      .eq("range_kind", window.kind)
      .eq("timezone", window.timezone)
      .eq("analysis_version", "summary-v1")
      .eq("membership_hash", scope.membershipHash);
    lookup = window.kind === "all" || !window.start || !window.end
      ? lookup.is("range_start", null).is("range_end", null)
      : lookup.eq("range_start", window.start).eq("range_end", window.end);
    const { data: summary, error } = await lookup.maybeSingle();
    if (error) return { unavailable: "Insight reports are not available in this workspace yet.", notice: null, freshness: null, narrative: null, report: null };
    if (!summary) {
      return { unavailable: null, notice: "No insight report is saved for this scope yet.", freshness: null, narrative: null, report: null };
    }
    const { data: reports, error: reportError } = await admin
      .from("grm_insight_reports")
      .select("id, status, findings, metrics, generated_at, report_version, source_hash, prompt_version")
      .eq("workspace_id", scope.workspaceId)
      .eq("summary_id", summary.id)
      .eq("prompt_version", INSIGHT_PROMPT_VERSION)
      .order("report_version", { ascending: false })
      .limit(5);
    if (reportError) return { unavailable: "Insight reports are not available in this workspace yet.", notice: null, freshness: null, narrative: null, report: null };
    const newest = reports?.[0];
    if (!newest) {
      const waiting = summary.status === "stale" || summary.status === "pending";
      return {
        unavailable: null,
        notice: waiting ? "A refresh is pending for this scope." : "No insight report is saved for this scope yet.",
        freshness: waiting
          ? {
              label: "refresh_pending",
              headline: FRESHNESS_HEADLINES.refresh_pending,
              detail: "No completed report is stored for this window.",
              generatedAt: null,
              period: summary.range_label || window.label,
              labelledStale: false,
            }
          : summary.status === "failed"
            ? {
                label: "failed",
                headline: FRESHNESS_HEADLINES.failed,
                detail: "The last summary refresh failed.",
                generatedAt: null,
                period: summary.range_label || window.label,
                labelledStale: false,
              }
            : null,
        narrative: summary.summary || null,
        report: null,
      };
    }
    const { data: openJobs } = await admin
      .from("grm_intelligence_jobs")
      .select("status")
      .eq("workspace_id", scope.workspaceId)
      .eq("summary_id", summary.id)
      .in("operation", ["build_summary", "build_report"])
      .in("status", ["queued", "running"])
      .limit(5);
    const openJob = (openJobs ?? []).some((job) => job.status === "running")
      ? "running"
      : (openJobs ?? []).some((job) => job.status === "queued")
        ? "queued"
        : "none";
    const metrics = asRecord(newest.metrics);
    const summarySourceHash = typeof metrics?.summarySourceHash === "string" ? metrics.summarySourceHash : null;
    const reportStatus = newest.status === "ready" || newest.status === "stale" || newest.status === "failed" || newest.status === "pending"
      ? newest.status
      : "pending";
    const matches = summary.status === "ready" && reportStatus === "ready" && (!summarySourceHash || summarySourceHash === summary.source_hash);
    const insufficient = metrics?.insufficient === true;
    const view = freshnessLabel({
      summaryStatus: summary.status === "ready" || summary.status === "stale" || summary.status === "pending" || summary.status === "failed" ? summary.status : "pending",
      reportStatus,
      reportMatchesSummary: matches,
      openJob,
      insufficient,
      metricsMatch: matches,
      clustersCurrent: matches,
      hasCompletedReport: reportStatus === "ready" || reportStatus === "stale",
    });
    const rawFindings = Array.isArray(newest.findings) ? newest.findings : [];
    const findings = rawFindings.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const parsed = item as InsightFinding;
      if (!parsed.key || !parsed.title) return [];
      return [parsed];
    });
    const evidenceByFinding = new Map<string, InsightEvidenceView[]>();
    const showReport =
      view.label === "current" ||
      view.label === "insufficient_data" ||
      view.label === "partially_updated" ||
      view.showPrevious;
    const freshness = {
      label: view.label,
      headline: FRESHNESS_HEADLINES[view.label],
      detail: view.showPrevious
        ? "This is the last completed report. It is not current."
        : view.label === "processing"
          ? "A newer report is being written."
          : view.label === "refresh_pending"
            ? "A refresh is queued. This report is not current."
            : view.label === "insufficient_data"
              ? "The window does not have enough reviews for a finding."
              : view.label === "partially_updated"
                ? "Rating counts are current. Cluster-backed findings are still refreshing."
                : view.label === "failed"
                  ? "The last refresh failed."
                  : `Last successful analysis ${newest.generated_at ? formatFriendlyDateTime(newest.generated_at) : "time unavailable"}.`,
      generatedAt: newest.generated_at,
      period: summary.range_label || window.label,
      labelledStale: view.showPrevious,
    };
    if (!showReport) {
      return { unavailable: null, notice: null, freshness, narrative: summary.summary || null, report: null };
    }
    const counted = countedComplaints(summary.document);
    const mappedFindings = findings.map((finding) => ({
      key: finding.key,
      title: finding.title,
      explanation: finding.explanation,
      category: finding.category,
      whyItMatters: finding.whyItMatters,
      action: finding.action,
      quality: finding.quality,
      confidence: finding.confidence,
      hypothesis: finding.hypothesis === true || finding.quality === "hypothesis",
      evidenceCount: finding.evidenceCount,
      sampleSize: finding.sampleSize,
      metrics: Array.isArray(finding.metrics) ? finding.metrics : [],
      reviewIds: Array.isArray(finding.reviewIds) ? finding.reviewIds : [],
      locationIds: Array.isArray(finding.locationIds) ? finding.locationIds : [],
      topicCodes: Array.isArray(finding.topicCodes) ? finding.topicCodes : [],
      clusterIds: Array.isArray(finding.clusterIds) ? finding.clusterIds : [],
      escalationHref: finding.links?.escalationHref ?? null,
      evidence: evidenceByFinding.get(finding.key) ?? (Array.isArray(finding.reviewIds) ? finding.reviewIds : []).map((reviewId) => ({
        reviewId,
        excerpt: null,
        href: `/reviews?review=${reviewId}`,
        removed: false,
      })),
    }));
    const complaintFindings = complaintsMissingFrom(mappedFindings, counted);
    return {
      unavailable: null,
      notice: null,
      freshness,
      narrative: summary.summary || null,
      report: {
        id: newest.id,
        version: newest.report_version,
        generatedAt: newest.generated_at,
        rangeLabel: summary.range_label || window.label,
        configVersion: typeof metrics?.configVersion === "number" ? metrics.configVersion : null,
        rulesHash: typeof metrics?.rulesHash === "string" ? metrics.rulesHash : null,
        insufficient: metrics?.insufficient === true || findings.length === 0,
        insufficientReason: typeof metrics?.insufficientReason === "string" ? metrics.insufficientReason : null,
        issueCounts: counted.issues.map((row) => ({ label: row.label, count: row.count })),
        brief: parseStoredBrief(metrics?.brief),
        synthesis: parseStoredSynthesis(metrics?.synthesis, findings),
        deepDives: parseStoredDeepDives(metrics?.deepDives, findings),
        findings: [...mappedFindings, ...complaintFindings],
      },
    };
  } catch (error) {
    if (error instanceof SummaryAccessError) {
      return { unavailable: error.message, notice: null, freshness: null, narrative: null, report: null };
    }
    logger.warn("intelligence.insight_board_failed", { message: error instanceof Error ? error.message : "insight board" });
    return { unavailable: "Insight reports are not available in this workspace yet.", notice: null, freshness: null, narrative: null, report: null };
  }
}

export function insightRangeFromParams(params: { range?: unknown; from?: unknown; to?: unknown }): DateRange {
  return parseDateRange(params, "12m");
}

export interface FindingEvidenceRow {
  reviewId: string;
  excerpt: string | null;
  stars: number | null;
  createdAt: string | null;
  locationId: string;
  locationTitle: string;
  href: string;
  topics: string[];
}

/** One page of reviews for a finding, limited to locations the caller already authorised. */
export async function loadFindingEvidence(
  admin: Admin,
  input: {
    workspaceId: string;
    reportId: string;
    findingKey: string;
    locationIds: readonly string[];
    topicCodes: readonly string[];
    category: string;
    reviewIds: readonly string[];
    page: number;
  }
): Promise<{ rows: FindingEvidenceRow[]; total: number; pageSize: number; unavailable: string | null }> {
  const pageSize = 8;
  if (input.locationIds.length === 0) return { rows: [], total: 0, pageSize, unavailable: null };
  const { data, error } = await admin
    .from("grm_insight_evidence")
    .select("review_id, excerpt")
    .eq("workspace_id", input.workspaceId)
    .eq("report_id", input.reportId)
    .eq("finding_key", input.findingKey)
    .limit(200);
  if (error) return { rows: [], total: 0, pageSize, unavailable: "Supporting reviews could not be loaded." };
  const storedIds = [...new Set((data ?? []).map((row) => row.review_id).filter((id): id is string => Boolean(id)))];
  const ids = storedIds.length > 0 ? storedIds : [...input.reviewIds];
  if (ids.length === 0) return { rows: [], total: 0, pageSize, unavailable: null };
  const { data: reviews, error: reviewError } = await admin
    .from("grm_reviews")
    .select("id, star_rating, review_create_time, location_id")
    .eq("workspace_id", input.workspaceId)
    .in("id", ids)
    .in("location_id", [...input.locationIds]);
  if (reviewError) return { rows: [], total: 0, pageSize, unavailable: "Supporting reviews could not be loaded." };
  const allowed = new Map((reviews ?? []).map((review) => [review.id, review]));
  const locationIds = [...new Set((reviews ?? []).map((review) => review.location_id))];
  const { data: locations } = locationIds.length
    ? await admin.from("grm_google_locations").select("id, location_title").eq("workspace_id", input.workspaceId).in("id", locationIds)
    : { data: [] as Array<{ id: string; location_title: string | null }> };
  const titles = new Map((locations ?? []).map((location) => [location.id, location.location_title || "Location"]));
  const { data: intelligence } = await admin
    .from("grm_review_intelligence")
    .select("review_id, extraction")
    .eq("workspace_id", input.workspaceId)
    .eq("is_current", true)
    .in("review_id", [...allowed.keys()]);
  const topics = new Map<string, string[]>();
  const topicQuotes = new Map<string, Array<{ topicCode: string; polarity: "praise" | "complaint"; text: string }>>();
  for (const row of intelligence ?? []) {
    const extraction = row.extraction;
    if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) continue;
    const quotations = (extraction as { facts?: { quotations?: Array<{ topicCode?: string; polarity?: string; excerpt?: string }> } }).facts?.quotations ?? [];
    topics.set(row.review_id, [...new Set(quotations.map((item) => item.topicCode).filter((code): code is string => Boolean(code)))]);
    topicQuotes.set(
      row.review_id,
      quotations.flatMap((item) => {
        if (!item.topicCode || !item.excerpt) return [];
        if (item.polarity !== "praise" && item.polarity !== "complaint") return [];
        if (!excerptSupportsClaim(item.topicCode, item.polarity, item.excerpt)) return [];
        return [{ topicCode: item.topicCode, polarity: item.polarity, text: item.excerpt }];
      }),
    );
  }
  const excerpts = new Map((data ?? []).map((row) => [row.review_id, row.excerpt]));
  const ordered = ids.filter((id) => {
    if (!allowed.has(id)) return false;
    if (input.topicCodes.length === 0 || !topicQuotes.has(id)) return true;
    const polarity = input.category === "positive_driver"
      ? "praise"
      : input.category === "micro_topic"
        ? null
        : "complaint";
    return (topicQuotes.get(id) ?? []).some(
      (quote) => input.topicCodes.includes(quote.topicCode) && (polarity === null || quote.polarity === polarity),
    );
  });
  const start = Math.max(0, input.page) * pageSize;
  const rows = ordered.slice(start, start + pageSize).map((id) => {
    const review = allowed.get(id)!;
    return {
      reviewId: id,
      excerpt: evidenceExcerpt(topicQuotes.get(id) ?? [], input.topicCodes, input.category) ?? excerpts.get(id) ?? null,
      stars: review.star_rating,
      createdAt: review.review_create_time,
      locationId: review.location_id,
      locationTitle: titles.get(review.location_id) ?? "Location",
      href: `/reviews?review=${id}`,
      topics: topics.get(id) ?? [],
    };
  });
  return { rows, total: ordered.length, pageSize, unavailable: null };
}
