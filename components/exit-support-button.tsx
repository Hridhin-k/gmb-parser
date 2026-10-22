"use client";

import { useRouter } from "next/navigation";

export function ExitSupportButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-md border border-amber-900/30 px-3 py-1 text-sm font-medium"
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
