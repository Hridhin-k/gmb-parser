"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
    return (
      <Banner tone="ok" title="Request sent." role="status">
        If the platform team approves it, sign in again with this email to create your workspace.
      </Banner>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-4">
      <p className="text-sm font-semibold text-ink">Request access from the platform team</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="request-company" className="text-[13px] font-medium text-ink">
          Company <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <Input
          id="request-company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Business or agency name"
          maxLength={255}
          className="bg-white"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="request-message" className="text-[13px] font-medium text-ink">
          Message <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <Textarea
          id="request-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Anything the platform team should know?"
          maxLength={1000}
          rows={3}
          className="bg-white"
        />
      </div>
      {error ? (
        <Banner tone="bad" title="Not sent.">
          {error}
        </Banner>
      ) : null}
      <Button type="submit" size="lg" loading={state === "sending"} className="w-full">
        {state === "sending" ? "Sending…" : "Request access"}
      </Button>
      <p className="text-xs text-ink-3">Your request goes to the platform team with the account shown above.</p>
    </form>
  );
}
