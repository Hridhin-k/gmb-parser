import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { AuthCard, PubNav, PubPage } from "@/components/pub-shell";

export default function NotFound() {
  return (
    <PubPage className="justify-center" nav={<PubNav />}>
      <AuthCard className="gap-3">
        <span className="font-mono text-[13px] font-semibold text-brand">404</span>
        <h1 className="text-lg font-semibold text-ink">Page not found</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Link href="/overview" className={buttonVariants()}>
            Back to Overview
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            RevuPilot home
          </Link>
        </div>
      </AuthCard>
    </PubPage>
  );
}
