import { AppError } from "@/lib/errors";

export const AI_ACTION_CODES = ["AI_CREDITS_EXHAUSTED", "AI_BUDGET_EXCEEDED", "CONFIG_ERROR"];
export const AI_PAUSE_CODES = [...AI_ACTION_CODES, "AI_TIMEOUT", "AI_OUTCOME_UNKNOWN"];

export function aiStopsRun(error: unknown): error is AppError {
  return error instanceof AppError && AI_PAUSE_CODES.includes(error.code);
}
