export type ReviewMediaItem = {
  thumbnailUrl: string | null;
  thumbnailLabel: string;
  videoUrl: string | null;
};

function googleUrl(value: unknown, domains: string[]): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}

export function googleReviewReplyUrl(value: unknown): string | null {
  return googleUrl(value, ["google.com"]);
}

/** Only media attached by Google's Review resource, never a location gallery. */
export function normalizeReviewMedia(value: unknown): ReviewMediaItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const thumbnailUrl = googleUrl(item.thumbnailUrl, ["googleusercontent.com", "ggpht.com"]);
    const videoUrl = googleUrl(item.videoUrl, ["googlevideo.com", "googleusercontent.com", "google.com"]);
    if (!thumbnailUrl && !videoUrl) return [];
    return [{ thumbnailUrl, videoUrl, thumbnailLabel: typeof item.thumbnailLabel === "string" ? item.thumbnailLabel.slice(0, 500) : "" }];
  });
}
