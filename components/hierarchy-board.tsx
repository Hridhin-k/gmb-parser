"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HierarchyView } from "@/lib/services/hierarchy";
import { ROUTING_LEVELS } from "@/lib/hierarchy";
import { TONE_VOICES } from "@/lib/onboarding";

async function post(body: unknown): Promise<string | null> {
  const response = await fetch("/api/locations/hierarchy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) return payload.error ?? "That did not save.";
  return null;
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
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const selectedPanel = tree.selected;
  const location = selectedPanel?.kind === "location" ? selectedPanel.locations[0] : null;
  const settingsScope =
    selectedPanel?.kind === "brand" ? "client" : selectedPanel?.kind === "group" ? "group" : selectedPanel?.kind === "location" ? "location" : null;

  const contextClientId =
    selectedPanel?.clientId ??
    selectedPanel?.locations.find((row) => row.clientId)?.clientId ??
    (brands.length === 1 ? brands[0].id : null);
  const contextBrandName = contextClientId ? brands.find((b) => b.id === contextClientId)?.name : null;
  const customGroups = tree.moveTargets.filter((target) => !/All locations$/i.test(target.label.split(" › ").at(-1) ?? target.label));

  async function run(body: unknown) {
    setPending(true);
    setError(null);
    const message = await post(body);
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    setSelected([]);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="space-y-4 text-sm">
        {(tree.attention.expired > 0 || tree.attention.duplicates > 0 || tree.attention.unverified > 0) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {tree.attention.expired > 0 && (
              <Link className="rounded-full bg-paper px-2.5 py-1 text-ink" href="/clients?attention=expired">
                Access expired {tree.attention.expired}
              </Link>
            )}
            {tree.attention.duplicates > 0 && (
              <Link className="rounded-full bg-paper px-2.5 py-1 text-ink" href="/clients?attention=duplicate">
                Possible duplicates {tree.attention.duplicates}
              </Link>
            )}
            {tree.attention.unverified > 0 && (
              <Link className="rounded-full bg-paper px-2.5 py-1 text-ink" href="/clients?attention=unverified">
                Unverified {tree.attention.unverified}
              </Link>
            )}
          </div>
        )}
        {tree.brands.map((brand) => (
          <div key={brand.id}>
            <Link className="font-medium text-graphite hover:text-ink" href={`/clients?brand=${brand.id}`}>
              {brand.name}
            </Link>
            <ul className="mt-1 space-y-1 border-l border-silver pl-3">
              {brand.regions.map((region) => (
                <li key={region.id}>
                  <Link className="text-slate hover:text-ink" href={`/clients?group=${region.id}`}>
                    {region.name} · {region.count}
                  </Link>
                  <ul className="mt-1 space-y-1 pl-3">
                    {region.cities.map((city) => (
                      <li key={city.id}>
                        <Link className="text-slate hover:text-ink" href={`/clients?group=${city.id}`}>
                          {city.name} · {city.count}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {tree.loose.length > 0 && (
          <div>
            <p className="font-medium text-graphite">Other groups</p>
            <ul className="mt-1 space-y-1 border-l border-silver pl-3">
              {tree.loose.map((group) => (
                <li key={group.id}>
                  <Link className="text-slate hover:text-ink" href={`/clients?group=${group.id}`}>
                    {group.name} · {group.count}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="min-w-0 space-y-6">
        {error && <p className="text-sm text-ink">{error}</p>}

        {canManage && (
          <section className="space-y-3 rounded-2xl border border-silver bg-paper/60 p-4">
            <p className="text-sm text-graphite">
              <span className="font-medium text-ink">Three steps:</span> name a group → tick shops → put them in that group.
            </p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const formEl = event.currentTarget;
                const form = new FormData(formEl);
                const clientId = String(form.get("clientId") || contextClientId || "");
                if (!clientId) {
                  setError("Pick a client first (click Fazyo or another brand on the left).");
                  return;
                }
                void (async () => {
                  setPending(true);
                  setError(null);
                  const message = await post({
                    action: "create-group",
                    name: String(form.get("name") ?? ""),
                    kind: "region",
                    clientId,
                    parentId: null,
                  });
                  setPending(false);
                  if (message) {
                    setError(message);
                    return;
                  }
                  formEl.reset();
                  setSelected([]);
                  router.refresh();
                })();
              }}
            >
              <label className="min-w-[12rem] flex-1 text-xs text-slate">
                New group name
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder={contextBrandName ? `e.g. ${contextBrandName} south` : "e.g. South region"}
                  className="mt-1 block h-10 w-full rounded-full border border-silver bg-white px-3 text-sm text-ink"
                />
              </label>
              {contextClientId ? (
                <input type="hidden" name="clientId" value={contextClientId} />
              ) : (
                <label className="text-xs text-slate">
                  Client
                  <select name="clientId" required className="mt-1 block h-10 max-w-full rounded-full border border-silver bg-white px-3 text-sm">
                    <option value="">Choose…</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="submit" disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
                Create group
              </button>
            </form>
            {contextBrandName && (
              <p className="text-xs font-light text-slate">Creates under {contextBrandName}. Click another client on the left to switch.</p>
            )}
          </section>
        )}

        {selectedPanel && (
          <section className="space-y-4">
            <div>
              <p className="text-xs font-light text-slate">{selectedPanel.path}</p>
              <h2 className="text-lg font-medium text-graphite">{selectedPanel.title}</h2>
            </div>

            {canManage && selectedPanel.kind !== "location" && selectedPanel.locations.length > 0 && (
              <form
                className="flex flex-wrap items-end gap-2 rounded-2xl border border-silver bg-white p-3"
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
                  <select name="groupId" required className="mt-1 block h-10 w-full rounded-full border border-silver px-3 text-sm">
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
                <button type="submit" disabled={pending || selected.length === 0} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40">
                  Move {selected.length || ""}
                </button>
                {customGroups.length === 0 && (
                  <p className="basis-full text-xs font-light text-slate">No custom groups yet — create one above, then move shops into it.</p>
                )}
              </form>
            )}

            {selectedPanel.locations.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="text-xs text-slate">
                    <tr>
                      {canManage && selectedPanel.kind !== "location" && <th className="py-2 pr-2" />}
                      <th className="py-2 pr-3 font-medium">Location</th>
                      <th className="py-2 pr-3 font-medium">Group</th>
                      <th className="py-2 pr-3 font-medium">Google</th>
                      <th className="py-2 font-medium">Manager</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPanel.locations.map((row) => (
                      <tr key={row.id} className="border-t border-silver">
                        {canManage && selectedPanel.kind !== "location" && (
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={selected.includes(row.id)}
                              onChange={(event) =>
                                setSelected((current) =>
                                  event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)
                                )
                              }
                              aria-label={`Select ${row.name}`}
                            />
                          </td>
                        )}
                        <td className="py-2 pr-3">
                          <Link className="text-ink underline-offset-2 hover:underline" href={`/clients?location=${row.id}`}>
                            {row.name}
                          </Link>
                          {row.storeCode ? <span className="mt-0.5 block text-xs text-slate">{row.storeCode}</span> : null}
                        </td>
                        <td className="py-2 pr-3 text-slate">{row.subgroup || "—"}</td>
                        <td className="py-2 pr-3">
                          {row.connection.href ? (
                            <Link className="text-ink underline-offset-2 hover:underline" href={row.connection.href}>
                              {row.connection.label} · Reconnect
                            </Link>
                          ) : (
                            row.connection.label
                          )}
                        </td>
                        <td className="py-2">{row.managerLabel || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedPanel.locations.length === 0 && selectedPanel.kind === "group" && (
              <p className="text-sm text-slate">This group is empty. Open All locations, tick shops, and move them here.</p>
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
                  <input name="name" required maxLength={120} placeholder="Rename group" className="h-10 rounded-full border border-silver px-3 text-sm" />
                  <button type="submit" disabled={pending} className="h-10 rounded-full border border-silver px-4 text-sm">
                    Rename
                  </button>
                </form>
                <button type="button" disabled={pending} className="h-10 rounded-full border border-silver px-4 text-sm" onClick={() => void run({ action: "remove-group", groupId: selectedPanel.id })}>
                  Remove if empty
                </button>
              </div>
            )}

            {selectedPanel.settings && (
              <details className="rounded-2xl border border-silver">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-graphite">Reply rules for this place</summary>
                <div className="space-y-4 border-t border-silver px-4 py-4">
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
                        <select name="tone" defaultValue={selectedPanel.settings.own.toneVoice ?? ""} className="mt-1 block h-10 rounded-full border border-silver px-3 text-sm">
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
                        <input name="note" defaultValue={selectedPanel.settings.own.toneNote ?? ""} maxLength={500} className="mt-1 block h-10 rounded-full border border-silver px-3 text-sm" />
                      </label>
                      <label className="text-xs text-slate">
                        SLA hours
                        <input name="sla" type="number" min={1} max={168} defaultValue={selectedPanel.settings.own.slaHours ?? ""} placeholder="Inherit" className="mt-1 block h-10 w-28 rounded-full border border-silver px-3 text-sm" />
                      </label>
                      <label className="text-xs text-slate">
                        Routing
                        <select name="routing" defaultValue={selectedPanel.settings.own.routingLevel ?? ""} className="mt-1 block h-10 rounded-full border border-silver px-3 text-sm">
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
                        <select name="drafts" defaultValue={selectedPanel.settings.own.draftsPaused === null ? "" : selectedPanel.settings.own.draftsPaused ? "paused" : "open"} className="mt-1 block h-10 rounded-full border border-silver px-3 text-sm">
                          <option value="">Inherit</option>
                          <option value="paused">Paused</option>
                          <option value="open">Someone asks for a draft</option>
                        </select>
                      </label>
                      <button type="submit" disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
                        Save
                      </button>
                    </form>
                  )}
                  {canManage && selectedPanel.kind === "group" && tree.moveTargets.some((t) => t.id !== selectedPanel.id) && (
                    <form
                      className="flex flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const targetId = String(new FormData(event.currentTarget).get("targetId") ?? "");
                        void run({ action: "merge-groups", sourceId: selectedPanel.id, targetId });
                      }}
                    >
                      <select name="targetId" className="h-10 max-w-full rounded-full border border-silver px-3 text-sm">
                        {tree.moveTargets
                          .filter((target) => target.id !== selectedPanel.id)
                          .map((target) => (
                            <option key={target.id} value={target.id}>
                              Merge into {target.label}
                            </option>
                          ))}
                      </select>
                      <button type="submit" disabled={pending} className="h-10 rounded-full border border-silver px-4 text-sm">
                        Merge groups
                      </button>
                    </form>
                  )}
                </div>
              </details>
            )}

            {canManage && location && (
              <div className="space-y-3">
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
                    <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} maxLength={40} className="mt-1 block h-10 rounded-full border border-silver px-3 text-sm" />
                  </label>
                  <button type="submit" disabled={pending} className="h-10 rounded-full border border-silver px-4 text-sm">
                    Add tag
                  </button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {location.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded-full bg-paper px-3 py-1 text-xs text-ink"
                      onClick={() => void run({ action: "tags", locationId: location.id, tags: location.tags.filter((item) => item !== tag) })}
                    >
                      {tag} · Remove
                    </button>
                  ))}
                </div>
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const managerUserId = String(new FormData(event.currentTarget).get("managerUserId") ?? "");
                    void run({ action: "manager", locationId: location.id, managerUserId: managerUserId || null });
                  }}
                >
                  <label className="text-xs text-slate">
                    Store manager
                    <select name="managerUserId" defaultValue={location.managerUserId ?? ""} className="mt-1 block h-10 max-w-full rounded-full border border-silver px-3 text-sm">
                      <option value="">No manager</option>
                      {tree.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={pending} className="h-10 rounded-full border border-silver px-4 text-sm">
                    Assign
                  </button>
                </form>
                {(location.connection.kind === "duplicate" || location.connection.kind === "connected" || location.connection.kind === "expired") && (
                  <button
                    type="button"
                    disabled={pending}
                    className="h-10 rounded-full border border-silver px-4 text-sm"
                    onClick={() =>
                      void run({
                        action: "duplicate",
                        locationId: location.id,
                        duplicate: location.connection.kind !== "duplicate",
                      })
                    }
                  >
                    {location.connection.kind === "duplicate" ? "Clear duplicate mark" : "Mark as duplicate"}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {!selectedPanel && (
          <p className="text-sm text-slate">Pick a client on the left to see its shops and groups.</p>
        )}
      </div>
    </div>
  );
}
