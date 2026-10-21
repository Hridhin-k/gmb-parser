/**
 * taxonomy-v2. Parents group the closed set already used by the product
 * (staff, billing, parking, exchange, product quality, cleanliness, price)
 * plus the fitting-room praise the overview wireframe asks for.
 * A new phrase becomes an alias, not a new code.
 */
export const TAXONOMY_VERSION = "taxonomy-v2";

export interface TaxonomyNode {
  code: string;
  label: string;
  parent: string | null;
  description: string;
  /** Leaf codes can be a complaint issue as well as a topic. */
  issue: boolean;
  aliases: readonly string[];
}

export const TAXONOMY_V2: readonly TaxonomyNode[] = [
  { code: "staff_service", label: "Staff and service", parent: null, description: "How people in the store treated the customer.", issue: false, aliases: [] },
  { code: "staff_politeness", label: "Staff politeness", parent: "staff_service", description: "Courtesy, rudeness, or tone of staff.", issue: true, aliases: ["polite", "rude", "staff behaviour", "staff behavior", "courtesy"] },
  { code: "staff_knowledge", label: "Staff knowledge", parent: "staff_service", description: "Whether staff could explain the product or the policy.", issue: true, aliases: ["knowledgeable", "did not know", "uninformed"] },
  { code: "staff_availability", label: "Staff availability", parent: "staff_service", description: "Whether anyone was available to help.", issue: true, aliases: ["short staffed", "no staff", "ignored", "nobody to help"] },
  { code: "product_collection", label: "Product and collection", parent: null, description: "What was for sale and its condition.", issue: false, aliases: [] },
  { code: "product_variety", label: "Product variety", parent: "product_collection", description: "Range or selection.", issue: true, aliases: ["selection", "variety", "range of products"] },
  { code: "product_quality", label: "Product quality", parent: "product_collection", description: "Defects, damage, or quality of the goods.", issue: true, aliases: ["quality", "defect", "broken", "damaged", "product quality"] },
  { code: "product_availability", label: "Product availability", parent: "product_collection", description: "Whether the item was in stock.", issue: true, aliases: ["out of stock", "unavailable", "sold out"] },
  { code: "store_environment", label: "Store environment", parent: null, description: "The physical shop.", issue: false, aliases: [] },
  { code: "cleanliness", label: "Cleanliness", parent: "store_environment", description: "Hygiene and cleanliness.", issue: true, aliases: ["hygiene", "dirty", "clean", "cleaning", "unhygienic"] },
  { code: "fitting_room", label: "Fitting-room experience", parent: "store_environment", description: "Trial room or changing room.", issue: true, aliases: ["trial room", "changing room", "changing area", "fitting room", "fitting rooms"] },
  { code: "layout_access", label: "Layout and accessibility", parent: "store_environment", description: "Layout, crowding, or step-free access.", issue: true, aliases: ["layout", "accessible", "crowded", "cramped"] },
  { code: "waiting_operations", label: "Waiting and operations", parent: null, description: "Time spent waiting for service.", issue: false, aliases: [] },
  { code: "queue_time", label: "Queue time", parent: "waiting_operations", description: "Waiting in a line.", issue: true, aliases: ["wait", "queue", "waiting", "long line"] },
  { code: "billing_delay", label: "Billing delays", parent: "waiting_operations", description: "Checkout or billing queue.", issue: true, aliases: ["billing", "billing queue", "checkout"] },
  { code: "service_delay", label: "Service delays", parent: "waiting_operations", description: "A slow service that is not a queue or a bill.", issue: true, aliases: ["slow service", "took forever"] },
  { code: "price", label: "Price", parent: null, description: "Whether the price felt fair.", issue: true, aliases: ["expensive", "costly", "overpriced", "price"] },
  { code: "exchange", label: "Exchange policy", parent: null, description: "Returns, exchanges, or refunds.", issue: true, aliases: ["exchange policy", "return policy", "refund"] },
  { code: "parking", label: "Parking", parent: null, description: "Parking at the location.", issue: true, aliases: ["parking", "car park"] },
  { code: "other", label: "Other", parent: null, description: "A supported point that matches none of the codes above.", issue: false, aliases: [] },
] as const;

const BY_CODE = new Map(TAXONOMY_V2.map((node) => [node.code, node]));

const ALIAS_TO_CODE = new Map<string, string>();
for (const node of TAXONOMY_V2) {
  ALIAS_TO_CODE.set(node.code, node.code);
  ALIAS_TO_CODE.set(node.label.toLowerCase(), node.code);
  for (const alias of node.aliases) ALIAS_TO_CODE.set(alias.toLowerCase(), node.code);
}

/** Leaf codes whose aliases appear as whole words. Used when a stored review has no extraction yet. */
export function aliasTopics(text: string): string[] {
  const found: string[] = [];
  for (const node of TAXONOMY_V2) {
    if (!isLeafTopic(node.code)) continue;
    const names = [node.label, ...node.aliases].filter((alias) => alias.length >= 5);
    if (names.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))) {
      found.push(node.code);
    }
  }
  return [...new Set(found)].sort();
}

export function resolveTopicCode(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIAS_TO_CODE.get(key) ?? null;
}

export function isLeafTopic(code: string): boolean {
  const node = BY_CODE.get(code);
  if (!node) return false;
  return TAXONOMY_V2.some((item) => item.parent === code) === false;
}

export const LEAF_TOPIC_CODES = TAXONOMY_V2.filter((node) => isLeafTopic(node.code)).map((node) => node.code);
