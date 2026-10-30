"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, FolderPlus, MapPin } from "lucide-react";
import type { HierarchyView } from "@/lib/services/hierarchy";
import { ROUTING_LEVELS } from "@/lib/hierarchy";
import { TONE_VOICES } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

async function post(body: unknown): Promise<{ error: string | null; id?: string }> {
  const response = await fetch("/api/locations/hierarchy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!response.ok) return { error: payload.error ?? "That did not save." };
  return { error: null, id: payload.id };
}

function settingLine(label: string, field: { value: string; source: string; overridden: boolean }) {
  return (
    <p className="text-sm text-graphite">
      <span className="font-medium">{label}:</span> {field.value}
      <span className="mt-0.5 block text-xs font-light text-slate">
        {field.overridden ? "Overridden" : `Inherited from ${field.source}`}
      </span>
    </p>
  );
}

function NavLink({
  href,
  active,
  children,
  indent = false,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  indent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        indent && "ml-2",
        active ? "bg-[#163a7a] text-white" : "text-slate hover:bg-[#f4f7fb] hover:text-ink"
      )}
    >
      {children}
    </Link>
  );
}

function Count({ value, active }: { value: number; active: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        active ? "bg-white/20 text-white" : "bg-[#eef2f7] text-[#5c6b82]"
      )}
    >
      {value}
    </span>
  );
}

export function HierarchyBoard({
  canManage,
  canEditRules = false,
  brands,
  tree,
}: {
  canManage: boolean;
  canEditRules?: boolean;
  brands: Array<{ id: string; name: string }>;
  tree: HierarchyView;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupClientId, setGroupClientId] = useState("");
  const [groupLocationIds, setGroupLocationIds] = useState<string[]>([]);
  const [groupManagerId, setGroupManagerId] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const selectedPanel = tree.selected;
  const location = selectedPanel?.kind === "location" ? selectedPanel.locations[0] : null;
  const settingsScope =
    selectedPanel?.kind === "brand"
      ? "client"
      : selectedPanel?.kind === "group"
        ? "group"
        : selectedPanel?.kind === "location"
          ? "location"
          : null;

  const contextClientId =
    selectedPanel?.clientId ??
    selectedPanel?.locations.find((row) => row.clientId)?.clientId ??
    (brands.length === 1 ? brands[0].id : null);
  const customGroups = tree.moveTargets.filter(
    (target) => !/All locations$/i.test(target.label.split(" › ").at(-1) ?? target.label)
  );
  const attentionTotal =
    tree.attention.expired + tree.attention.duplicates + tree.attention.unverified;

  async function run(body: unknown) {
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await post(body);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSelected([]);
    setNotice("Saved.");
    router.refresh();
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e6ebf2] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e6ebf2] px-5 py-4">
        <div>
          <h2 className="font-heading text-lg text-ink">Structure</h2>
          <p className="mt-1 text-sm text-slate">
            Pick an organisation or group to move shops, set managers, and override reply rules.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#163a7a] px-4 text-sm font-semibold text-white hover:bg-[#122f63]"
            onClick={() => {
              setCreating((open) => !open);
              setGroupClientId(contextClientId ?? brands[0]?.id ?? "");
              setError(null);
            }}
          >
            <FolderPlus className="h-4 w-4" aria-hidden />
            {creating ? "Close" : "New group"}
          </button>
        ) : null}
      </div>

      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav className="max-h-72 space-y-4 overflow-y-auto border-b border-[#e6ebf2] bg-[#f4f7fb]/50 p-4 lg:max-h-none lg:overflow-visible lg:border-b-0 lg:border-r">
          {attentionTotal > 0 && (
            <div className="space-y-2">
              <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#5c6b82]">
                Attention
              </p>
              <div className="flex flex-col gap-1">
                {tree.attention.expired > 0 && (
                  <NavLink
                    href="/locations?attention=expired"
                    active={selectedPanel?.kind === "attention" && selectedPanel.id === "expired"}
                  >
                    <span>Access expired</span>
                    <Count value={tree.attention.expired} active={selectedPanel?.id === "expired"} />
                  </NavLink>
                )}
                {tree.attention.duplicates > 0 && (
                  <NavLink
                    href="/locations?attention=duplicate"
                    active={selectedPanel?.kind === "attention" && selectedPanel.id === "duplicate"}
                  >
                    <span>Possible duplicates</span>
                    <Count
                      value={tree.attention.duplicates}
                      active={selectedPanel?.id === "duplicate"}
                    />
                  </NavLink>
                )}
                {tree.attention.unverified > 0 && (
                  <NavLink
                    href="/locations?attention=unverified"
                    active={selectedPanel?.kind === "attention" && selectedPanel.id === "unverified"}
                  >
                    <span>Unverified</span>
                    <Count
                      value={tree.attention.unverified}
                      active={selectedPanel?.id === "unverified"}
                    />
                  </NavLink>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#5c6b82]">
              Organisations
            </p>
            {tree.brands.map((brand) => {
              const brandActive = selectedPanel?.kind === "brand" && selectedPanel.id === brand.id;
              const ungroupedActive =
                selectedPanel?.kind === "ungrouped" && selectedPanel.id === brand.id;
              const ungroupedCount =
                tree.ungrouped.find((row) => row.clientId === brand.id)?.count ?? 0;
              return (
                <div key={brand.id} className="space-y-1">
                  <NavLink href={`/locations?brand=${brand.id}`} active={brandActive}>
                    <span className="truncate font-medium">{brand.name}</span>
                  </NavLink>
                  <NavLink
                    href={`/locations?ungrouped=${brand.id}`}
                    active={ungroupedActive}
                    indent
                  >
                    <span>Ungrouped</span>
                    <Count value={ungroupedCount} active={ungroupedActive} />
                  </NavLink>
                  {brand.regions.map((region) => {
                    const regionActive = selectedPanel?.id === region.id;
                    return (
                      <div key={region.id} className="space-y-1">
                        <NavLink
                          href={`/locations?group=${region.id}`}
                          active={regionActive}
                          indent
                        >
                          <span className="truncate">{region.name}</span>
                          <Count value={region.count} active={regionActive} />
                        </NavLink>
                        {region.cities.map((city) => {
                          const cityActive = selectedPanel?.id === city.id;
                          return (
                            <NavLink
                              key={city.id}
                              href={`/locations?group=${city.id}`}
                              active={cityActive}
                              indent
                            >
                              <span className="truncate pl-3">{city.name}</span>
                              <Count value={city.count} active={cityActive} />
                            </NavLink>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {tree.loose.length > 0 && (
            <div className="space-y-1">
              <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#5c6b82]">
                Other groups
              </p>
              {tree.loose.map((group) => {
                const active = selectedPanel?.id === group.id;
                return (
                  <NavLink key={group.id} href={`/locations?group=${group.id}`} active={active}>
                    <span className="truncate">{group.name}</span>
                    <Count value={group.count} active={active} />
                  </NavLink>
                );
              })}
            </div>
          )}
        </nav>

        <div className="min-w-0 space-y-5 p-5">
          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-[#e6ebf2] bg-[#f4f7fb] px-3 py-2 text-sm text-ink" role="status">
              {notice}
            </p>
          )}

          {canManage && creating && (
            <NewGroupForm
              brands={brands}
              places={tree.places}
              members={tree.members}
              pending={pending}
              name={groupName}
              clientId={groupClientId}
              locationIds={groupLocationIds}
              managerId={groupManagerId}
              query={locationQuery}
              onName={setGroupName}
              onClient={(clientId) => {
                setGroupClientId(clientId);
                setGroupLocationIds([]);
              }}
              onQuery={setLocationQuery}
              onToggleLocation={(locationId) =>
                setGroupLocationIds((current) =>
                  current.includes(locationId)
                    ? current.filter((id) => id !== locationId)
                    : [...current, locationId]
                )
              }
              onManager={setGroupManagerId}
              onSubmit={() => {
                const clientId = groupClientId || contextClientId || "";
                if (!groupName.trim()) {
                  setError("Enter a group name.");
                  return;
                }
                if (!clientId) {
                  setError("Choose an organisation.");
                  return;
                }
                if (groupLocationIds.length === 0) {
                  setError("Select at least one location.");
                  return;
                }
                void (async () => {
                  setPending(true);
                  setError(null);
                  setNotice(null);
                  const result = await post({
                    action: "create-group",
                    name: groupName.trim(),
                    kind: "region",
                    clientId,
                    parentId: null,
                    locationIds: groupLocationIds,
                    managerUserId: groupManagerId || null,
                  });
                  setPending(false);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setCreating(false);
                  setGroupName("");
                  setGroupLocationIds([]);
                  setGroupManagerId("");
                  setLocationQuery("");
                  setNotice("Group saved.");
                  if (result.id) router.push(`/locations?group=${result.id}`);
                  router.refresh();
                })();
              }}
            />
          )}

          {selectedPanel ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#e6ebf2] bg-[#f4f7fb]/60 px-4 py-3">
                <p className="text-xs font-light text-[#5c6b82]">{selectedPanel.path}</p>
                <h3 className="mt-0.5 font-heading text-xl text-ink">{selectedPanel.title}</h3>
                <p className="mt-1 text-sm text-slate">
                  {selectedPanel.locations.length} location
                  {selectedPanel.locations.length === 1 ? "" : "s"} in this view
                </p>
              </div>

              {canManage && selectedPanel.kind !== "location" && selectedPanel.locations.length > 0 && (
                <form
                  className="flex flex-wrap items-end gap-2 rounded-xl border border-[#e6ebf2] bg-white p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (selected.length === 0) {
                      setError("Tick at least one shop in the list below.");
                      return;
                    }
                    const groupId = String(new FormData(event.currentTarget).get("groupId") ?? "");
                    void run({
                      action: "move",
                      locationIds: selected,
                      groupId: groupId || null,
                      confirmHold: true,
                    });
                  }}
                >
                  <label className="min-w-[14rem] flex-1 text-xs text-slate">
                    Put {selected.length || "selected"} shop{selected.length === 1 ? "" : "s"} in
                    <select
                      name="groupId"
                      required
                      className="mt-1 block h-10 w-full rounded-full border border-[#e6ebf2] bg-white px-3 text-sm"
                    >
                      <option value="" disabled>
                        Choose a group…
                      </option>
                      {tree.moveTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={pending || selected.length === 0}
                    className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Move {selected.length || ""}
                  </button>
                  {selectedPanel.kind === "group" && (
                    <button
                      type="button"
                      disabled={pending || selected.length === 0}
                      className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm disabled:opacity-40"
                      onClick={() =>
                        void run({
                          action: "move",
                          locationIds: selected,
                          groupId: null,
                          confirmHold: true,
                        })
                      }
                    >
                      Remove from group
                    </button>
                  )}
                  {customGroups.length === 0 && (
                    <p className="basis-full text-xs font-light text-slate">
                      No custom groups yet — create one above, then move shops into it.
                    </p>
                  )}
                </form>
              )}

              {selectedPanel.locations.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-[#e6ebf2]">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-[#f4f7fb] text-xs uppercase tracking-wide text-[#5c6b82]">
                      <tr>
                        {canManage && selectedPanel.kind !== "location" && (
                          <th className="px-3 py-2.5" />
                        )}
                        <th className="px-3 py-2.5 font-semibold">Code</th>
                        <th className="px-3 py-2.5 font-semibold">Location</th>
                        <th className="px-3 py-2.5 font-semibold">Group</th>
                        <th className="px-3 py-2.5 font-semibold">Tags</th>
                        <th className="px-3 py-2.5 font-semibold">Rating</th>
                        <th className="px-3 py-2.5 font-semibold">Google</th>
                        <th className="px-3 py-2.5 font-semibold">Manager</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPanel.locations.map((row) => (
                        <tr key={row.id} className="border-t border-[#e6ebf2] hover:bg-[#f4f7fb]/60">
                          {canManage && selectedPanel.kind !== "location" && (
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={selected.includes(row.id)}
                                onChange={(event) =>
                                  setSelected((current) =>
                                    event.target.checked
                                      ? [...current, row.id]
                                      : current.filter((id) => id !== row.id)
                                  )
                                }
                                aria-label={`Select ${row.name}`}
                              />
                            </td>
                          )}
                          <td className="px-3 py-2.5 text-slate">{row.storeCode || "—"}</td>
                          <td className="px-3 py-2.5">
                            <Link
                              className="font-medium text-[#163a7a] underline-offset-2 hover:underline"
                              href={`/locations?location=${row.id}`}
                            >
                              {row.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-slate">{row.subgroup || "Ungrouped"}</td>
                          <td className="px-3 py-2.5 text-slate">
                            {row.tags.length > 0 ? row.tags.join(", ") : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-slate">
                            {row.rating === null ? "—" : row.rating.toFixed(1)}
                          </td>
                          <td className="px-3 py-2.5">
                            {row.connection.href ? (
                              <Link
                                className="text-[#163a7a] underline-offset-2 hover:underline"
                                href={row.connection.href}
                              >
                                {row.connection.label} · Reconnect
                              </Link>
                            ) : (
                              <span className="text-slate">{row.connection.label}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate">{row.managerLabel || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedPanel.locations.length === 0 &&
                (selectedPanel.kind === "group" || selectedPanel.kind === "ungrouped") && (
                  <p className="rounded-xl border border-dashed border-[#e6ebf2] px-4 py-6 text-sm text-slate">
                    {selectedPanel.kind === "ungrouped"
                      ? "Every location in this organisation is already in a group."
                      : "This group has no locations. Add some below, or remove the empty group."}
                  </p>
                )}

              {canManage && selectedPanel.kind === "group" && (
                <AddLocations
                  pending={pending}
                  places={tree.places.filter(
                    (place) =>
                      place.clientId === selectedPanel.clientId &&
                      !selectedPanel.locations.some((row) => row.id === place.id)
                  )}
                  onAdd={(locationIds) =>
                    void run({
                      action: "move",
                      locationIds,
                      groupId: selectedPanel.id,
                      confirmHold: true,
                    })
                  }
                />
              )}

              {canManage && selectedPanel.kind === "group" && (
                <div className="flex flex-wrap gap-2">
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = String(new FormData(event.currentTarget).get("name") ?? "");
                      void run({ action: "rename-group", groupId: selectedPanel.id, name });
                    }}
                  >
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="Rename group"
                      className="h-10 rounded-full border border-[#e6ebf2] px-3 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={pending}
                      className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm"
                    >
                      Rename
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={pending}
                    className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm"
                    onClick={() => void run({ action: "remove-group", groupId: selectedPanel.id })}
                  >
                    Remove if empty
                  </button>
                </div>
              )}

              {selectedPanel.settings && (
                <details className="rounded-xl border border-[#e6ebf2] bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-graphite">
                    Reply rules for this place
                  </summary>
                  <div className="space-y-4 border-t border-[#e6ebf2] px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {settingLine("Reply tone", selectedPanel.settings.tone)}
                      {settingLine("Automation", selectedPanel.settings.automation)}
                      {settingLine("SLA", selectedPanel.settings.sla)}
                      {settingLine("Routing", selectedPanel.settings.routing)}
                    </div>
                    {(canManage || canEditRules) && settingsScope && (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const tone = String(form.get("tone") ?? "");
                          const sla = String(form.get("sla") ?? "");
                          const routing = String(form.get("routing") ?? "");
                          const drafts = String(form.get("drafts") ?? "");
                          void run({
                            action: "settings",
                            scope: settingsScope,
                            targetId: selectedPanel.id,
                            toneVoice: tone || null,
                            toneNote: String(form.get("note") ?? "") || null,
                            slaHours: sla ? Number(sla) : null,
                            routingLevel: routing || null,
                            draftsPaused: drafts === "" ? null : drafts === "paused",
                          });
                        }}
                      >
                        <label className="text-xs text-slate">
                          Tone
                          <select
                            name="tone"
                            defaultValue={selectedPanel.settings.own.toneVoice ?? ""}
                            className="mt-1 block h-10 rounded-full border border-[#e6ebf2] px-3 text-sm"
                          >
                            <option value="">Inherit</option>
                            {TONE_VOICES.map((voice) => (
                              <option key={voice} value={voice}>
                                {voice}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate">
                          Tone note
                          <input
                            name="note"
                            defaultValue={selectedPanel.settings.own.toneNote ?? ""}
                            maxLength={500}
                            className="mt-1 block h-10 rounded-full border border-[#e6ebf2] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate">
                          SLA hours
                          <input
                            name="sla"
                            type="number"
                            min={1}
                            max={168}
                            defaultValue={selectedPanel.settings.own.slaHours ?? ""}
                            placeholder="Inherit"
                            className="mt-1 block h-10 w-28 rounded-full border border-[#e6ebf2] px-3 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate">
                          Routing
                          <select
                            name="routing"
                            defaultValue={selectedPanel.settings.own.routingLevel ?? ""}
                            className="mt-1 block h-10 rounded-full border border-[#e6ebf2] px-3 text-sm"
                          >
                            <option value="">Inherit</option>
                            {ROUTING_LEVELS.map((level) => (
                              <option key={level.id} value={level.id}>
                                {level.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate">
                          Drafts
                          <select
                            name="drafts"
                            defaultValue={
                              selectedPanel.settings.own.draftsPaused === null
                                ? ""
                                : selectedPanel.settings.own.draftsPaused
                                  ? "paused"
                                  : "open"
                            }
                            className="mt-1 block h-10 rounded-full border border-[#e6ebf2] px-3 text-sm"
                          >
                            <option value="">Inherit</option>
                            <option value="paused">Paused</option>
                            <option value="open">Someone asks for a draft</option>
                          </select>
                        </label>
                        <button
                          type="submit"
                          disabled={pending}
                          className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white"
                        >
                          Save
                        </button>
                      </form>
                    )}
                    {canManage &&
                      selectedPanel.kind === "group" &&
                      tree.moveTargets.some((t) => t.id !== selectedPanel.id) && (
                        <form
                          className="flex flex-wrap gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const targetId = String(
                              new FormData(event.currentTarget).get("targetId") ?? ""
                            );
                            void run({
                              action: "merge-groups",
                              sourceId: selectedPanel.id,
                              targetId,
                            });
                          }}
                        >
                          <select
                            name="targetId"
                            className="h-10 max-w-full rounded-full border border-[#e6ebf2] px-3 text-sm"
                          >
                            {tree.moveTargets
                              .filter((target) => target.id !== selectedPanel.id)
                              .map((target) => (
                                <option key={target.id} value={target.id}>
                                  Merge into {target.label}
                                </option>
                              ))}
                          </select>
                          <button
                            type="submit"
                            disabled={pending}
                            className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm"
                          >
                            Merge groups
                          </button>
                        </form>
                      )}
                  </div>
                </details>
              )}

              {canManage && location && (
                <div className="space-y-3 rounded-xl border border-[#e6ebf2] p-4">
                  <p className="text-sm font-medium text-ink">Location details</p>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const next = tagDraft.trim();
                      const tags = next ? [...location.tags, next] : location.tags;
                      setTagDraft("");
                      void run({ action: "tags", locationId: location.id, tags });
                    }}
                  >
                    <label className="text-xs text-slate">
                      Add tag
                      <input
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        maxLength={40}
                        className="mt-1 block h-10 rounded-full border border-[#e6ebf2] px-3 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={pending}
                      className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm"
                    >
                      Add tag
                    </button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {location.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="rounded-full bg-[#f4f7fb] px-3 py-1 text-xs text-ink ring-1 ring-[#e6ebf2]"
                        onClick={() =>
                          void run({
                            action: "tags",
                            locationId: location.id,
                            tags: location.tags.filter((item) => item !== tag),
                          })
                        }
                      >
                        {tag} · Remove
                      </button>
                    ))}
                  </div>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const managerUserId = String(
                        new FormData(event.currentTarget).get("managerUserId") ?? ""
                      );
                      void run({
                        action: "manager",
                        locationId: location.id,
                        managerUserId: managerUserId || null,
                      });
                    }}
                  >
                    <label className="text-xs text-slate">
                      Store manager
                      <select
                        name="managerUserId"
                        defaultValue={location.managerUserId ?? ""}
                        className="mt-1 block h-10 max-w-full rounded-full border border-[#e6ebf2] px-3 text-sm"
                      >
                        <option value="">No manager</option>
                        {tree.members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={pending}
                      className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm"
                    >
                      Assign
                    </button>
                  </form>
                  {(location.connection.kind === "duplicate" ||
                    location.connection.kind === "connected" ||
                    location.connection.kind === "expired") && (
                    <button
                      type="button"
                      disabled={pending}
                      className="h-10 rounded-full border border-[#e6ebf2] px-4 text-sm"
                      onClick={() =>
                        void run({
                          action: "duplicate",
                          locationId: location.id,
                          duplicate: location.connection.kind !== "duplicate",
                        })
                      }
                    >
                      {location.connection.kind === "duplicate"
                        ? "Clear duplicate mark"
                        : "Mark as duplicate"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e6ebf2] bg-[#f4f7fb]/40 px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white ring-1 ring-[#e6ebf2]">
                <Building2 className="h-5 w-5 text-[#163a7a]" aria-hidden />
              </div>
              <p className="mt-4 font-heading text-lg text-ink">Choose an organisation</p>
              <p className="mt-1 max-w-sm text-sm text-slate">
                Pick a client on the left to see its shops and groups, then move locations or create a
                new group.
              </p>
              {brands[0] ? (
                <Link
                  href={`/locations?brand=${brands[0].id}`}
                  className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#163a7a] px-4 text-sm font-semibold text-white"
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Open {brands[0].name}
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function NewGroupForm({
  brands,
  places,
  members,
  pending,
  name,
  clientId,
  locationIds,
  managerId,
  query,
  onName,
  onClient,
  onQuery,
  onToggleLocation,
  onManager,
  onSubmit,
}: {
  brands: Array<{ id: string; name: string }>;
  places: HierarchyView["places"];
  members: HierarchyView["members"];
  pending: boolean;
  name: string;
  clientId: string;
  locationIds: string[];
  managerId: string;
  query: string;
  onName: (value: string) => void;
  onClient: (value: string) => void;
  onQuery: (value: string) => void;
  onToggleLocation: (locationId: string) => void;
  onManager: (value: string) => void;
  onSubmit: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const choices = places.filter((place) => {
    if (place.clientId !== clientId) return false;
    if (!needle) return true;
    return (
      place.name.toLowerCase().includes(needle) ||
      (place.groupName ?? "").toLowerCase().includes(needle)
    );
  });
  const chosen = places.filter((place) => locationIds.includes(place.id));
  return (
    <form
      className="space-y-4 rounded-xl border border-[#163a7a]/20 bg-[#f4f7fb] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <p className="font-heading text-base text-ink">New group</p>
        <p className="mt-1 text-sm text-slate">
          Name the group, pick locations, then save. Each location stays in one group.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate">
          Group name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => onName(event.target.value)}
            className="mt-1 block h-10 w-full rounded-full border border-[#e6ebf2] bg-white px-3 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-slate">
          Organisation
          <select
            required
            value={clientId}
            onChange={(event) => onClient(event.target.value)}
            className="mt-1 block h-10 w-full rounded-full border border-[#e6ebf2] bg-white px-3 text-sm"
          >
            <option value="">Choose…</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-xs text-slate">
        Find a location
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Name or current group"
          className="mt-1 block h-10 w-full rounded-full border border-[#e6ebf2] bg-white px-3 text-sm text-ink"
        />
      </label>
      <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-[#e6ebf2] bg-white p-2">
        {choices.length === 0 && (
          <li className="px-2 py-2 text-sm text-slate">No locations in this organisation match.</li>
        )}
        {choices.map((place) => (
          <li key={place.id}>
            <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[#f4f7fb]">
              <input
                type="checkbox"
                checked={locationIds.includes(place.id)}
                onChange={() => onToggleLocation(place.id)}
              />
              <span className="text-ink">{place.name}</span>
              <span className="ml-auto text-xs text-slate">{place.groupName ?? "Ungrouped"}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-sm text-graphite">
        {chosen.length === 0
          ? "Select at least one location. Each location stays in one group, and its reviews stay on that location."
          : `${chosen.length} location${chosen.length === 1 ? "" : "s"}: ${chosen
              .slice(0, 6)
              .map((place) => place.name)
              .join(", ")}${chosen.length > 6 ? `, and ${chosen.length - 6} more` : ""}. Saving moves them into this group.`}
      </p>
      <label className="block text-xs text-slate">
        Store manager (optional)
        <select
          value={managerId}
          onChange={(event) => onManager(event.target.value)}
          className="mt-1 block h-10 max-w-full rounded-full border border-[#e6ebf2] bg-white px-3 text-sm"
        >
          <option value="">No manager</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-full bg-[#163a7a] px-4 text-sm font-semibold text-white disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save group"}
      </button>
    </form>
  );
}

function AddLocations({
  places,
  pending,
  onAdd,
}: {
  places: HierarchyView["places"];
  pending: boolean;
  onAdd: (locationIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const needle = query.trim().toLowerCase();
  const choices = places.filter((place) => {
    if (!needle) return true;
    return (
      place.name.toLowerCase().includes(needle) ||
      (place.groupName ?? "").toLowerCase().includes(needle)
    );
  });
  if (places.length === 0) return null;
  return (
    <form
      className="space-y-3 rounded-xl border border-[#e6ebf2] bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (picked.length === 0) return;
        onAdd(picked);
        setPicked([]);
      }}
    >
      <p className="text-sm font-medium text-ink">Add locations</p>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search locations in this organisation"
        className="block h-10 w-full rounded-full border border-[#e6ebf2] px-3 text-sm"
      />
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {choices.map((place) => (
          <li key={place.id}>
            <label className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-[#f4f7fb]">
              <input
                type="checkbox"
                checked={picked.includes(place.id)}
                onChange={() =>
                  setPicked((current) =>
                    current.includes(place.id)
                      ? current.filter((id) => id !== place.id)
                      : [...current, place.id]
                  )
                }
              />
              <span>{place.name}</span>
              <span className="ml-auto text-xs text-slate">{place.groupName ?? "Ungrouped"}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="submit"
        disabled={pending || picked.length === 0}
        className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
      >
        Add {picked.length || ""} to this group
      </button>
    </form>
  );
}
