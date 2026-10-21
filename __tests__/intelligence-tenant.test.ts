import { describe, expect, it } from "vitest";
import { buildReplyPrompt } from "@/lib/services/ai-review";
import { planInvalidation } from "@/lib/intelligence/freshness";
import {
  insightContextBlock,
  inventedPromiseViolations,
  neverSayViolations,
  presentTopics,
  replyTopicBlock,
  retrieveKnowledge,
  rulesHash,
  splitGeneration,
  topicExtensionsFromKnowledge,
  type ReportProvenance,
} from "@/lib/intelligence/tenant-context";
import type { AiKnowledgeRow } from "@/lib/ai-config";

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function row(partial: Partial<AiKnowledgeRow> & Pick<AiKnowledgeRow, "id" | "workspaceId" | "kind" | "title" | "body">): AiKnowledgeRow {
  return { clientId: null, groupId: null, locationId: null, enabled: true, metadata: {}, ...partial };
}

const saree = row({
  id: "a-rule",
  workspaceId: WS_A,
  clientId: CLIENT_A,
  kind: "instruction",
  title: "Brand",
  body: "Always mention the saree section",
  metadata: { canonicalCode: "cleanliness", tenantLabel: "Housekeeping" },
});
const sareeExample = row({
  id: "a-example",
  workspaceId: WS_A,
  clientId: CLIENT_A,
  kind: "approved_example",
  title: "Saree visit",
  body: "Thank you for visiting the saree section",
});
const biryani = row({
  id: "b-rule",
  workspaceId: WS_B,
  clientId: CLIENT_B,
  kind: "instruction",
  title: "Kitchen",
  body: "Always mention the biryani counter",
  metadata: { canonicalCode: "cleanliness", tenantLabel: "Kitchen hygiene" },
});
const biryaniFaq = row({
  id: "b-faq",
  workspaceId: WS_B,
  clientId: CLIENT_B,
  kind: "faq",
  title: "Biryani hours",
  body: "Biryani is served until 10",
});

describe("tenant context", () => {
  it("keeps one canonical topic and gives each tenant its own label", () => {
    const code = "cleanliness";
    const a = presentTopics([code], topicExtensionsFromKnowledge([saree, biryani].filter((item) => item.workspaceId === WS_A)));
    const b = presentTopics([code], topicExtensionsFromKnowledge([biryani]));
    expect(a).toEqual([{ code, label: "Housekeeping" }]);
    expect(b).toEqual([{ code, label: "Kitchen hygiene" }]);
    expect(presentTopics(["not_a_topic"], [])).toEqual([]);
  });

  it("retrieves tenant A knowledge for a saree review and excludes tenant B", () => {
    const selected = retrieveKnowledge([saree, sareeExample, biryani, biryaniFaq], {
      workspaceId: WS_A,
      clientId: CLIENT_A,
      groupId: null,
      parentGroupId: null,
      locationId: null,
    }, "The saree section was beautiful");
    const text = selected.map((item) => item.body).join(" ");
    expect(text).toContain("saree section");
    expect(text).not.toContain("biryani");
  });

  it("puts the original review text in the reply prompt and keeps topics beside it", () => {
    const comment = "The trial room was dirty but the sarees were lovely";
    const topics = presentTopics(["cleanliness", "fitting_room"], topicExtensionsFromKnowledge([saree]));
    const prompt = buildReplyPrompt({
      reviewerName: "Asha",
      starRating: 4,
      comment,
      businessName: "Tenant A",
      locationName: "Kochi",
      knowledge: retrieveKnowledge([saree, biryani], {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        groupId: null,
        parentGroupId: null,
        locationId: null,
      }, comment),
      topics,
    });
    expect(prompt).toContain(comment);
    expect(prompt).toContain("cleanliness: Housekeeping");
    expect(prompt).toContain("Always mention the saree section");
    expect(prompt).not.toContain("biryani");
    expect(replyTopicBlock(comment, topics)).toContain("do not replace it");
  });

  it("blocks a forbidden phrase and an invented promise", () => {
    expect(neverSayViolations("We offer a competitor price match", ["competitor price match"])).toEqual([
      "competitor price match",
    ]);
    expect(inventedPromiseViolations("we have retrained the team", [])).toEqual(["we have retrained"]);
    expect(inventedPromiseViolations("we have retrained the team", ["we have retrained the floor staff"])).toEqual([]);
  });

  it("leaves a stored report unchanged when the rules hash moves", () => {
    const stored: ReportProvenance = {
      id: "report-1",
      configVersion: 2,
      rulesHash: rulesHash({ version: 2, lensFingerprint: "fashion", knowledge: [{ id: "a-rule", body: saree.body }] }),
      reviewCount: 15,
    };
    const nextHash = rulesHash({ version: 3, lensFingerprint: "restaurant", knowledge: [{ id: "b-rule", body: biryani.body }] });
    const result = splitGeneration([stored], { configVersion: 3, rulesHash: nextHash });
    expect(stored.reviewCount).toBe(15);
    expect(stored.configVersion).toBe(2);
    expect(result.unchanged[0]).toEqual(stored);
    expect(result.staleIds).toEqual(["report-1"]);
    expect(result.metricsRewritten).toBe(false);
    const plan = planInvalidation({ kind: "tenant_rules_changed", rulesHash: nextHash, summaryIds: ["summary-1"] });
    expect(plan.metricsStayValid).toBe(true);
    expect(plan.stale).toEqual(["insight_report"]);
    const block = insightContextBlock({
      reviewCount: stored.reviewCount,
      priorities: ["copy the saree praise"],
      policies: [],
      labels: presentTopics(["cleanliness"], topicExtensionsFromKnowledge([saree])),
    });
    expect(block).toContain("15");
    expect(block).toContain("Housekeeping");
    expect(block).not.toContain("biryani");
  });
});
