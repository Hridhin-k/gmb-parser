"use client";

import { useRouter } from "next/navigation";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";

const KIND_LABEL = { workspace: "Workspace", client: "Business", group: "Group", location: "Location" } as const;
type Kind = keyof typeof KIND_LABEL;

export interface SettingsScopeChoice {
  id: string;
  label: string;
  kind: "client" | "group" | "location";
}

/**
 * "Applies to" control for settings that can be overridden per business, group or location.
 * Navigates with ?scope=kind:id, keeping the current section.
 */
export function SettingsScopePicker({
  section,
  current,
  choices,
  appliesTo,
}: {
  section: string;
  current: { kind: "workspace" } | { kind: "client" | "group" | "location"; id: string };
  choices: SettingsScopeChoice[];
  appliesTo: string;
}) {
  const router = useRouter();
  const value = current.kind === "workspace" ? "workspace" : `${current.kind}:${current.id}`;
  const options = [
    { value: "workspace", label: "Workspace defaults" },
    ...choices.map((choice) => ({ value: `${choice.kind}:${choice.id}`, label: `${KIND_LABEL[choice.kind]} · ${choice.label}` })),
  ];
  const chain: Kind[] = ["workspace", "client", "group", "location"];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-white px-3 py-2.5 md:flex-row md:items-center md:gap-3">
      <span className="shrink-0 text-xs font-medium text-ink-2">Applies to</span>
      <SelectField
        label="Settings apply to"
        value={value}
        options={options}
        size="sm"
        className="md:w-72"
        onValueChange={(next) => {
          const query = next && next !== "workspace" ? `&scope=${next}` : "";
          router.push(`/settings?section=${section}${query}`);
        }}
      />
      <p className="min-w-0 flex-1 text-xs text-ink-3">
        <span className="mr-1.5 inline-flex flex-wrap items-center gap-1" aria-label="Inheritance order">
          {chain.map((kind, index) => (
            <span key={kind} className="inline-flex items-center gap-1">
              {index > 0 ? <span aria-hidden>→</span> : null}
              <span className={cn(kind === current.kind ? "font-semibold text-ink" : undefined)}>{KIND_LABEL[kind]}</span>
            </span>
          ))}
        </span>
        <span className="block md:inline">Applies to {appliesTo}.</span>
      </p>
    </div>
  );
}
