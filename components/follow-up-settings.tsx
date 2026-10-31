"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { ESCALATION_TIMEZONES, retimeFollowUpPolicy, type EscalationPolicy } from "@/lib/escalations";

export function FollowUpSettings({ policy, canEdit = true }: { policy: EscalationPolicy; canEdit?: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(policy);
  const [keywords, setKeywords] = useState(policy.extraKeywords.join(", "));
  const [reminders, setReminders] = useState(policy.reminderHours.join(", "));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const disabled = !canEdit || pending;

  function setHours(hours: number) {
    const next = retimeFollowUpPolicy({ ...draft, reminderHours: reminders.split(",").map(Number) }, hours);
    setDraft(next);
    setReminders(next.reminderHours.join(", "));
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const extraKeywords = keywords.split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
    const reminderHours = reminders.split(",").map((hour) => Number(hour.trim()));
    if (extraKeywords.some((word) => word.length < 3 || word.length > 40) || extraKeywords.length > 20) {
      setError("Use up to 20 watch words, each between 3 and 40 characters.");
      return;
    }
    if (reminderHours.length > 6 || reminderHours.some((hour) => !Number.isInteger(hour) || hour < 1 || hour > 72 || hour >= draft.dueHours)) {
      setError("Choose up to six check-in times, from 1 to 72 hours, each before the deadline.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/escalations/policy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, extraKeywords, reminderHours }),
      });
      const result = await response.json() as { error?: string; created?: number };
      if (!response.ok) throw new Error(result.error ?? "Could not save your settings.");
      setSaved(true);
      toast.success(result.created
        ? `Settings saved. ${result.created} ${result.created === 1 ? "review added" : "reviews added"} to follow-ups.`
        : "Follow-up settings saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect. Please try again.");
    } finally { setPending(false); }
  }

  const hours = [8, 24, 48];
  if (!hours.includes(draft.dueHours)) hours.push(draft.dueHours);
  return (
    <form onSubmit={save} className="space-y-5 rounded-lg border border-line bg-white p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-ink">Keep unhappy customers from being forgotten</h2>
        <p className="mt-1 text-[13px] text-ink-3">No setup required: we already watch for reviews that need attention. Change these two choices only if you want to.</p>
      </div>
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="follow-up-stars" className="text-[13px] font-medium text-ink">Which reviews need a follow-up?</label>
          <SelectField id="follow-up-stars" label="Which reviews need a follow-up?" value={String(draft.maxStars)}
            onValueChange={(value) => { setDraft({ ...draft, maxStars: Number(value) }); setSaved(false); }}
            disabled={disabled}
            options={[1, 2, 3, 4, 5].map((stars) => ({ value: String(stars), label: stars === 1 ? "1-star reviews" : stars === 5 ? "All reviews" : `${stars} stars or less${stars === 3 ? " (recommended)" : ""}` }))} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="follow-up-hours" className="text-[13px] font-medium text-ink">How soon should they be handled?</label>
          <SelectField id="follow-up-hours" label="How soon should they be handled?" value={String(draft.dueHours)}
            onValueChange={(value) => setHours(Number(value))} disabled={disabled}
            options={hours.sort((a, b) => a - b).map((hour) => ({ value: String(hour), label: `Within ${hour} hours${hour === 24 ? " (recommended)" : ""}` }))} />
        </div>
      </fieldset>
      <div className="rounded-lg bg-brand-tint p-3 text-[13px] leading-relaxed text-ink">
        <p className="font-medium">Here’s what happens</p>
        <p className="mt-1">A {draft.maxStars === 5 ? "new" : draft.maxStars === 1 ? "1-star" : `${draft.maxStars}-star (or lower)`} review is added to Follow-ups automatically, with a {draft.dueHours}-hour deadline.</p>
        <p className="mt-1 text-ink-2">Working alone? It comes to you. With a team, it goes to the manager responsible for that location, or an admin or owner if no manager is available.</p>
      </div>
      <p className="text-xs leading-relaxed text-ink-3">The clock starts when the review was posted and includes nights and weekends. Reply to the customer, take any action needed, then mark the follow-up done.</p>
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-[13px] font-medium text-ink">Advanced settings</summary>
        <fieldset disabled={disabled} className="mt-4 space-y-4">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={draft.flagLegalSafety} onCheckedChange={(checked) => { setDraft({ ...draft, flagLegalSafety: checked === true }); setSaved(false); }} />
            Also include reviews mentioning legal or safety problems, at any rating
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={draft.flagProfanity} onCheckedChange={(checked) => { setDraft({ ...draft, flagProfanity: checked === true }); setSaved(false); }} />
            Also include reviews with abusive language, at any rating
          </label>
          <label className="block space-y-1 text-xs font-medium text-ink-2">
            <span>Other words to watch for (separate with commas)</span>
            <Input value={keywords} onChange={(event) => { setKeywords(event.target.value); setSaved(false); }} placeholder="For example: refund, damaged" />
          </label>
          <label className="block space-y-1 text-xs font-medium text-ink-2">
            <span>Custom deadline in hours</span>
            <Input type="number" min={2} max={168} value={draft.dueHours} onChange={(event) => setHours(Number(event.target.value))} required />
          </label>
          <label className="block space-y-1 text-xs font-medium text-ink-2">
            <span>Check-in times in hours after the review (separate with commas)</span>
            <Input value={reminders} onChange={(event) => { setReminders(event.target.value); setSaved(false); }} required />
          </label>
          <p className="text-xs text-ink-3">Check-ins are recorded in the follow-up history. They do not send email or text messages.</p>
          <div className="space-y-1">
            <span className="text-xs font-medium text-ink-2">Timezone for displayed deadlines</span>
            <SelectField label="Timezone for displayed deadlines" value={draft.timezone} disabled={disabled}
              onValueChange={(value) => { setDraft({ ...draft, timezone: value as EscalationPolicy["timezone"] }); setSaved(false); }}
              options={ESCALATION_TIMEZONES.map((zone) => ({ value: zone.id, label: zone.label }))} />
          </div>
          <p className="text-xs text-ink-3">For multiple locations, you can set different deadlines in Locations. Those deadlines take priority over this default.</p>
        </fieldset>
      </details>
      {(draft.flagLegalSafety || draft.flagProfanity || keywords.trim()) ? (
        <p className="text-xs text-ink-3">Also watched at any rating: {[draft.flagLegalSafety && "legal or safety problems", draft.flagProfanity && "abusive language", keywords.trim() && "your watch words"].filter(Boolean).join(", ")}. Change these under Advanced settings.</p>
      ) : null}
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {saved ? <p role="status" className="text-[13px] text-ok">Your follow-up settings are saved.</p> : null}
      {canEdit ? (
        <div className="space-y-2">
          <Button type="submit" loading={pending}>Save follow-up settings</Button>
          <p className="text-xs text-ink-3">Saving also checks already imported reviews. Older reviews may appear as overdue. Existing follow-up deadlines stay the same.</p>
        </div>
      ) : <p className="text-xs text-ink-3">An owner or admin can change these settings.</p>}
    </form>
  );
}
