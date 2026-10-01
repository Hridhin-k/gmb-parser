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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white px-6 py-14 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-50">
        <Icon className="h-5 w-5 text-gray-400" aria-hidden />
      </div>
      <h3 className="mt-3 text-[13px] font-medium text-gray-900">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-gray-500">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
