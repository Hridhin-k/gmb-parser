interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1
          className="text-[31px] leading-[1.2] tracking-[-0.032em] text-[#18161a]"
          style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-base font-light leading-relaxed text-[#898b91]">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
