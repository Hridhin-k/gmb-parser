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
  "rounded-full border border-silver bg-white px-4 py-2 font-medium text-graphite hover:border-ink";
const DISABLED = "rounded-full border border-silver px-4 py-2 text-silver";

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
      className="flex items-center justify-center gap-3 py-2 text-sm text-slate"
    >
      {prev ? (
        <Link href={hrefFor(prev)} className={LINK}>
          Previous
        </Link>
      ) : (
        <span className={DISABLED}>Previous</span>
      )}
      <span className="tabular-nums">
        Page {currentPage} of {totalPages}
      </span>
      {next ? (
        <Link href={hrefFor(next)} className={LINK}>
          Next
        </Link>
      ) : (
        <span className={DISABLED}>Next</span>
      )}
    </nav>
  );
}
