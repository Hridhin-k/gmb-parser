import { redirect } from "next/navigation";
import { getCurrentUser, getUserConsent } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";
import { ConsentForm } from "@/components/consent-form";
import { PubNav, PubPage } from "@/components/pub-shell";
import { SignOutButton } from "@/components/sign-out-button";

export default async function ConsentPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (await getUserConsent(user.id)) {
    redirect(isSuperAdmin(user) ? "/admin" : "/overview");
  }

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
      <ConsentForm />
    </PubPage>
  );
}
