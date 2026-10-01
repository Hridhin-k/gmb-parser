interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1
          className="text-[26px] leading-[1.2] tracking-[-0.032em] text-[#18161a] sm:text-[31px]"
          style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-xl text-sm font-light text-[#898b91]">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          {children}
        </div>
      )}
    </div>
  );
}
