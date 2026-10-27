import { z } from "zod";

const observation = z.object({
  topic: z.string(), subtopic: z.string().nullable(),
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
  detail: z.string(), entityType: z.string().nullable(), entityName: z.string().nullable(),
  severity: z.number().nullable(), severityRationale: z.string().nullable(),
  evidenceExcerpt: z.string(), basis: z.enum(["fact", "hypothesis"]),
  confidence: z.number().nullable(), isAmbiguous: z.boolean(),
});

export const extractionSchema = z.object({ observations: z.array(observation) });
export const batchExtractionSchema = z.object({ results: z.array(z.object({ reviewId: z.string(), observations: z.array(observation) })) });
export const insightSchema = z.object({ insights: z.array(z.object({
  key: z.string(), title: z.string(), detail: z.string(),
  importance: z.number(), suggestedAction: z.string().nullable(), confidence: z.number(),
})) });
