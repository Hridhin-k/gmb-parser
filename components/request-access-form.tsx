"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequestAccessForm() {
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/platform/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.trim() || null, message: message.trim() || null }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not submit your request.");
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your request.");
      setState("error");
    }
  }

  if (state === "sent") {
    return <p className="mt-6 rounded-md border border-silver bg-paper px-3 py-2 text-sm text-graphite" role="status">Request sent. If the platform team approves it, sign in again with this email to create your organization.</p>;
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-2">
      <p className="text-sm font-medium text-graphite">Request access</p>
      <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company / organization (optional)" aria-label="Company" maxLength={255} />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything the platform team should know? (optional)" aria-label="Message" maxLength={1000} rows={3} className="w-full rounded-md border border-line px-2 py-2 text-sm" />
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      <Button type="submit" loading={state === "sending"} className="w-full">{state === "sending" ? "Sending…" : "Request access"}</Button>
    </form>
  );
}
