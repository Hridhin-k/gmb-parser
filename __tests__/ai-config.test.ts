import { describe, expect, it } from "vitest";
import {
  assertSameWorkspace,
  insightLensFingerprint,
  insightLensPromptBlock,
  knowledgeInScope,
  knowledgePromptBlock,
  orgContextPromptBlock,
  parseInsightLens,
  parseSnapshot,
  resolveInsightLens,
  templatesPromptBlock,
  type AiKnowledgeRow,
} from "@/lib/ai-config";
import { buildReplyPrompt } from "@/lib/services/ai-review";
import { canAct } from "@/lib/access";

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const GROUP_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PARENT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const LOC_A = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

function row(
  partial: Partial<AiKnowledgeRow> & Pick<AiKnowledgeRow, "id" | "workspaceId" | "kind" | "title" | "body">
): AiKnowledgeRow {
  return {
    clientId: null,
    groupId: null,
    locationId: null,
    enabled: true,
    metadata: {},
    ...partial,
  };
}

describe("insight lens", () => {
  it("parses snapshot insights and resolves client override over workspace defaults", () => {
    const snapshot = parseSnapshot({
      insights: {
        vertical: "retail",
        watchThemes: ["staff", "price"],
        focusQuestions: ["Where is staff praised?"],
        successSignals: ["higher reply rate"],
      },
    });
    expect(snapshot.insights.vertical).toBe("retail");
    expect(snapshot.insights.watchThemes).toEqual(["staff", "price"]);

    const clientLens = resolveInsightLens({
      workspaceLens: snapshot.insights,
      clientId: CLIENT_A,
      knowledge: [
        row({
          id: "lens",
          workspaceId: WS_A,
          kind: "insight_lens",
          title: "Insight lens",
          body: "Fashion notes",
          clientId: CLIENT_A,
          metadata: {
            lens: {
              vertical: "fashion",
              watchThemes: ["quality", "fit"],
              focusQuestions: ["Which outlets drag quality?"],
              successSignals: [],
            },
          },
        }),
      ],
    });
    expect(clientLens.vertical).toBe("fashion");
    expect(clientLens.watchThemes).toEqual(["quality", "fit"]);

    const block = insightLensPromptBlock(clientLens, "Fashion notes");
    expect(block).toMatch(/quality/);
    expect(block).toMatch(/Fashion notes/);
    expect(insightLensFingerprint(clientLens)).not.toBe(insightLensFingerprint(parseInsightLens({})));
  });

  it("keeps insight_lens rows out of reply knowledge prompts", () => {
    const block = knowledgePromptBlock([
      row({
        id: "lens",
        workspaceId: WS_A,
        kind: "insight_lens",
        title: "Insight lens",
        body: "Should not appear in reply prompt",
        metadata: { lens: { vertical: "fashion", watchThemes: ["fit"], focusQuestions: [], successSignals: [] } },
      }),
      row({ id: "1", workspaceId: WS_A, kind: "instruction", title: "Org", body: "Be kind" }),
    ]);
    expect(block).toMatch(/Be kind/);
    expect(block).not.toMatch(/Should not appear/);
  });
});

describe("knowledgeInScope", () => {
  const rows = [
    row({ id: "1", workspaceId: WS_A, kind: "instruction", title: "Org", body: "Be kind" }),
    row({
      id: "2",
      workspaceId: WS_A,
      kind: "faq",
      title: "Hours?",
      body: "9–6",
      clientId: CLIENT_A,
    }),
    row({
      id: "3",
      workspaceId: WS_A,
      kind: "response_rule",
      title: "Group rule",
      body: "No slang",
      groupId: GROUP_A,
    }),
    row({
      id: "4",
      workspaceId: WS_A,
      kind: "approved_example",
      title: "Outlet",
      body: "Thanks for visiting Kochi",
      locationId: LOC_A,
    }),
    row({
      id: "5",
      workspaceId: WS_B,
      kind: "instruction",
      title: "Foreign",
      body: "Tenant B secret",
    }),
    row({
      id: "6",
      workspaceId: WS_A,
      kind: "faq",
      title: "Other brand",
      body: "Wrong",
      clientId: CLIENT_B,
      enabled: true,
    }),
    row({
      id: "7",
      workspaceId: WS_A,
      kind: "instruction",
      title: "Off",
      body: "Disabled",
      enabled: false,
    }),
  ];

  it("includes workspace, client, group/parent, and location rows for an outlet", () => {
    const scoped = knowledgeInScope(rows, {
      workspaceId: WS_A,
      clientId: CLIENT_A,
      groupId: GROUP_A,
      parentGroupId: PARENT,
      locationId: LOC_A,
    });
    expect(scoped.map((item) => item.id).sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("includes parent-group knowledge when the outlet sits under a child group", () => {
    const scoped = knowledgeInScope(
      [
        row({
          id: "p",
          workspaceId: WS_A,
          kind: "instruction",
          title: "Parent",
          body: "Parent rule",
          groupId: PARENT,
        }),
      ],
      {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        groupId: GROUP_A,
        parentGroupId: PARENT,
        locationId: LOC_A,
      }
    );
    expect(scoped.map((item) => item.id)).toEqual(["p"]);
  });

  it("drops disabled rows", () => {
    const scoped = knowledgeInScope(rows, {
      workspaceId: WS_A,
      clientId: CLIENT_A,
      groupId: null,
      parentGroupId: null,
      locationId: null,
    });
    expect(scoped.some((item) => item.id === "7")).toBe(false);
  });
});

describe("assertSameWorkspace", () => {
  it("excludes foreign workspace knowledge", () => {
    const kept = assertSameWorkspace(
      [
        row({ id: "1", workspaceId: WS_A, kind: "instruction", title: "A", body: "a" }),
        row({ id: "2", workspaceId: WS_B, kind: "instruction", title: "B", body: "Tenant B secret" }),
      ],
      WS_A
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.body).toBe("a");
  });
});

describe("buildReplyPrompt tenant isolation", () => {
  it("includes tenant A instructions and never tenant B text", () => {
    const prompt = buildReplyPrompt({
      reviewerName: "Asha",
      starRating: 5,
      comment: "Great shop",
      businessName: "Tenant A",
      locationName: "A Kochi",
      orgContext: {
        industry: "Retail",
        positioning: "Friendly local brand",
        priorities: "",
        policies: "",
        legacyVoice: "",
        legacyNote: "",
      },
      knowledge: [
        row({
          id: "1",
          workspaceId: WS_A,
          kind: "instruction",
          title: "A rule",
          body: "Always mention the saree section",
        }),
      ],
      templates: [{ name: "Thanks", body: "Thank you from Tenant A" }],
    });
    expect(prompt).toContain("Always mention the saree section");
    expect(prompt).toContain("Friendly local brand");
    expect(prompt).toContain("Thank you from Tenant A");
    expect(prompt).toContain("saved instructions — not a trained model");
    expect(prompt).not.toContain("Tenant B secret");
  });
});

describe("prompt helpers", () => {
  it("parseSnapshot fills defaults", () => {
    const snap = parseSnapshot({ org: { industry: "Food" }, tone: { warmth: "formal" } });
    expect(snap.org.industry).toBe("Food");
    expect(snap.tone.warmth).toBe("formal");
    expect(snap.automation.enabled).toBe(false);
  });

  it("builds knowledge and org blocks", () => {
    expect(orgContextPromptBlock({ industry: "Retail", positioning: "", priorities: "", policies: "", legacyVoice: "", legacyNote: "" })).toContain("Retail");
    expect(
      knowledgePromptBlock([
        row({ id: "1", workspaceId: WS_A, kind: "faq", title: "Parking?", body: "Street only" }),
      ])
    ).toContain("Parking?");
    expect(templatesPromptBlock([{ name: "Hi", body: "Hello" }])).toContain("Hello");
  });
});

describe("config mutation access", () => {
  it("denies foreign client edits for a brand manager", () => {
    const allowed = canAct({
      role: "brand_manager",
      enabled: true,
      permission: "edit_rules",
      scope: { clientId: CLIENT_A, groupId: null, locationId: null },
      actorWorkspaceId: WS_A,
      resource: { workspaceId: WS_A, clientId: CLIENT_B, locationId: LOC_A },
    });
    expect(allowed).toBe(false);
  });

  it("denies another workspace entirely", () => {
    const allowed = canAct({
      role: "owner",
      enabled: true,
      permission: "edit_rules",
      scope: { clientId: null, groupId: null, locationId: null },
      actorWorkspaceId: WS_A,
      resource: { workspaceId: WS_B, clientId: CLIENT_B },
    });
    expect(allowed).toBe(false);
  });
});
