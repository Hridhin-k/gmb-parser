"use client";

import Link from "next/link";
import { Check, ChevronDown, Phone, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { contactKindAvailable, type ResolutionContact, type ResolutionContactKind } from "@/lib/resolution-contact";

const KINDS: Array<{ kind: ResolutionContactKind; label: string }> = [
  { kind: "phone", label: "Phone" },
  { kind: "email", label: "Email" },
  { kind: "both", label: "Phone and email" },
];

const SETTINGS_HREF = "/settings?section=sla#resolution-contacts";

function kindDetail(kind: ResolutionContactKind, contact: ResolutionContact): string {
  if (!contactKindAvailable(kind, contact)) return "Not saved";
  if (kind === "phone") return contact.phone ?? "";
  if (kind === "email") return contact.email ?? "";
  return `${contact.phone} · ${contact.email}`;
}

function ContactKindItems({
  contact,
  onPick,
  verb,
}: {
  contact: ResolutionContact;
  onPick: (kind: ResolutionContactKind) => void;
  verb?: string;
}) {
  return (
    <>
      {KINDS.map(({ kind, label }) => {
        const available = contactKindAvailable(kind, contact);
        return (
          <DropdownMenuItem key={kind} disabled={!available} onClick={() => onPick(kind)} className="items-start py-1.5">
            <span className="w-4 shrink-0" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{verb ? `${verb} ${label.toLowerCase()}` : label}</span>
              <span className="truncate text-xs text-ink-3">{kindDetail(kind, contact)}</span>
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function MenuFooter({ contact, children }: { contact: ResolutionContact; children?: React.ReactNode }) {
  const none = !contact.phone && !contact.email;
  return (
    <p className="border-t border-line-2 px-1.5 pt-2 pb-1 text-xs leading-normal text-ink-3">
      {none ? (
        <>
          <Link href={SETTINGS_HREF} className="font-medium text-brand hover:underline">
            Set a resolution phone or email in Settings
          </Link>{" "}
          to add it to replies.
        </>
      ) : (
        <>
          {children}{" "}
          <Link href={SETTINGS_HREF} className="font-medium text-brand hover:underline">
            Change in Settings
          </Link>
        </>
      )}
    </p>
  );
}

interface ContactDraftButtonProps {
  /** "Draft with AI" or "Draft 12 replies with AI". */
  label: string;
  /** Menu wording for the plain option, e.g. "Draft 12 replies". */
  plainLabel: string;
  contact: ResolutionContact;
  disabled?: boolean;
  /** Soft (tinted) when drafts already exist; solid violet otherwise. */
  tone?: "solid" | "soft";
  onDraft: (contact: ResolutionContactKind | null) => void;
}

/**
 * Split button: the main part drafts in the brand voice as before, the
 * chevron opens the choice of ending every draft with the saved contact line.
 */
export function ContactDraftButton({ label, plainLabel, contact, disabled, tone = "solid", onDraft }: ContactDraftButtonProps) {
  const shell = cn(
    "inline-flex h-11 items-stretch overflow-hidden rounded-full border text-sm font-semibold",
    tone === "solid" ? "border-ai bg-ai text-white" : "border-ai-line bg-[#faf7ff] text-[#5b21b6]",
    disabled && "cursor-not-allowed opacity-40"
  );
  const part = cn(
    "inline-flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed",
    tone === "solid" ? "hover:bg-[#5b21b6]" : "hover:bg-ai-tint"
  );
  return (
    <div className={shell} role="group" aria-label={label}>
      <button type="button" disabled={disabled} onClick={() => onDraft(null)} className={cn(part, "px-[18px]")}>
        <Sparkles className="size-[15px]" aria-hidden />
        {label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label="More ways to draft"
          className={cn(part, "border-l px-3", tone === "solid" ? "border-white/35" : "border-ai-line")}
        >
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[340px]">
          <DropdownMenuItem onClick={() => onDraft(null)} className="items-start py-1.5">
            <Check className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden />
            <span className="flex flex-col">
              <span className="font-medium">{plainLabel}</span>
              <span className="text-xs text-ink-3">Brand voice only. No contact details in the reply.</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-ink-3 uppercase tracking-wide">Draft with contact details</DropdownMenuLabel>
            <ContactKindItems contact={contact} onPick={onDraft} />
          </DropdownMenuGroup>
          <MenuFooter contact={contact}>
            Adds one line to each draft: “You can reach us at … so we can resolve this with you.”
          </MenuFooter>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Trigger-only menu for screens that already have their own Draft button. */
export function ContactDraftMenuButton({
  contact,
  disabled,
  className,
  onDraft,
}: {
  contact: ResolutionContact;
  disabled?: boolean;
  className?: string;
  onDraft: (kind: ResolutionContactKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md border border-ai-line bg-[#faf7ff] px-3 text-sm font-medium text-[#5b21b6] outline-none hover:bg-ai-tint focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        Draft with contact details
        <ChevronDown className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px]">
        <DropdownMenuGroup>
          <ContactKindItems contact={contact} onPick={onDraft} />
        </DropdownMenuGroup>
        <MenuFooter contact={contact}>Adds “You can reach us at … so we can resolve this with you.” as the last line.</MenuFooter>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ContactChipProps {
  contact: ResolutionContact;
  /** The draft already ends with the contact line. */
  present: boolean;
  disabled?: boolean;
  onAdd: (kind: ResolutionContactKind) => void;
  onRemove: () => void;
}

/** Rewrite-row chip on an existing draft: adds, changes or removes the contact line without a new AI call. */
export function ContactChip({ contact, present, disabled, onAdd, onRemove }: ContactChipProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-50",
          present ? "bg-ai-tint text-ai hover:bg-ai-line" : "bg-paper text-ink-2 hover:bg-line-2"
        )}
      >
        <Phone className="size-3" aria-hidden />
        Contact details
        <ChevronDown className="size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[300px]">
        <DropdownMenuGroup>
          <ContactKindItems contact={contact} onPick={onAdd} verb="Add" />
        </DropdownMenuGroup>
        {present ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRemove}>Remove contact line</DropdownMenuItem>
          </>
        ) : null}
        <MenuFooter contact={contact}>Keeps the draft as it is and adds one line at the end. No new AI call.</MenuFooter>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small "Contact" tag for list rows and draft headers. */
export function ContactTag({ long = false }: { long?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-tint px-[7px] py-0.5 text-[11px] font-semibold text-info">
      <Phone className="size-2.5" aria-hidden />
      {long ? "Includes contact details" : "Contact"}
    </span>
  );
}
