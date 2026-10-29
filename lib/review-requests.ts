import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";

export const COOLDOWN_DEFAULT = 90;
export const REQUEST_RETRY_LIMIT = 3;
export const REQUEST_RETRY_MS = 15 * 60 * 1000;
export const CSV_ROW_LIMIT = 500;

export const REQUEST_CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "qr", label: "In-store QR" },
] as const;

export type RequestChannel = (typeof REQUEST_CHANNELS)[number]["id"];

export const REQUEST_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ml", label: "Malayalam" },
  { id: "hi", label: "Hindi" },
] as const;

export type RequestLanguage = (typeof REQUEST_LANGUAGES)[number]["id"];

export interface RequestEnv {
  brevoApiKey: string | null;
  fromEmail: string | null;
  whatsappToken: string | null;
  whatsappPhoneNumberId: string | null;
  twilioSid: string | null;
  twilioToken: string | null;
  twilioFrom: string | null;
  twilioMessagingService: string | null;
  /** Optional Brevo webhook secret for delivery/open receipts. */
  brevoWebhookSecret: string | null;
  whatsappAppSecret: string | null;
}

export interface RequestChannelOption {
  id: RequestChannel;
  label: string;
  available: boolean;
  reason: string | null;
}

export function readRequestEnv(source: Record<string, string | undefined>): RequestEnv {
  const value = (key: string) => {
    const raw = source[key]?.trim();
    return raw ? raw : null;
  };
  return {
    brevoApiKey: value("BREVO_API_KEY"),
    fromEmail: value("REQUEST_FROM_EMAIL") ?? value("REPORT_FROM_EMAIL"),
    whatsappToken: value("WHATSAPP_TOKEN"),
    whatsappPhoneNumberId: value("WHATSAPP_PHONE_NUMBER_ID"),
    twilioSid: value("TWILIO_ACCOUNT_SID"),
    twilioToken: value("TWILIO_AUTH_TOKEN"),
    twilioFrom: value("TWILIO_FROM_NUMBER"),
    twilioMessagingService: value("TWILIO_MESSAGING_SERVICE_SID"),
    brevoWebhookSecret: value("BREVO_WEBHOOK_SECRET"),
    whatsappAppSecret: value("WHATSAPP_APP_SECRET"),
  };
}

export function requestChannelOptions(env: RequestEnv): RequestChannelOption[] {
  const email = Boolean(env.brevoApiKey && env.fromEmail);
  const whatsapp = Boolean(env.whatsappToken && env.whatsappPhoneNumberId);
  const sms = Boolean(env.twilioSid && env.twilioToken && (env.twilioFrom || env.twilioMessagingService));
  return [
    {
      id: "whatsapp",
      label: "WhatsApp",
      available: whatsapp,
      reason: whatsapp ? null : "No WhatsApp provider is configured.",
    },
    {
      id: "sms",
      label: "SMS",
      available: sms,
      reason: sms ? null : "No SMS sender is configured.",
    },
    {
      id: "email",
      label: "Email",
      available: email,
      reason: email ? null : "No email provider is configured.",
    },
    {
      id: "qr",
      label: "In-store QR",
      available: true,
      reason: "The code opens this location’s page. No message is sent.",
    },
  ];
}

export function receiptCoverage(env: RequestEnv): { delivery: boolean; opens: boolean } {
  const twilio = Boolean(env.twilioSid && env.twilioToken);
  return {
    delivery: Boolean(env.brevoWebhookSecret || env.whatsappAppSecret || twilio),
    opens: Boolean(env.brevoWebhookSecret || env.whatsappAppSecret),
  };
}

export function phoneMatchKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function customerKey(email: string | null | undefined, phone: string | null | undefined): string | null {
  const mail = email?.trim().toLowerCase() ?? "";
  if (mail.includes("@") && mail.includes(".") && !mail.includes(" ")) return `email:${mail}`;
  const key = phone ? phoneMatchKey(phone) : null;
  return key ? `phone:${key}` : null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.length > 0));
}

const HEADER_ALIASES: Record<string, "name" | "phone" | "email" | "store" | "opted_out"> = {
  name: "name",
  customer: "name",
  "customer name": "name",
  phone: "phone",
  mobile: "phone",
  "phone or email": "phone",
  email: "email",
  "e-mail": "email",
  store: "store",
  "store code": "store",
  store_code: "store",
  location: "store",
  opted_out: "opted_out",
  "opted out": "opted_out",
  opt_out: "opted_out",
};

export interface ParsedCustomer {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  storeCode: string | null;
  optedOut: boolean;
  key: string | null;
  phoneKey: string | null;
}

function optedOutValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1" || normalized === "stop" || normalized === "opted out";
}

export function parseCustomerCsv(text: string): ParsedCustomer[] {
  const table = parseCsv(text);
  if (table.length === 0) throw new ValidationError("The CSV is empty.");
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const columns = header.map((cell) => HEADER_ALIASES[cell] ?? null);
  if (!columns.includes("phone") && !columns.includes("email")) {
    throw new ValidationError("The CSV needs a header row with name, phone or email, and store code.");
  }
  const body = table.slice(1);
  if (body.length > CSV_ROW_LIMIT) {
    throw new ValidationError(`A campaign can import ${CSV_ROW_LIMIT} customers at a time.`);
  }
  return body.map((cells, index) => {
    const read = (field: "name" | "phone" | "email" | "store" | "opted_out") => {
      const at = columns.indexOf(field);
      return at >= 0 ? (cells[at] ?? "").trim() : "";
    };
    const email = read("email");
    const phone = read("phone");
    const mail = email.includes("@") ? email : "";
    const phoneValue = phone.includes("@") ? "" : phone;
    const emailValue = mail || (phone.includes("@") ? phone : "");
    return {
      line: index + 2,
      name: read("name"),
      email: emailValue || null,
      phone: phoneValue || null,
      storeCode: read("store") || null,
      optedOut: optedOutValue(read("opted_out")),
      key: customerKey(emailValue, phoneValue),
      phoneKey: phoneValue ? phoneMatchKey(phoneValue) : null,
    };
  });
}

export interface StoreLocation {
  id: string;
  storeCode: string | null;
}

export interface ContactHistory {
  key: string;
  phoneKey: string | null;
  email: string | null;
  acceptedAt: string | null;
  optedOut: boolean;
}

export type ImportOutcome = "eligible" | "duplicate" | "missing_contact" | "unknown_store" | "opted_out" | "suppressed";

export interface ClassifiedCustomer extends ParsedCustomer {
  outcome: ImportOutcome;
  locationId: string | null;
}

export function withinCooldown(acceptedAt: string | null, now: Date, days: number): boolean {
  if (!acceptedAt) return false;
  const then = new Date(acceptedAt).getTime();
  if (Number.isNaN(then)) return false;
  return now.getTime() - then < days * 24 * 60 * 60 * 1000;
}

function samePerson(row: ParsedCustomer, prior: ContactHistory): boolean {
  if (row.key && prior.key === row.key) return true;
  if (row.phoneKey && prior.phoneKey && row.phoneKey === prior.phoneKey) return true;
  const email = row.email?.trim().toLowerCase();
  if (email && prior.email && prior.email.trim().toLowerCase() === email) return true;
  return false;
}

export function classifyCustomers(
  rows: ParsedCustomer[],
  locations: StoreLocation[],
  history: ContactHistory[],
  now: Date,
  cooldownDays: number,
  selectedLocationIds: string[]
): ClassifiedCustomer[] {
  const selected = new Set(selectedLocationIds);
  const byCode = new Map<string, StoreLocation>();
  for (const location of locations) {
    if (!selected.has(location.id)) continue;
    const code = location.storeCode?.trim().toLowerCase();
    if (code) byCode.set(code, location);
  }
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row.key) return { ...row, outcome: "missing_contact", locationId: null };
    if (seen.has(row.key)) return { ...row, outcome: "duplicate", locationId: null };
    seen.add(row.key);
    let locationId: string | null = null;
    const code = row.storeCode?.trim().toLowerCase() ?? "";
    if (code && byCode.has(code)) locationId = byCode.get(code)?.id ?? null;
    else if (!code && selectedLocationIds.length === 1) locationId = selectedLocationIds[0] ?? null;
    if (!locationId) return { ...row, outcome: "unknown_store", locationId: null };
    const matches = history.filter((prior) => samePerson(row, prior));
    if (row.optedOut || matches.some((prior) => prior.optedOut)) {
      return { ...row, outcome: "opted_out", locationId };
    }
    if (matches.some((prior) => withinCooldown(prior.acceptedAt, now, cooldownDays))) {
      return { ...row, outcome: "suppressed", locationId };
    }
    return { ...row, outcome: "eligible", locationId };
  });
}

export function importCounts(rows: ClassifiedCustomer[]) {
  const count = (outcome: ImportOutcome) => rows.filter((row) => row.outcome === outcome).length;
  return {
    eligible: count("eligible"),
    suppressed: count("suppressed"),
    optedOut: count("opted_out"),
    missingContact: count("missing_contact"),
    unknownStore: count("unknown_store"),
    duplicates: count("duplicate"),
  };
}

const OPT_OUT_LINE: Record<RequestLanguage, string> = {
  en: "To stop these messages: {optout}",
  ml: "ഈ സന്ദേശങ്ങൾ നിർത്താൻ: {optout}",
  hi: "ये संदेश बंद करने के लिए: {optout}",
};

export function isRequestLanguage(value: string): value is RequestLanguage {
  return REQUEST_LANGUAGES.some((item) => item.id === value);
}

export function defaultTemplate(language: RequestLanguage): string {
  if (language === "ml") {
    return "ഹായ് {name}, {location} സന്ദർശിച്ചതിന് നന്ദി. Google-ൽ റിവ്യൂ എഴുതാം, അല്ലെങ്കിൽ സ്വകാര്യമായി അറിയിക്കാം: {link}\n{optout}";
  }
  if (language === "hi") {
    return "नमस्ते {name}, {location} आने के लिए धन्यवाद। Google पर समीक्षा लिखें, या निजी तौर पर बताएं: {link}\n{optout}";
  }
  return "Hi {name}, thank you for visiting {location}. You can review us on Google or tell us privately: {link}\n{optout}";
}

export function renderTemplate(
  template: string,
  language: RequestLanguage,
  values: { name: string; location: string; link: string; optout: string }
): string {
  const withOpt = template.includes("{optout}") ? template : `${template.trim()}\n${OPT_OUT_LINE[language]}`;
  return withOpt
    .replaceAll("{name}", values.name.trim() || "there")
    .replaceAll("{location}", values.location)
    .replaceAll("{link}", values.link)
    .replaceAll("{optout}", values.optout);
}

export interface PageCopy {
  question: string;
  google: string;
  private: string;
  both: string;
  optOut: string;
  thanks: string;
  /** Shown when private feedback validation fails (`sent=0`). */
  feedbackFailed: string;
  stopped: string;
  placeholder: string;
  missingPlace: string;
  submit: string;
}

export function pageCopy(language: string, locationName: string): PageCopy {
  const place = locationName.trim() || "this location";
  if (language === "ml") {
    return {
      question: `${place} സന്ദർശനം എങ്ങനെയായിരുന്നു?`,
      google: "Google-ൽ റിവ്യൂ എഴുതുക",
      private: "സ്വകാര്യമായി അറിയിക്കുക",
      both: "രണ്ട് വഴികളും എല്ലാവർക്കും കാണാം.",
      optOut: "ഈ അഭ്യർത്ഥനകൾ നിർത്തുക",
      thanks: "നന്ദി. ഈ കുറിപ്പ് ബിസിനസിന് മാത്രമാണ്. Google-ൽ പ്രസിദ്ധീകരിക്കില്ല.",
      feedbackFailed: "കുറിപ്പ് അയക്കാനായില്ല. ഒരു ചെറിയ സന്ദേശം എഴുതി വീണ്ടും ശ്രമിക്കുക.",
      stopped: "നിങ്ങൾക്ക് ഇനി അഭ്യർത്ഥനകൾ അയക്കില്ല.",
      placeholder: "ഞങ്ങൾ അറിയേണ്ടത് എന്താണ്?",
      missingPlace: "ഈ ലൊക്കേഷന് Google ഒരു പ്ലേസ് ഐഡി പങ്കിട്ടിട്ടില്ല, അതിനാൽ പൊതു റിവ്യൂ ഫോം തുറക്കാനാകില്ല.",
      submit: "അയക്കുക",
    };
  }
  if (language === "hi") {
    return {
      question: `${place} की आपकी विज़िट कैसी रही?`,
      google: "Google पर समीक्षा लिखें",
      private: "निजी तौर पर बताएं",
      both: "दोनों विकल्प सबको दिखते हैं.",
      optOut: "ये अनुरोध बंद करें",
      thanks: "धन्यवाद. यह नोट व्यवसाय के पास रहता है और Google पर प्रकाशित नहीं होता.",
      feedbackFailed: "नोट नहीं भेजा जा सका. कृपया एक छोटा संदेश लिखकर फिर कोशिश करें.",
      stopped: "आपको आगे अनुरोध नहीं भेजे जाएंगे.",
      placeholder: "हमें क्या जानना चाहिए?",
      missingPlace: "Google ने इस स्थान की प्लेस आईडी साझा नहीं की है, इसलिए सार्वजनिक समीक्षा फ़ॉर्म नहीं खुल सकता.",
      submit: "भेजें",
    };
  }
  return {
    question: `How was your visit to ${place}?`,
    google: "Review us on Google",
    private: "Tell us privately",
    both: "Both options are shown to everyone.",
    optOut: "Stop these requests",
    thanks: "Thank you. This note stays with the business and is not posted on Google.",
    feedbackFailed: "That note could not be sent. Write a short message and try again.",
    stopped: "You will not be sent further requests.",
    placeholder: "What should we know?",
    missingPlace: "Google has not shared a place ID for this location, so this page cannot open the public review form.",
    submit: "Send",
  };
}

/** Both choices are always present. Nothing on this page depends on a rating. */
export function customerPageModel(language: string, locationName: string, googleUrl: string | null) {
  const copy = pageCopy(language, locationName);
  return {
    question: copy.question,
    googleLabel: copy.google,
    privateLabel: copy.private,
    both: copy.both,
    googleUrl,
    showGoogle: true,
    showPrivate: true,
    asksForRating: false,
  };
}

export interface ProviderOutcome {
  state: "accepted" | "failed";
  delivered: boolean;
  retryable: boolean;
  detail: string;
}

export function providerOutcome(httpStatus: number, providerStatus: string | null): ProviderOutcome {
  const status = (providerStatus ?? "").toLowerCase();
  if (httpStatus >= 200 && httpStatus < 300) {
    if (status === "delivered" || status === "read") {
      return {
        state: "accepted",
        delivered: true,
        retryable: false,
        detail: "The provider confirmed delivery.",
      };
    }
    if (status === "undelivered" || status === "failed") {
      return {
        state: "failed",
        delivered: false,
        retryable: false,
        detail: "The provider reported the message was not delivered.",
      };
    }
    return {
      state: "accepted",
      delivered: false,
      retryable: false,
      detail:
        status === "queued"
          ? "The provider queued the message. Delivery is not confirmed."
          : "The provider accepted the message. Delivery is not confirmed.",
    };
  }
  const retryable = httpStatus === 429 || httpStatus >= 500;
  return {
    state: "failed",
    delivered: false,
    retryable,
    detail: retryable
      ? `The provider returned ${httpStatus}. This will be retried.`
      : `The provider rejected the message (${httpStatus}).`,
  };
}

export function countsAsSent(message: { acceptedAt: string | null; isTest: boolean }): boolean {
  return !message.isTest && Boolean(message.acceptedAt);
}

export function countsAsDelivered(message: { deliveredAt: string | null; isTest: boolean }): boolean {
  return !message.isTest && Boolean(message.deliveredAt);
}

export interface MetricCell {
  id: string;
  label: string;
  value: string;
  note: string;
}

export function requestMetricCells(input: {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  feedback: number;
  optedOut: number;
  deliveryReceipts: boolean;
  openReceipts: boolean;
}): MetricCell[] {
  const deliveredKnown = input.deliveryReceipts || input.delivered > 0;
  const openedKnown = input.openReceipts || input.opened > 0;
  return [
    {
      id: "sent",
      label: "Sent",
      value: input.sent.toLocaleString("en-US"),
      note: "Messages a provider accepted. A queued request is not counted.",
    },
    {
      id: "delivered",
      label: "Delivered",
      value: deliveredKnown ? input.delivered.toLocaleString("en-US") : "Not confirmed",
      note: deliveredKnown
        ? "Delivery receipts from the provider."
        : "No delivery receipt is connected.",
    },
    {
      id: "opened",
      label: "Opened",
      value: openedKnown ? input.opened.toLocaleString("en-US") : "Not confirmed",
      note: openedKnown ? "Open or read receipts from the provider." : "No open or read receipt is connected.",
    },
    {
      id: "clicked",
      label: "Clicked",
      value: input.clicked.toLocaleString("en-US"),
      note: "Visits to the request page. A message is counted once. Each QR visit is a scan.",
    },
    {
      id: "google",
      label: "New Google reviews",
      value: "Not available",
      note: "Google does not say which review came from a request. A click to Google is not a review.",
    },
    {
      id: "feedback",
      label: "Private feedback",
      value: input.feedback.toLocaleString("en-US"),
      note: "Notes submitted on the request page. They are not posted on Google.",
    },
    {
      id: "opted_out",
      label: "Opted out",
      value: input.optedOut.toLocaleString("en-US"),
      note: "Customers who asked to stop requests.",
    },
  ];
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string, token: string): boolean {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  const digest = createHmac("sha1", token).update(payload).digest("base64");
  return safeEqual(digest, signature);
}

export function verifyWhatsAppSignature(body: string, header: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(expected, header);
}

export function verifyResendSignature(body: string, id: string, timestamp: string, header: string, secret: string): boolean {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return false;
  }
  const digest = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  const parts = header.split(" ").map((part) => part.split(",")[1] ?? "");
  return parts.some((part) => part.length > 0 && safeEqual(digest, part));
}

export const campaignBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  channel: z.enum(["whatsapp", "sms", "email", "qr"]),
  language: z.enum(["en", "ml", "hi"]),
  template: z.string().trim().max(1000),
  reminder: z.boolean(),
  locationIds: z.array(z.string().uuid()).min(1).max(200),
  csv: z.string().max(500_000).optional(),
});

export const policyBodySchema = z.object({
  cooldownDays: z.number().int().min(1).max(365),
});

export const feedbackBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const testBodySchema = z.object({
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(20).optional(),
});
