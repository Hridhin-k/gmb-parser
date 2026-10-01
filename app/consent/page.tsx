import { redirect } from "next/navigation";
import { getCurrentUser, getUserConsent } from "@/lib/services/session";
import { ConsentForm } from "@/components/consent-form";

export default async function ConsentPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (await getUserConsent(user.id)) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#fafaf8] px-4 py-10">
      <ConsentForm />
    </div>
  );
}
