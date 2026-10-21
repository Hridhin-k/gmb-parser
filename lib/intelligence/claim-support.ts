/**
 * A complaint or praise counts only when the quoted words themselves say so.
 * Star ratings and a different sentence in the same review are not evidence.
 */

export const COMPLAINT_WORD =
  /\b(poor|bad|worst|waste|dirty|rude|slow|damaged|damage|torn|faded|expensive|costly|overpriced|pricey|disappointed|cheating|pathetic|horrible|terrible|useless|complaint|issue|problem|fraud|fake|delay|delayed|limited|missing|lacks?|lacking|broken|refused|crowded|cramped|shrink|shrunk|unhygienic|ignored|forever|too\s+(?:long|slow|late|much|few|small))\b/i;
const PRAISE_WORD =
  /\b(good|great|excellent|nice|best|amazing|wonderful|superb|awesome|happy|satisfied|loved|love|friendly|helpful|polite|courteous|kind|easy|comfortable|quick|fast|prompt|neat|reasonable|affordable|worth|fantastic|perfect|clean|spacious|knowledgeable|supportive|pleasing)\b/i;
const NEGATION = /\b(not|no|never|n't)\b/i;

const TOPIC_CUE: Record<string, RegExp> = {
  staff_politeness: /\b(staffs?|service|behaviour|behavior|polite|rude|courtesy|courteous|attitude)\b/i,
  staff_knowledge: /\b(staffs?|knowledge|knew|know|explain|uninformed)\b/i,
  staff_availability: /\b(staffs?|help|helped|ignored|nobody|attendant|available)\b/i,
  product_variety: /\b(collections?|variety|selections?|range|designs?)\b/i,
  product_quality: /\b(quality|defect|damaged|damage|torn|faded|shrink|fabric|material|stitch|wash)\b/i,
  product_availability: /\b(stock|available|availability|size|sizes)\b/i,
  cleanliness: /\b(clean|dirty|hygiene|unhygienic|smell|dust|neat)\b/i,
  fitting_room: /\b(fitting|trial|changing)\b/i,
  layout_access: /\b(crowd|crowded|cramped|spacious|layout|access)\b/i,
  queue_time: /\b(queue|wait|waiting|line)\b/i,
  billing_delay: /\b(bills?|billing|billed|checkout|counter|payment)\b/i,
  service_delay: /\b(slow|delay|waiting|forever|service)\b/i,
  exchange: /\b(exchange|return|refund)\b/i,
  parking: /\b(parking|park)\b/i,
};

/** Complaint phrases whose wording is the complaint, with no separate sentiment word. */
const INHERENT_COMPLAINT: Record<string, RegExp> = {
  staff_knowledge: /\bdid not know\b/i,
  staff_availability: /\b(no staff|short staffed|nobody to help|no one attended)\b/i,
  product_quality: /\b(after 1st wash|after first wash|after wash)\b/i,
  product_availability: /\b(out of stock|sold out|not available|unavailable)\b/i,
  queue_time: /\b(long queue|long wait|waiting time)\b/i,
  billing_delay: /\bbilling queue\b/i,
  service_delay: /\b(slow service|took forever|very slow)\b/i,
  exchange: /\brefund\b/i,
};

const INHERENT_PRAISE: Record<string, RegExp> = {
  staff_politeness: /\b(polite staff|friendly staff|helpful staff|good service|excellent service|great service)\b/i,
  product_variety: /\b(good collection|nice collection|latest collection|new collection)\b/i,
  product_quality: /\b(good quality|quality is good)\b/i,
  cleanliness: /\b(very clean|clean and neat|neat and clean)\b/i,
  layout_access: /\bspacious\b/i,
  price: /\b(affordable|reasonable price|budget friendly|good price|best price)\b/i,
};

export function excerptComplainsAboutPrice(excerpt: string): boolean {
  const text = excerpt.toLowerCase();
  if (/\b(expensive|costly|overpriced|pricey|overcharged|not worth|not value|no value|rip-?off)\b/.test(text)) return true;
  if (/\b(high|steep|hefty|huge)\s+(price|prices|rate|rates|cost|pricing)\b/.test(text)) return true;
  if (/\b(price|prices|rate|rates|cost|pricing)\b(?:\s+\w+){0,3}\s+(?:is|are|was|were|feels|felt)\s+(?:too\s+|very\s+|so\s+)?(?:high|much|steep|expensive|costly)\b/.test(text)) return true;
  return /\btoo\s+(?:much|high|costly|expensive)\b/.test(text) && /\b(price|prices|rate|rates|cost|pricing)\b/.test(text);
}

function clausePolarity(clause: string): "complaint" | "praise" | "mixed" | "none" {
  const negated = NEGATION.test(clause);
  const praise = PRAISE_WORD.test(clause) && !negated;
  const complaint = COMPLAINT_WORD.test(clause) || (negated && PRAISE_WORD.test(clause));
  if (complaint && praise) return "mixed";
  if (complaint) return "complaint";
  if (praise) return "praise";
  return "none";
}

function clauses(excerpt: string): string[] {
  const parts = excerpt.match(/[^.!?;\n]+[.!?;]?/g) ?? [excerpt];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * True when this excerpt, on its own, states that polarity for that topic.
 * A non-Latin quotation is kept: the customer's words are the evidence, and
 * this check does not translate them.
 */
export function excerptSupportsClaim(
  topicCode: string,
  polarity: "praise" | "complaint" | "neutral",
  excerpt: string,
): boolean {
  const text = excerpt.trim();
  if (!text || polarity === "neutral") return false;
  if (!/[a-z]/i.test(text)) return true;
  if (topicCode === "price") {
    return polarity === "complaint" ? excerptComplainsAboutPrice(text) : INHERENT_PRAISE.price.test(text);
  }
  // These topics are delays. A sentence that praises billing, the queue, or the
  // pace is not evidence of the delay, even when it uses the same word.
  if (polarity === "praise" && (topicCode === "billing_delay" || topicCode === "queue_time" || topicCode === "service_delay")) {
    return false;
  }
  return clauses(text).some((clause) => {
    const inherent = polarity === "complaint" ? INHERENT_COMPLAINT[topicCode] : INHERENT_PRAISE[topicCode];
    if (inherent?.test(clause)) return true;
    const cue = TOPIC_CUE[topicCode];
    if (!cue?.test(clause)) return false;
    const read = clausePolarity(clause);
    if (read === polarity) return true;
    // "no trendy collections" / "no proper queue" names the topic and negates it.
    return polarity === "complaint" && NEGATION.test(clause) && !PRAISE_WORD.test(clause);
  });
}
