import { describe, expect, it } from "vitest";
import { googleReviewReplyUrl, normalizeReviewMedia } from "@/lib/review-media";

describe("review attachments", () => {
  it("normalizes photos and videos without interpreting author labels", () => {
    expect(normalizeReviewMedia([
      { thumbnailUrl: "https://lh3.googleusercontent.com/photo", thumbnailLabel: "My photo" },
      { thumbnailUrl: "https://lh3.ggpht.com/poster", videoUrl: "https://rr1.googlevideo.com/video" },
    ])).toEqual([
      { thumbnailUrl: "https://lh3.googleusercontent.com/photo", thumbnailLabel: "My photo", videoUrl: null },
      { thumbnailUrl: "https://lh3.ggpht.com/poster", thumbnailLabel: "", videoUrl: "https://rr1.googlevideo.com/video" },
    ]);
  });

  it("rejects unsafe URLs, lookalike hosts and malformed fields", () => {
    expect(normalizeReviewMedia([null, {}, { thumbnailUrl: "javascript:alert(1)" },
      { thumbnailUrl: "http://lh3.googleusercontent.com/photo" },
      { videoUrl: "https://googlevideo.com.evil.test/video" },
      { thumbnailUrl: "https://secret@lh3.googleusercontent.com/photo" },
      { thumbnailUrl: "https://lh3.googleusercontent.com:8443/photo" }])).toEqual([]);
    expect(normalizeReviewMedia(null)).toEqual([]);
    expect(googleReviewReplyUrl("https://business.google.com/review/123")).toBe("https://business.google.com/review/123");
    expect(googleReviewReplyUrl("https://google.com.evil.test/review/123")).toBeNull();
  });
});
