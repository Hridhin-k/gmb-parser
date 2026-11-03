import { notFound, redirect } from "next/navigation";
import { followUpsHref } from "@/components/reviews-status";

/** A follow-up case opens in the Follow-ups tab of Reviews, selected. */
export default async function EscalationCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ escalationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ escalationId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(escalationId)) notFound();
  redirect(followUpsHref(query, escalationId));
}
