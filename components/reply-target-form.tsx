"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplyTargetForm({ target }: { target: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(target === null ? "" : String(Math.round(target * 100)));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(next: number | null) {
    setPending(true);
    setError(null);
    const response = await fetch("/api/dashboard/reply-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: next }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "Could not save the target.");
      return;
    }
    router.refresh();
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl bg-white px-4 py-3 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          setError("Enter a target from 1 to 100, or clear it.");
          return;
        }
        void save(parsed);
      }}
    >
      <label className="text-xs text-slate">
        Reply rate target (%)
        <input
          inputMode="numeric"
          className="mt-1 block w-24 rounded-md border border-line px-2 py-1.5 text-sm text-ink"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-ink px-3 py-1.5 text-sm text-white">
        Save target
      </button>
      <button
        type="button"
        disabled={pending || target === null}
        className="rounded-md border border-line px-3 py-1.5 text-sm"
        onClick={() => {
          setValue("");
          void save(null);
        }}
      >
        Clear target
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
