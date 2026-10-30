import { Skeleton } from "@/components/ui/skeleton";

function Panel({ className, rows }: { className?: string; rows: number }) {
  return (
    <div className={`space-y-3 rounded-lg border border-line bg-white p-4 ${className ?? ""}`}>
      <Skeleton className="h-4 w-28 rounded bg-[#e4e7ec]" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`h-3 rounded bg-[#eceef2] ${i % 2 ? "w-3/4" : "w-full"}`} />
      ))}
    </div>
  );
}

export default function EscalationCaseLoading() {
  return (
    <div className="mt-2 space-y-4" aria-busy="true" aria-label="Loading case">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-32 rounded bg-[#eceef2]" />
        <Skeleton className="h-6 w-72 max-w-full rounded bg-[#e4e7ec]" />
        <Skeleton className="h-3 w-96 max-w-full rounded bg-[#eceef2]" />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Panel rows={3} />
          <Panel rows={4} />
          <Panel rows={5} />
        </div>
        <div className="space-y-4">
          <Panel rows={6} />
          <Panel rows={3} />
        </div>
      </div>
    </div>
  );
}
