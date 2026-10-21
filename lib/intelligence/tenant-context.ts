import { createHash } from "node:crypto";
import {
  assertSameWorkspace,
  knowledgeInScope,
  type AiKnowledgeRow,
  type KnowledgeScope,
} from "@/lib/ai-config";
import { TAXONOMY_V2, resolveTopicCode } from "@/lib/intelligence/taxonomy";

/** Presentation layer. Canonical topic codes and review counts are not rewritten here. */
export const TENANT_CONTEXT_VERSION = "tenant-context-v1";

export interface TopicExtension {
  canonicalCode: string;
  tenantLabel: string;
}

export interface ReportProvenance {
  id: string;
  configVersion: number;
  rulesHash: string;
  reviewCount: number;
}

const LABEL_BY_CODE = new Map(TAXONOMY_V2.map((node) => [node.code, node.label]));

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
}

/** A mapping is kept only when it points at a canonical leaf. It does not copy the review. */
export function topicExtensionsFromKnowledge(rows: readonly AiKnowledgeRow[]): TopicExtension[] {
  const seen = new Set<string>();
  const extensions: TopicExtension[] = [];
  for (const row of rows) {
    if (!row.enabled) continue;
    const code = typeof row.metadata.canonicalCode === "string" ? resolveTopicCode(row.metadata.canonicalCode) : null;
    const label = typeof row.metadata.tenantLabel === "string" ? row.metadata.tenantLabel.trim().slice(0, 80) : "";
    if (!code || !label || seen.has(code)) continue;
    seen.add(code);
    extensions.push({ canonicalCode: code, tenantLabel: label });
  }
  return extensions;
}

/** Display labels for codes that exist in taxonomy-v2. Unknown codes are omitted. */
export function presentTopics(
  codes: readonly string[],
  extensions: readonly TopicExtension[]
): Array<{ code: string; label: string }> {
  const labels = new Map(extensions.map((item) => [item.canonicalCode, item.tenantLabel]));
  const shown: Array<{ code: string; label: string }> = [];
  for (const code of codes) {
    const canonical = LABEL_BY_CODE.get(code);
    if (!canonical || shown.some((item) => item.code === code)) continue;
    shown.push({ code, label: labels.get(code) ?? canonical });
  }
  return shown;
}

/**
 * Instructions and response rules in scope are always eligible.
 * FAQs and approved examples are included when they share words with the review or finding.
 * Another workspace's rows are dropped before either step.
 */
export function retrieveKnowledge(
  rows: readonly AiKnowledgeRow[],
  scope: KnowledgeScope,
  query: string,
  limit = 8
): AiKnowledgeRow[] {
  if (!scope.workspaceId) return [];
  const scoped = knowledgeInScope(assertSameWorkspace([...rows], scope.workspaceId), scope);
  const policies = scoped.filter((row) => row.kind === "instruction" || row.kind === "response_rule");
  const queryTokens = tokens(query);
  const retrieved = scoped
    .filter((row) => row.kind === "faq" || row.kind === "approved_example")
    .map((row) => {
      const rowTokens = tokens(`${row.title} ${row.body}`);
      let score = 0;
      for (const token of queryTokens) if (rowTokens.has(token)) score += 1;
      return { row, score };
    })
    .filter((item) => queryTokens.size === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .map((item) => item.row);
  const chosen: AiKnowledgeRow[] = [];
  for (const row of [...policies, ...retrieved]) {
    if (chosen.some((item) => item.id === row.id)) continue;
    chosen.push(row);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

/** The written comment stays intact. Topic labels are classification beside it. */
export function replyTopicBlock(comment: string | null, topics: readonly { code: string; label: string }[]): string {
  if (topics.length === 0) return "";
  const lines = topics.map((topic) => `- ${topic.code}: ${topic.label}`);
  return (
    `\nCANONICAL TOPICS (classification only. Answer the written comment above` +
    `${comment?.trim() ? "; do not replace it with these labels" : ""})\n${lines.join("\n")}\n`
  );
}

/** Phrases this organisation told us never to publish. */
export function neverSayViolations(content: string, neverSay: readonly string[]): string[] {
  const text = content.toLowerCase();
  return neverSay
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= 2 && text.includes(phrase.toLowerCase()));
}

/** Promises the model must not invent. An approved policy sentence that already contains the phrase is allowed. */
export function inventedPromiseViolations(content: string, policies: readonly string[]): string[] {
  const patterns = [
    /\bwe have retrained\b/i,
    /\bwe will (refund|compensate|discount)\b/i,
    /\bit is back in stock\b/i,
    /\bwe have fixed this\b/i,
  ];
  const allowed = policies.join("\n").toLowerCase();
  return patterns
    .map((pattern) => content.match(pattern)?.[0] ?? "")
    .filter((phrase) => phrase && !allowed.includes(phrase.toLowerCase()));
}

export function rulesHash(input: {
  version: number;
  lensFingerprint: string;
  knowledge: readonly { id: string; body: string }[];
}): string {
  const knowledge = [...input.knowledge].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256")
    .update(JSON.stringify({ version: input.version, lens: input.lensFingerprint, knowledge, context: TENANT_CONTEXT_VERSION }))
    .digest("hex")
    .slice(0, 32);
}

/**
 * A new configuration is for the next generation. Stored reports keep their version,
 * hash, and review count. Rows whose hash differs are the ones to mark stale.
 */
export function splitGeneration(
  history: readonly ReportProvenance[],
  next: { configVersion: number; rulesHash: string }
): { unchanged: ReportProvenance[]; staleIds: string[]; metricsRewritten: false } {
  return {
    unchanged: history.map((report) => ({ ...report })),
    staleIds: history.filter((report) => report.rulesHash !== next.rulesHash).map((report) => report.id),
    metricsRewritten: false,
  };
}

/** Insight prose may use these notes. It must not replace the counted review total. */
export function insightContextBlock(input: {
  reviewCount: number;
  priorities: readonly string[];
  policies: readonly string[];
  labels: readonly { code: string; label: string }[];
}): string {
  const lines = [
    `Counted reviews in this window: ${input.reviewCount}. Do not replace this number.`,
  ];
  if (input.labels.length) {
    lines.push(`Tenant labels for canonical topics: ${input.labels.map((item) => `${item.code}=${item.label}`).join(", ")}.`);
  }
  if (input.priorities.length) lines.push(`Priorities: ${input.priorities.join("; ")}.`);
  if (input.policies.length) lines.push(`Policies: ${input.policies.join("; ")}.`);
  return lines.join("\n");
}
