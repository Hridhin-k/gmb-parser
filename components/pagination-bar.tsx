import Link from "next/link";

interface PaginationBarProps {
  basePath: string;
  currentPage: number;
  totalPages: number;
  searchParams: URLSearchParams;
}

const LINK =
  "rounded-full border border-[#dadce0] bg-white px-4 py-2 font-medium text-[#202124] hover:border-[#1a73e8]";
const DISABLED = "rounded-full border border-mist px-4 py-2 text-[#dadce0]";

export function PaginationBar({
  basePath,
  currentPage,
  totalPages,
  searchParams,
}: PaginationBarProps) {
  function hrefFor(page: number) {
    const p = new URLSearchParams(searchParams.toString());
    if (page <= 1) p.delete("page");
    else p.set("page", String(page));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const prev = currentPage > 1 ? currentPage - 1 : null;
  const next = currentPage < totalPages ? currentPage + 1 : null;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-3 py-2 text-sm text-[#5f6368]"
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
