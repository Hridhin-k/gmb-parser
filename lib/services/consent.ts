import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";

function isMissingConsentTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

export async function hasUserConsent(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_user_consents")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingConsentTable(error)) return false;
    throw new AppError("Could not check your agreement.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }

  return Boolean(data);
}

export async function recordUserConsent(userId: string): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("grm_user_consents").upsert(
    {
      user_id: userId,
      terms_accepted_at: now,
      ai_accepted_at: now,
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );

  if (error) {
    throw new AppError("Could not save your agreement.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }
}
