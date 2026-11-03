"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AssignableMember {
  userId: string;
  name: string;
}

/**
 * "Assign" on a suggested action: pick a teammate, or take it back. Saved
 * on the server so everyone sees who is looking after it.
 */
export function InsightAssign({
  actionId,
  title,
  members,
  assigneeId,
  canAssign,
}: {
  actionId: string;
  title: string;
  members: AssignableMember[];
  assigneeId: string | null;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(assigneeId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const assignee = members.find((member) => member.userId === current) ?? null;

  function assign(next: string | null) {
    setError(null);
    const before = current;
    setCurrent(next);
    startTransition(async () => {
      const response = await fetch("/api/insights/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, title, assigneeId: next }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setCurrent(before);
        setError(payload.error ?? "Could not assign this.");
        return;
      }
      router.refresh();
    });
  }

  const label = assignee ? `Assigned to ${assignee.name}` : "Assign";
  const tone = assignee ? "border-ok-line bg-ok-tint text-ok" : "border-line bg-white text-ink";
  if (!canAssign) {
    return assignee ? (
      <span className={`inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium ${tone}`}>{label}</span>
    ) : null;
  }
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className={`inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium hover:border-ink-3 disabled:opacity-60 ${tone}`}
        >
          {pending ? "Saving…" : label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Who looks after this?</DropdownMenuLabel>
            {members.map((member) => (
              <DropdownMenuItem key={member.userId} onClick={() => assign(member.userId)}>
                <span className="flex-1">{member.name}</span>
                {member.userId === current ? <Check aria-hidden className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {current ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => assign(null)}>Unassign</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? <span className="text-xs text-bad">{error}</span> : null}
    </span>
  );
}
