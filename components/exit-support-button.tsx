"use client";

import { useRouter } from "next/navigation";

export function ExitSupportButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center rounded-md border border-demo-ink px-2.5 text-xs font-semibold text-demo-ink hover:bg-white/40"
      onClick={async () => {
        await fetch("/api/platform/tenants/00000000-0000-0000-0000-000000000000/impersonate", { method: "DELETE" }).catch(() => undefined);
        router.replace("/admin");
        router.refresh();
      }}
    >
      Exit support view
    </button>
  );
}
