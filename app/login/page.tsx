import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/login-form";
import { authMethodsFromEnv } from "@/lib/auth-methods";
import { loginErrorMessage, shouldEnterWizard } from "@/lib/onboarding";
import { hasUserConsent } from "@/lib/services/consent";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { ensurePersonalWorkspace, getMemberRole } from "@/lib/services/workspace";
import { isManager } from "@/lib/shell";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, supabase] = await Promise.all([searchParams, createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    if (!(await hasUserConsent(user.id))) redirect("/consent");
    const membership = await ensurePersonalWorkspace(user);
    const [role, gate] = await Promise.all([
      getMemberRole(user.id, membership.workspace_id),
      getOnboardingGate(membership.workspace_id),
    ]);
    if (isManager(role) && shouldEnterWizard(gate)) redirect("/onboarding");
    redirect("/overview");
  }

  const errorCode = typeof params.error === "string" ? params.error : null;
  const errorReason = typeof params.reason === "string" ? params.reason : null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <LoginForm
        methods={authMethodsFromEnv()}
        initialError={loginErrorMessage(errorCode, errorReason)}
      />
    </div>
  );
}
