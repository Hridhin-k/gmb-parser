import { redirect } from "next/navigation";
import { CreateTenantForm } from "@/components/create-tenant-form";
import { PubNav, PubPage } from "@/components/pub-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { hasUserConsent } from "@/lib/services/consent";
import { getCurrentUser } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";
import { inspectTenantAccess } from "@/lib/services/workspace";

export default async function CreateTenantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (isSuperAdmin(user)) redirect("/admin");
  if (!(await hasUserConsent(user.id))) redirect("/consent");
  const access = await inspectTenantAccess(user);
  if (access.kind === "allowed") redirect("/overview");
  if (access.kind === "suspended") redirect("/not-invited?reason=suspended");
  if (access.kind === "deleted") redirect("/not-invited?reason=deleted");
  if (access.kind === "not_invited") redirect("/not-invited");
  return (
    <PubPage
      className="sm:pt-12"
      nav={
        <PubNav>
          {user.email ? <span className="max-w-[60vw] truncate">{user.email}</span> : null}
          <span aria-hidden>·</span>
          <SignOutButton label="Not you?" className="font-medium text-brand hover:underline disabled:opacity-50" />
        </PubNav>
      }
    >
      <CreateTenantForm email={user.email ?? ""} />
    </PubPage>
  );
}
