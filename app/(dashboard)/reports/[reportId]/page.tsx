import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { guardReport, ReportService } from "@/lib/services/reporting";
import { getActiveWorkspace } from "@/lib/services/session";
import { validateId } from "@/lib/validation";

interface ReportPreviewProps {
  params: Promise<{ reportId: string }>;
}

export default async function ReportPreviewPage({ params }: ReportPreviewProps) {
  const { user, workspaceId } = await getActiveWorkspace();
  let reportId: string;
  try {
    reportId = validateId((await params).reportId, "reportId");
  } catch {
    notFound();
  }
  const report = await ReportService.load(workspaceId, reportId);
  if (!report) notFound();
  try {
    await guardReport(user.id, workspaceId, report);
  } catch {
    notFound();
  }
  let document: Awaited<ReturnType<typeof ReportService.preview>>;
  try {
    document = await ReportService.preview(workspaceId, reportId);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={document.name}
        description={`${document.scopeLabel}. ${document.periodLabel} (${document.timezone}). Figures come from stored reviews.`}
      >
        <Link href="/reports" className="text-sm text-ink hover:underline">
          Back to reports
        </Link>
        <a href={`/api/reports/${reportId}/pdf`} className="text-sm text-ink hover:underline">
          Download PDF
        </a>
        <a href={`/api/reports/${reportId}/csv`} className="text-sm text-ink hover:underline">
          Download CSV
        </a>
      </PageHeader>
      <section className="rounded-xl bg-white p-5 shadow-card">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-graphite">{document.lines.join("\n")}</pre>
      </section>
    </div>
  );
}
