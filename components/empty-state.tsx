import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-[#dadce0] bg-white px-6 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f0fe]">
        <Icon className="h-5 w-5 text-[#1a73e8]" aria-hidden />
      </div>
      <h3
        className="mt-4 text-[22px] leading-[1.3] tracking-[-0.02em] text-[#202124]"
        style={{ fontFamily: "var(--font-google-sans-display), sans-serif" }}
      >
        {title}
      </h3>
      <p className="mt-2 max-w-sm text-base font-light leading-relaxed text-[#5f6368]">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
