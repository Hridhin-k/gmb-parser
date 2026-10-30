import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * The fairness rules behind every request. Customers get equal access to the
 * Google review option regardless of sentiment; keep this copy intact.
 */
export function RequestsPolicyCard({ policyDays }: { policyDays: number }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ShieldCheck className="size-4 text-ok" aria-hidden />
        Policy guardrails
      </h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-ink-3">
        <li>
          Every customer sees the same page with both choices: review on Google, or tell the business privately. Nothing on the
          page depends on a rating, and the Google option is never hidden.
        </li>
        <li>Recipients can’t be filtered by past sentiment. Everyone who is sent the message gets the same text and the same page.</li>
        <li>An opt-out line is added to every message when it is missing. Opted-out customers are skipped.</li>
        <li>
          One request per customer every {policyDays} {policyDays === 1 ? "day" : "days"}. The server skips anyone contacted more recently.
        </li>
        <li>Private feedback is not a review and is never posted on Google.</li>
      </ul>
      <Link href="/terms" className="text-xs font-medium text-brand hover:text-brand-hover">
        Terms of service
      </Link>
    </section>
  );
}
