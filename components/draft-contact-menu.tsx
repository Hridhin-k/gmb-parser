"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { ResolutionContact, ResolutionContactSelection } from "@/lib/resolution-contact";
import { cn } from "@/lib/utils";

export function DraftContactMenu({ contact, disabled, onDraft, className }: {
  contact: ResolutionContact;
  disabled?: boolean;
  onDraft: (selection: ResolutionContactSelection) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [email, setEmail] = useState(false);
  const selection = { phone: phone && Boolean(contact.phone), email: email && Boolean(contact.email) };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="ai" disabled={disabled} className={cn("h-11 max-w-full", className)} />}>
        Draft with contact details
        <ChevronDown className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-4">
        <PopoverTitle>Draft with contact details</PopoverTitle>
        <PopoverDescription className="text-xs leading-relaxed text-ink-3">
          Choose the business details saved in Follow-ups to include in this reply.
        </PopoverDescription>
        {(["phone", "email"] as const).map((kind) => (
          <label key={kind} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-line p-3", !contact[kind] && "cursor-not-allowed bg-paper text-ink-3")}>
            <Checkbox
              className="mt-0.5"
              checked={selection[kind]}
              disabled={disabled || !contact[kind]}
              onCheckedChange={kind === "phone" ? setPhone : setEmail}
              aria-label={kind === "phone" ? "Include phone number" : "Include email address"}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{kind === "phone" ? "Phone number" : "Email address"}</span>
              <span className="mt-1 block break-all text-xs text-ink-3">{contact[kind] || "Not saved in Follow-ups"}</span>
            </span>
          </label>
        ))}
        {!contact.phone || !contact.email ? (
          <Link href="/settings?section=follow-ups" className="text-xs text-brand underline underline-offset-2">Add contact details in Follow-ups</Link>
        ) : null}
        <Button type="button" variant="ai" className="h-11 w-full" disabled={disabled || (!selection.phone && !selection.email)} onClick={() => {
          setOpen(false);
          onDraft(selection);
        }}>
          <Sparkles aria-hidden />
          Draft reply
        </Button>
        <p className="text-xs leading-relaxed text-ink-3">Review the draft before sending. Nothing is posted automatically.</p>
      </PopoverContent>
    </Popover>
  );
}
