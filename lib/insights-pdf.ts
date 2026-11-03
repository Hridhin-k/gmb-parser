import type { MoodPoint, TopicTrend } from "@/lib/insight-mood";
import type { NextAction, ShortVersion } from "@/lib/insight-report";

/** The PDF font is plain Helvetica: swap typographic characters for ASCII ones. */
export function pdfText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, "-")
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "");
}

const STATUS: Record<TopicTrend["status"], string> = { worse: "getting worse", better: "getting better", steady: "steady" };

/**
 * The client report: the same short version, mood by month, topics and next
 * steps as the Insights page, as lines for `renderTextPdf`.
 */
export function insightsReportLines(input: {
  placeName: string;
  periodLabel: string;
  generatedOn: string;
  counts: { analysed: number; eligible: number };
  short: ShortVersion | null;
  points: MoodPoint[];
  trends: TopicTrend[];
  actions: NextAction[];
  locationNote: string | null;
}): { title: string; lines: string[] } {
  const lines: string[] = [];
  lines.push(`${input.placeName} - ${input.periodLabel}`);
  lines.push(`Prepared ${input.generatedOn}. ${input.counts.analysed} of ${input.counts.eligible} written reviews read.`);
  lines.push("");
  if (input.short) {
    lines.push("THE SHORT VERSION");
    lines.push(input.short.sentence.map((part) => part.text).join(""));
    for (const takeaway of input.short.takeaways) {
      const kind = takeaway.kind === "good" ? "Going well" : takeaway.kind === "fix_first" ? "Fix first" : "Fix next";
      lines.push(`- ${kind}: ${takeaway.title}. ${takeaway.body}`);
    }
    lines.push("");
  }
  const shown = input.points.filter((point) => point.happy !== null);
  if (shown.length > 0) {
    lines.push("CUSTOMER MOOD (share of what customers said that was positive)");
    for (const point of input.points) {
      if (point.happy === null && point.reviews === 0) continue;
      const value = point.happy === null ? "too few mentions" : `${point.happy}% happy`;
      const year = point.happy !== null && point.lastYear !== null ? ` (a year earlier ${point.lastYear}%)` : "";
      const rating = point.rating !== null ? `, ${point.rating.toFixed(1)} average` : "";
      lines.push(`- ${point.fullLabel}: ${value}${year} - ${point.reviews} reviews${rating}`);
    }
    lines.push("");
  }
  if (input.trends.length > 0) {
    lines.push("WHAT'S DRIVING THE MOOD");
    for (const trend of input.trends) {
      const now = trend.now === null ? "too few mentions" : `${trend.now}% happy`;
      const was = trend.early !== null ? `, was ${trend.early}% in the first half` : "";
      lines.push(`- ${trend.label}: ${now}${was} (${STATUS[trend.status]})`);
    }
    lines.push("");
  }
  if (input.locationNote) {
    lines.push("LOCATIONS");
    lines.push(input.locationNote);
    lines.push("");
  }
  if (input.actions.length > 0) {
    lines.push("WHAT TO DO NEXT");
    input.actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.title}`);
      lines.push(`   ${action.why}`);
    });
    lines.push("");
  }
  lines.push("Counts and percentages come from your saved reviews. Written summaries are by AI and can be wrong.");
  return { title: pdfText(`Insights: ${input.placeName}`), lines: lines.map(pdfText) };
}
