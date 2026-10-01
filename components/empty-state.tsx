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
    <div className="flex flex-col items-center justify-center rounded-[20px] border border-[#d9d2ff] bg-white px-6 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#ede9ff]">
        <Icon className="h-5 w-5 text-[#4823ff]" aria-hidden />
      </div>
      <h3
        className="mt-4 text-[22px] leading-[1.3] tracking-[-0.02em] text-[#18161a]"
        style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
      >
        {title}
      </h3>
      <p className="mt-2 max-w-sm text-base font-light leading-relaxed text-[#898b91]">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
