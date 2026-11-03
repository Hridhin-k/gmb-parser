import { redirect } from "next/navigation";
import { followUpsHref } from "@/components/reviews-status";

/** Follow-ups now live in Reviews. Old links keep their scope, period and queue. */
export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(followUpsHref(await searchParams));
}
