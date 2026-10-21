import { TAXONOMY_V2 } from "@/lib/intelligence/taxonomy";

/**
 * Management scans read the stored outlet ratings and findings.
 * A lower rating is stated as observed. A cause is stated as something
 * still to check. A count below the pattern bar is not called widespread.
 */
export interface ScanOutlet {
  name: string;
  reviews: number;
  rating: number;
  low: number;
}

export interface ScanFinding {
  category: string;
  title: string;
  explanation: string;
  evidenceCount: number;
  topicCodes: readonly string[];
  locationIds: readonly string[];
  metrics?: ReadonlyArray<{ key: string; value: number | null }>;
}

export interface ManagementScan {
  id: string;
  band: "first" | "watch" | "learn" | "limit";
  title: string;
  evidence: string[];
  check: string | null;
  action: string;
}

const BAND_ORDER: Record<ManagementScan["band"], number> = { first: 0, watch: 1, learn: 2, limit: 3 };

function topicLabel(code: string): string {
  return TAXONOMY_V2.find((node) => node.code === code)?.label ?? code;
}

function metric(finding: ScanFinding, key: string): number | null {
  const value = finding.metrics?.find((item) => item.key === key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function quotesFrom(text: string): string[] {
  return [...text.matchAll(/“([^”]+)”/g)].map((match) => match[1]!.trim()).filter(Boolean).slice(0, 2);
}

function quoteSentence(quotes: readonly string[]): string {
  if (quotes.length === 0) return "";
  const shown = quotes.map((quote) => `“${quote.length > 140 ? `${quote.slice(0, 137)}…` : quote}”`);
  return shown.length === 1 ? ` They say ${shown[0]}.` : ` They say ${shown[0]} and ${shown[1]}.`;
}

function pct(count: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function unstatedLowStars(findings: readonly ScanFinding[]): number | null {
  const finding = findings.find((item) => /no stated complaint/i.test(item.title));
  const match = finding?.explanation.match(/^(\d[\d,]*)/);
  if (!match) return null;
  const count = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(count) ? count : null;
}

interface TopicRollup {
  code: string;
  label: string;
  complaints: number;
  average: number | null;
  lowStars: number;
  praise: number;
  quotes: string[];
  outlets: number;
}

function rollupTopics(findings: readonly ScanFinding[]): TopicRollup[] {
  const byCode = new Map<string, TopicRollup>();
  const ensure = (code: string): TopicRollup => {
    const current = byCode.get(code);
    if (current) return current;
    const created: TopicRollup = { code, label: topicLabel(code), complaints: 0, average: null, lowStars: 0, praise: 0, quotes: [], outlets: 0 };
    byCode.set(code, created);
    return created;
  };
  for (const finding of findings) {
    const code = finding.topicCodes.length === 1 ? finding.topicCodes[0]! : "";
    if (!code || code === "other") continue;
    const row = ensure(code);
    const quotes = quotesFrom(finding.explanation);
    for (const quote of quotes) if (!row.quotes.includes(quote)) row.quotes.push(quote);
    if (finding.category === "positive_driver") {
      row.praise = Math.max(row.praise, finding.evidenceCount);
      continue;
    }
    if (finding.category !== "rating_drag" && finding.category !== "rare_severe" && finding.category !== "recurring_issue" && finding.category !== "fan_friction") continue;
    if (finding.category === "recurring_issue" && /praise|—/.test(finding.title)) continue;
    if (finding.evidenceCount > row.complaints) {
      row.complaints = finding.evidenceCount;
      row.average = metric(finding, "topic_average_rating");
      row.lowStars = metric(finding, "low_star_reviews") ?? 0;
      row.outlets = finding.locationIds.length;
    }
  }
  return [...byCode.values()].filter((row) => row.complaints > 0 || row.praise > 0);
}

function topic(rows: readonly TopicRollup[], code: string): TopicRollup | null {
  return rows.find((row) => row.code === code) ?? null;
}

function comparable(outlets: readonly ScanOutlet[]): ScanOutlet[] {
  const busy = outlets.filter((outlet) => outlet.reviews >= 200 && outlet.low >= 0);
  if (busy.length >= 2) return busy;
  const mid = outlets.filter((outlet) => outlet.reviews >= 80);
  return mid.length >= 2 ? mid : [];
}

function rate(outlet: ScanOutlet): number {
  return outlet.reviews > 0 ? outlet.low / outlet.reviews : 0;
}

export function managementScans(input: {
  reviews: number;
  lowStars: number;
  outlets: readonly ScanOutlet[];
  findings: readonly ScanFinding[];
}): ManagementScan[] {
  const scans: ManagementScan[] = [];
  const topics = rollupTopics(input.findings);
  const pool = comparable(input.outlets);
  const ranked = [...pool].sort((a, b) => rate(b) - rate(a) || b.low - a.low);
  const worst = ranked[0];
  const best = ranked[ranked.length - 1];

  if (worst && best && worst.name !== best.name) {
    const gap = rate(worst) - rate(best);
    const ratio = rate(best) > 0 ? rate(worst) / rate(best) : 0;
    if (gap >= 0.04 && ratio >= 2) {
      const times = Math.round(ratio);
      scans.push({
        id: "outlet-anomaly",
        band: "first",
        title: `${worst.name} has a higher share of low-star reviews than ${best.name}`,
        evidence: [
          `${worst.name}: average ${worst.rating.toFixed(2)} from ${worst.reviews.toLocaleString("en-US")} reviews, ${worst.low.toLocaleString("en-US")} of them 1–3 stars (${pct(worst.low, worst.reviews)}).`,
          `${best.name}: average ${best.rating.toFixed(2)} from ${best.reviews.toLocaleString("en-US")} reviews, ${best.low.toLocaleString("en-US")} of them 1–3 stars (${pct(best.low, best.reviews)}).`,
          `The low-star rate at ${worst.name} is about ${times} times the rate at ${best.name}.`,
        ],
        check: `The gap is observed. The cause is not. Compare staffing, stock, billing, and the floor at ${worst.name} with ${best.name} before changing either store.`,
        action: `Start the visit at ${worst.name}. Use ${best.name} as the comparison, not as proof of what to copy.`,
      });
    }
  }

  const variety = topic(topics, "product_variety");
  const collectionAsk = input.findings.find((finding) => finding.category === "customer_request" && /collection|variety|range/i.test(finding.title));
  if (variety && variety.complaints >= 2) {
    const ask = collectionAsk ? ` Customers also ask, in their own words: ${collectionAsk.title.replace(/^Customers are asking:\s*/i, "")}` : "";
    scans.push({
      id: "assortment",
      band: variety.complaints >= 8 ? "first" : "watch",
      title: "Customers who complain about the range say the collection is limited",
      evidence: [
        `${variety.complaints.toLocaleString("en-US")} reviews complain about product variety${variety.outlets > 1 ? `, across ${variety.outlets} outlets` : ""}.${quoteSentence(variety.quotes)}`,
        variety.praise > 0 ? `The collection is also praised in ${variety.praise.toLocaleString("en-US")} reviews. That praise does not remove the complaints.` : "Praise of the collection is counted separately.",
      ],
      check: `These sentences say the range felt limited.${ask} They do not yet name which category to add.`,
      action: "Read the cited reviews and list the categories they name before changing the range at those outlets.",
    });
  }

  const manner = topic(topics, "staff_politeness");
  const ignored = input.findings.find((finding) => finding.category === "recurring_issue" && finding.topicCodes[0] === "staff_availability");
  if (manner && manner.complaints >= 2) {
    scans.push({
      id: "service",
      band: manner.complaints >= 5 ? "first" : "watch",
      title: "A small set of visits describes staff manner as poor",
      evidence: [
        `${manner.complaints.toLocaleString("en-US")} reviews complain about staff manner${manner.lowStars > 0 ? `, ${manner.lowStars.toLocaleString("en-US")} of them at 1 or 2 stars` : ""}${manner.outlets > 1 ? `, written at ${manner.outlets} outlets` : ""}.${quoteSentence(manner.quotes)}`,
        ignored ? `One further visit says: ${quotesFrom(ignored.explanation)[0] ? `“${quotesFrom(ignored.explanation)[0]}”` : ignored.explanation}` : "",
        manner.praise > 0 ? `Staff manner is praised in ${manner.praise.toLocaleString("en-US")} reviews. The complaints are the exception to check, not a judgement of every employee.` : "",
      ].filter(Boolean),
      check: "These are specific visits. They do not show that the staff at an outlet are the problem.",
      action: "Read each cited visit, then observe the shift it describes. Reinforce the behaviour the sentence names.",
    });
  }

  const billing = topic(topics, "billing_delay") ?? topic(topics, "queue_time");
  if (billing && billing.complaints >= 1) {
    scans.push({
      id: "billing",
      band: billing.complaints >= 5 ? "first" : "watch",
      title: "Billing complaints describe the queue and the counter, and there are few of them",
      evidence: [
        `${billing.complaints.toLocaleString("en-US")} review${billing.complaints === 1 ? "" : "s"} complain about ${billing.label.toLowerCase()}${billing.outlets > 1 ? ` at ${billing.outlets} outlets` : ""}.${quoteSentence(billing.quotes)}`,
      ],
      check: billing.complaints < 5 ? `${billing.complaints} visits are too few to call billing a problem across the organisation.` : null,
      action: "Review the queue and the billing desk on the cited visits. Do not rewrite the billing process from this count alone.",
    });
  }

  const stock = topic(topics, "product_availability");
  if (stock && stock.complaints >= 2) {
    const happy = input.findings.find((finding) => finding.category === "fan_friction" && finding.topicCodes[0] === "product_availability");
    scans.push({
      id: "stock",
      band: "watch",
      title: "Some customers could not get the size or the item they came for",
      evidence: [
        `${stock.complaints.toLocaleString("en-US")} reviews complain that something was unavailable.${quoteSentence(stock.quotes)}`,
        happy ? `${happy.evidenceCount.toLocaleString("en-US")} of those customers still gave 4 or 5 stars, so a low-star report would miss them.` : "",
      ].filter(Boolean),
      check: "Group these by the item and the outlet before treating stock as one problem.",
      action: "Replenish the items the cited sentences name, at the outlets where they were written.",
    });
  }

  const quality = topic(topics, "product_quality");
  if (quality && quality.complaints >= 1) {
    scans.push({
      id: "quality",
      band: quality.complaints >= 8 ? "first" : "watch",
      title: "Quality complaints are few and the ratings on them are harsh",
      evidence: [
        `${quality.complaints.toLocaleString("en-US")} reviews complain about product quality${quality.average !== null ? `, averaging ${quality.average.toFixed(2)} stars` : ""}.${quoteSentence(quality.quotes)}`,
      ],
      check: quality.complaints < 8 ? "This is severe enough to read, and too small to call a defect across the range." : null,
      action: "Identify the product named in each cited review and check whether the same item fails again.",
    });
  }

  const price = topic(topics, "price");
  if (price && price.complaints >= 2) {
    scans.push({
      id: "price",
      band: "watch",
      title: "A few customers say the price is high, and many others praise it",
      evidence: [
        `${price.complaints.toLocaleString("en-US")} reviews complain about price.${quoteSentence(price.quotes)}`,
        price.praise > 0 ? `Price is praised in ${price.praise.toLocaleString("en-US")} reviews.` : "",
      ].filter(Boolean),
      check: "A stated price is not a complaint. These sentences say the rate felt high or not worth it.",
      action: "Match each complaint to the product it names before changing a price.",
    });
  }

  const refund = topic(topics, "exchange");
  if (refund && refund.complaints >= 1) {
    scans.push({
      id: "refund",
      band: "watch",
      title: "Refund cases are individual visits, not a policy pattern yet",
      evidence: [
        `${refund.complaints.toLocaleString("en-US")} review${refund.complaints === 1 ? "" : "s"} complain about the exchange or refund.${quoteSentence(refund.quotes)}`,
      ],
      check: "Each of these needs the transaction and the reply. The count is too small to change the policy from.",
      action: "Follow up the cited customers: what they were offered, and whether the refund has been paid.",
    });
  }

  const people = input.findings
    .filter((finding) => finding.category === "staff_mention")
    .filter((finding) => {
      const complaints = metric(finding, "staff_complaint_reviews") ?? 0;
      const praise = metric(finding, "staff_praise_reviews") ?? 0;
      return complaints === 0 || praise > complaints;
    })
    .sort((a, b) => b.evidenceCount - a.evidenceCount)
    .slice(0, 6);
  if (people.length > 0) {
    scans.push({
      id: "recognition",
      band: "learn",
      title: "Customers name these people when they want to thank them",
      evidence: people.map((finding) => {
        const name = finding.title.match(/"([^"]+)"/)?.[1] ?? finding.title;
        const where = finding.explanation.split(". ").find((sentence) => /outlet/.test(sentence)) ?? "";
        return `${name} — ${finding.evidenceCount.toLocaleString("en-US")} reviews. ${where}`.trim();
      }),
      check: "Confirm the spellings are one person and that the outlet on the reviews is where they work.",
      action: "Recognise them at that outlet, and note the behaviour the sentences repeat so another store can use it.",
    });
  }

  if (pool.length >= 2) {
    const exemplars = [...pool].sort((a, b) => rate(a) - rate(b) || b.reviews - a.reviews).slice(0, 3);
    const weakestRate = worst ? rate(worst) : 1;
    const useful = exemplars.filter((outlet) => rate(outlet) <= weakestRate * 0.6);
    if (useful.length >= 1) {
      scans.push({
        id: "best-practice",
        band: "learn",
        title: "These outlets have the smaller share of low-star reviews",
        evidence: useful.map((outlet) => `${outlet.name}: average ${outlet.rating.toFixed(2)}, ${outlet.low.toLocaleString("en-US")} low-star reviews out of ${outlet.reviews.toLocaleString("en-US")} (${pct(outlet.low, outlet.reviews)}).`),
        check: "A higher rating does not say which practice to copy.",
        action: worst ? `Compare how ${useful.map((outlet) => outlet.name).join(", ")} handle the complaints that show up at ${worst.name}.` : "Compare these outlets with the one that has the higher low-star rate.",
      });
    }
  }

  const balance = topics.filter((row) => row.complaints > 0 && row.praise > 0).sort((a, b) => b.praise - a.praise);
  if (balance.length > 0) {
    scans.push({
      id: "balance",
      band: "learn",
      title: "Praise and complaints are different visits",
      evidence: balance.slice(0, 5).map((row) => `${row.label}: praised in ${row.praise.toLocaleString("en-US")} reviews, complained about in ${row.complaints.toLocaleString("en-US")}.`),
      check: "These are the stored readings. Reviews with no sentence are not in either count.",
      action: "Keep the experience the praise describes. Investigate the complaint sentences one by one.",
    });
  }

  const unread = unstatedLowStars(input.findings);
  if (unread !== null && unread > 0) {
    scans.push({
      id: "coverage",
      band: "limit",
      title: "Most low-star reviews in this window do not yet say what went wrong",
      evidence: [
        `${input.reviews.toLocaleString("en-US")} reviews are in this window. ${input.lowStars.toLocaleString("en-US")} are 1–3 stars.`,
        `${unread.toLocaleString("en-US")} of those low-star reviews have no complaint sentence stored, so they were not given a topic.`,
      ],
      check: "The scans above are only the reviews that already have a reading.",
      action: "Do not treat the detected themes as the full picture of dissatisfaction until those reviews are read.",
    });
  }

  return scans.sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band]);
}
