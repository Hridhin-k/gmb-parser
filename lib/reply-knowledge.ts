import {
  assertSameWorkspace,
  knowledgeInScope,
  type AiKnowledgeRow,
  type KnowledgeScope,
} from "@/lib/ai-config";

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
}

/**
 * Instructions and response rules in scope are always eligible.
 * FAQs and approved examples are included when they share words with the review.
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
