"use client";

import { useRouter } from "next/navigation";

const KIND_LABEL = { workspace: "Workspace", client: "Business", group: "Group", location: "Location" } as const;

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
}: {
  section: string;
  current: { kind: "workspace" } | { kind: "client" | "group" | "location"; id: string };
  choices: SettingsScopeChoice[];
}) {
  const router = useRouter();
  const value = current.kind === "workspace" ? "workspace" : `${current.kind}:${current.id}`;
  const businesses = choices.filter((choice) => choice.kind === "client");
  const places = choices.filter((choice) => choice.kind !== "client");
  return (
    <label className="flex h-[38px] min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-ink-3">
      <span className="shrink-0 whitespace-nowrap">Applies to</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          const query = next && next !== "workspace" ? `&scope=${next}` : "";
          router.push(`/settings?section=${section}${query}`);
        }}
        className="min-w-0 flex-1 truncate border-0 sm:max-w-[14rem] bg-transparent text-[13px] font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
      >
        <option value="workspace">All businesses</option>
        {businesses.map((choice) => (
          <option key={choice.id} value={`client:${choice.id}`}>
            {choice.label}
          </option>
        ))}
        {places.length > 0 ? (
          <optgroup label="Groups and locations">
            {places.map((choice) => (
              <option key={`${choice.kind}:${choice.id}`} value={`${choice.kind}:${choice.id}`}>
                {KIND_LABEL[choice.kind]} · {choice.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
