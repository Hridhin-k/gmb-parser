import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AuthCard } from "@/components/pub-shell";
import { ExtPage } from "../_components/ext-chrome";

export default async function ClientOnboardingDonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const expired = params.expired === "1";
  return (
    <ExtPage name={null}>
      <AuthCard className="gap-3.5">
        {expired ? (
          <>
            <Badge variant="bad">Couldn&apos;t start</Badge>
            <h1 className="text-lg font-semibold text-ink">Link unavailable</h1>
            <p className="text-[15px] leading-relaxed text-ink-2">
              Ask the agency for a new link. The previous one has expired or was already used. No access was stored.
            </p>
          </>
        ) : (
          <>
            <span className="inline-flex size-11 items-center justify-center rounded-full bg-ok-tint text-ok">
              <CheckCircle2 className="size-6" aria-hidden />
            </span>
            <Badge variant="ok">Connected</Badge>
            <h1 className="text-lg font-semibold text-ink">Google authorization finished</h1>
            <p className="text-[15px] leading-relaxed text-ink-2">
              The Google account you just authorized is stored for this business. The agency can now sync its
              locations and reviews. You can close this page.
            </p>
            <p className="text-xs text-ink-3">
              To revoke access later: Google Account › Security › Third-party connections.
            </p>
          </>
        )}
      </AuthCard>
    </ExtPage>
  );
}
