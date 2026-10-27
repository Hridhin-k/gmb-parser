import { createAdminClient } from "@/lib/supabase/admin";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { generateAi } from "@/lib/ai/service";
import { aiConfigured } from "@/lib/ai/config";
import { checkReplyGuardrails } from "@/lib/reply-guardrails";
import { voiceGuide } from "@/lib/automation";
import { resolvedForLocation } from "@/lib/services/reply-settings";
import { loadPromptContextForLocation, ensureActiveAiConfig } from "@/lib/services/ai-config";
import { buildReplyPrompt, draftModelRoute } from "@/lib/services/ai-review";
import { resolvedToneForLocation } from "@/lib/services/hierarchy";
import type { ToneVoice } from "@/lib/onboarding";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Draft preview for Settings: runs the same prompt path as generateDraft without
 * writing drafts or replies. Labelled as a draft preview in the UI.
 */
export async function previewAiDraft(input: {
  workspaceId: string;
  userId: string;
  comment: string;
  reviewerName?: string;
  locationId?: string;
}): Promise<{
  text: string;
  words: number;
  violations: string[];
  draftPreview: true;
  aiConfigVersion: number;
  unavailable?: string;
}> {
  const admin = createAdminClient();
  let locationId = input.locationId ?? null;
  let locationName = "Sample location";
  let businessName = "Your business";

  if (locationId) {
    const place = await admin
      .from("grm_google_locations")
      .select("id, location_title, client_id, grm_clients(name)")
      .eq("id", locationId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (!place.data) throw new ValidationError("That location is not in this organization.");
    locationName = place.data.location_title ?? locationName;
    const client = place.data.grm_clients as { name: string } | Array<{ name: string }> | null;
    businessName = Array.isArray(client)
      ? (client[0]?.name ?? locationName)
      : (client?.name ?? locationName);
  } else {
    const first = await admin
      .from("grm_google_locations")
      .select("id, location_title, grm_clients(name)")
      .eq("workspace_id", input.workspaceId)
      .order("location_title")
      .limit(1)
      .maybeSingle();
    if (first.data) {
      locationId = first.data.id;
      locationName = first.data.location_title ?? locationName;
      const client = first.data.grm_clients as { name: string } | Array<{ name: string }> | null;
      businessName = Array.isArray(client)
        ? (client[0]?.name ?? locationName)
        : (client?.name ?? locationName);
    }
  }

  const config = await ensureActiveAiConfig(input.workspaceId, input.userId);
  const org = config.snapshot.org;

  let knowledge: Awaited<ReturnType<typeof loadPromptContextForLocation>>["knowledge"] = [];
  let templates: Array<{ name: string; body: string }> = [];
  let voiceGuideText = voiceGuide(config.snapshot.tone, config.snapshot.automation.varyWording);

  if (locationId) {
    const [promptContext, configured, tone] = await Promise.all([
      loadPromptContextForLocation(input.workspaceId, locationId),
      resolvedForLocation(input.workspaceId, locationId),
      resolvedToneForLocation(input.workspaceId, locationId),
    ]);
    knowledge = promptContext.knowledge;
    templates = promptContext.templates;
    voiceGuideText = voiceGuide(configured.tone, configured.automation.varyWording);
    void tone;
  }

  const legacyTone =
    org.legacyVoice || org.legacyNote
      ? {
          voice: (org.legacyVoice || null) as ToneVoice | null,
          note: org.legacyNote || null,
        }
      : locationId
        ? await resolvedToneForLocation(input.workspaceId, locationId)
        : null;

  const prompt = buildReplyPrompt({
    reviewerName: input.reviewerName?.trim() || "Anjali",
    starRating: 5,
    comment: input.comment,
    businessName,
    locationName,
    tone: legacyTone,
    voiceGuide: voiceGuideText,
    orgContext: org,
    knowledge,
    templates,
  });

  if (!aiConfigured("reply")) {
    return {
      text: "",
      words: 0,
      violations: [],
      draftPreview: true,
      aiConfigVersion: config.version,
      unavailable: "Draft preview is unavailable until the selected AI provider is configured.",
    };
  }

  const route = draftModelRoute({ starRating: 5, comment: input.comment });
  const startedAt = Date.now();
  try {
    const { text, model: modelId } = await generateAi({
      workspaceId: input.workspaceId, task: "reply", operation: "preview", prompt,
      fast: route === "fast", maxOutputTokens: 1024, timeoutMs: REQUEST_TIMEOUT_MS, temperature: 0.6,
    });
    const cleaned = text
      .trim()
      .replace(/^(reply|response)\s*:\s*/i, "")
      .replace(/^["“]([\s\S]*)["”]$/, "$1")
      .trim();
    const violations = checkReplyGuardrails(cleaned).map((item) => item.message);
    logger.info("ai_preview.ok", {
      workspaceId: input.workspaceId,
      aiConfigVersion: config.version,
      durationMs: Date.now() - startedAt,
      success: true,
      model: modelId,
      route,
    });
    return {
      text: cleaned,
      words: cleaned.split(/\s+/).filter(Boolean).length,
      violations,
      draftPreview: true,
      aiConfigVersion: config.version,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_TIMEOUT") throw error;
    if ((error as Error).name === "AbortError") {
      throw new AppError("Draft preview timed out. Please try again.", "AI_TIMEOUT", 504);
    }
    logger.error("ai_preview.failed", {
      workspaceId: input.workspaceId,
      aiConfigVersion: config.version,
      durationMs: Date.now() - startedAt,
      success: false,
    });
    return {
      text: "",
      words: 0,
      violations: [],
      draftPreview: true,
      aiConfigVersion: config.version,
      unavailable: error instanceof AppError ? error.message : "Draft preview is temporarily unavailable.",
    };
  }
}
