import { redirect } from "next/navigation";
import { getCurrentUser, getUserConsent } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";
import { ConsentForm } from "@/components/consent-form";

export default async function ConsentPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (await getUserConsent(user.id)) {
    redirect(isSuperAdmin(user) ? "/admin" : "/overview");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <ConsentForm />
    </div>
  );
}
