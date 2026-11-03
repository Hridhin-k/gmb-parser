"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SettingsToggleProps {
  label: string;
  on: boolean;
  /** Settings endpoint that takes the whole body below. */
  endpoint: string;
  /** Request bodies for switching on and off; built on the server from the current values. */
  bodies: { on: object; off: object };
  disabled?: boolean;
}

/** A settings switch that saves as soon as it flips, then refreshes the page. */
export function SettingsToggle({ label, on, endpoint, bodies, disabled = false }: SettingsToggleProps) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [pending, setPending] = useState(false);

  async function flip() {
    const next = !value;
    setValue(next);
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next ? bodies.on : bodies.off),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That setting did not save.");
      toast.success(`${label}: ${next ? "on" : "off"}`);
      router.refresh();
    } catch (caught) {
      setValue(!next);
      toast.error(caught instanceof Error ? caught.message : "That setting did not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled || pending}
      onClick={() => void flip()}
      className={cn(
        "flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-60",
        value ? "justify-end bg-brand" : "justify-start bg-[#c3c9d3]"
      )}
    >
      <span className="size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(20,24,31,0.25)]" />
    </button>
  );
}
