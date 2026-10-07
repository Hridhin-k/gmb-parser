import { Sparkles } from "lucide-react";
import { GoogleMark } from "@/components/google-mark";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type ActivityTone = "gemini" | "google" | "work";

const TONE: Record<ActivityTone, { box: string; tile: string }> = {
  gemini: { box: "border-action-blue/20 bg-info-banner-bg", tile: "bg-white text-action-blue" },
  google: { box: "border-silver bg-white", tile: "bg-paper" },
  work: { box: "border-silver bg-white", tile: "bg-paper text-ink" },
};

function ToneIcon({ tone }: { tone: ActivityTone }) {
  if (tone === "gemini") return <Sparkles className="size-3.5 animate-pulse" />;
  if (tone === "google") {
    return (
      <span className="relative flex size-4 items-center justify-center">
        <GoogleMark className="size-2.5" />
        <Spinner size="md" className="absolute inset-0 text-stone" />
      </span>
    );
  }
  return <Spinner size="sm" />;
}

export function ActivityStatus({
  title,
  detail,
  tone = "work",
}: {
  title: string;
  detail: string;
  tone?: ActivityTone;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5", TONE[tone].box)}
    >
      <span
        className={cn(
          "mt-px flex size-7 shrink-0 items-center justify-center rounded-full shadow-control",
          TONE[tone].tile
        )}
        aria-hidden
      >
        <ToneIcon tone={tone} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs font-normal leading-relaxed text-slate">
          {detail}
        </span>
      </span>
    </div>
  );
}
