import Link from "next/link";

interface PaginationBarProps {
  basePath: string;
  currentPage: number;
  totalPages: number;
  searchParams: URLSearchParams;
  /** Query param that carries the page number. Defaults to `page`. */
  paramName?: string;
}

const LINK =
  "inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink hover:bg-paper";
const DISABLED = "inline-flex h-7 items-center rounded-md border border-line-2 px-2.5 text-xs text-stone";

export function PaginationBar({
  basePath,
  currentPage,
  totalPages,
  searchParams,
  paramName = "page",
}: PaginationBarProps) {
  function hrefFor(page: number) {
    const p = new URLSearchParams(searchParams.toString());
    if (page <= 1) p.delete(paramName);
    else p.set(paramName, String(page));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const prev = currentPage > 1 ? currentPage - 1 : null;
  const next = currentPage < totalPages ? currentPage + 1 : null;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-xs text-ink-3"
    >
      <span className="tabular-nums">
        Page {currentPage.toLocaleString("en-US")} of {totalPages.toLocaleString("en-US")}
      </span>
      <span className="flex items-center gap-1.5">
      {prev ? (
        <Link href={hrefFor(prev)} className={LINK}>
          Previous
        </Link>
      ) : (
        <span className={DISABLED}>Previous</span>
      )}
      {next ? (
        <Link href={hrefFor(next)} className={LINK}>
          Next
        </Link>
      ) : (
        <span className={DISABLED}>Next</span>
      )}
      </span>
    </nav>
  );
}
