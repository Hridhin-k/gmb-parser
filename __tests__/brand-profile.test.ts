import { describe, expect, it } from "vitest";
import {
  brandContextBlock,
  htmlToText,
  isBlockedHostname,
  isPrivateAddress,
  normalizeBrandProfile,
  normalizeWebsiteUrl,
  pickSiteLinks,
  themeSlug,
} from "@/lib/brand-profile";
import { batchExtractionPrompt } from "@/lib/review-intelligence";

describe("normalizeWebsiteUrl", () => {
  it("adds https and rejects non-web or credentialed addresses", () => {
    expect(normalizeWebsiteUrl("example.com/about")?.toString()).toBe("https://example.com/about");
    expect(normalizeWebsiteUrl("ftp://example.com")).toBeNull();
    expect(normalizeWebsiteUrl("https://user:pw@example.com")).toBeNull();
    expect(normalizeWebsiteUrl("nodots")).toBeNull();
    expect(normalizeWebsiteUrl("")).toBeNull();
  });
});

describe("private address checks", () => {
  it("blocks internal ranges and hostnames", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isBlockedHostname("postgres.railway.internal")).toBe(true);
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });
});

describe("htmlToText and pickSiteLinks", () => {
  const html = `<html><head><title>x</title><style>.a{}</style></head><body>
    <script>alert(1)</script><h1>Norms &amp; Co</h1><p>Labour law advice.</p>
    <a href="/about-us">About</a><a href="/services/pf">PF</a><a href="https://other.com/about">Other</a>
    <a href="/logo.png">img</a><a href="/blog/1">Blog</a></body></html>`;
  it("keeps visible text only", () => {
    const text = htmlToText(html);
    expect(text).toContain("Norms & Co");
    expect(text).toContain("Labour law advice.");
    expect(text).not.toContain("alert");
    expect(text).not.toContain(".a{}");
  });
  it("picks same-site descriptive links only", () => {
    const links = pickSiteLinks(html, new URL("https://example.com/")).map((u) => u.pathname);
    expect(links).toEqual(expect.arrayContaining(["/about-us", "/services/pf"]));
    expect(links).not.toContain("/blog/1");
    expect(links.some((p) => p.endsWith(".png"))).toBe(false);
  });
});

describe("normalizeBrandProfile", () => {
  it("trims, dedupes and caps, and returns null when empty", () => {
    const profile = normalizeBrandProfile({
      summary: "  A  consultancy ",
      offerings: ["PF", "pf", " ESI ", 5],
      customerVocabulary: [],
      staffRoles: "no",
      themeHints: ["x".repeat(200)],
    });
    expect(profile?.summary).toBe("A consultancy");
    expect(profile?.offerings).toEqual(["PF", "ESI"]);
    expect(profile?.themeHints[0]).toHaveLength(80);
    expect(normalizeBrandProfile({ summary: "", offerings: [] })).toBeNull();
    expect(normalizeBrandProfile(null)).toBeNull();
  });
});

describe("brand context in the extraction prompt", () => {
  const review = { id: "r1", starRating: 5, comment: "Great advice" };
  it("has no fixed topic list and carries the brand context", () => {
    const context = brandContextBlock(
      { summary: "Labour law consultancy.", offerings: ["PF filing"], customerVocabulary: [], staffRoles: [], themeHints: [] },
      ["advice_quality"]
    );
    const prompt = batchExtractionPrompt([review], context);
    expect(prompt).toContain("Labour law consultancy.");
    expect(prompt).toContain("THEMES ALREADY USED FOR THIS BUSINESS: advice_quality");
    expect(prompt).not.toContain("assortment");
    expect(prompt).not.toContain("store_experience");
  });
  it("is empty without a profile or themes", () => {
    expect(brandContextBlock(null, [])).toBe("");
  });
  it("slugs theme names", () => {
    expect(themeSlug("Advice Quality!")).toBe("advice_quality");
  });
});
