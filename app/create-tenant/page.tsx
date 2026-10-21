import { redirect } from "next/navigation";
import { CreateTenantForm } from "@/components/create-tenant-form";
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
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <CreateTenantForm email={user.email ?? ""} />
    </div>
  );
}
