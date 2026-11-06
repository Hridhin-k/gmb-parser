"use client";

import { useState } from "react";
import { googleReviewReplyUrl, normalizeReviewMedia, type ReviewMediaItem } from "@/lib/review-media";

function Attachment({ item, index }: { item: ReviewMediaItem; index: number }) {
  const [failed, setFailed] = useState(false);
  const label = item.thumbnailLabel || `Review ${item.videoUrl ? "video" : "photo"} ${index + 1}`;
  return (
    <div className="w-40 max-w-full overflow-hidden rounded-lg border border-line bg-surface">
      {failed ? <p className="p-3 text-xs text-ink-3">Preview unavailable. Refresh reviews or open in Google.</p> : item.videoUrl ? (
        <video className="h-28 w-full object-contain" controls preload="none" playsInline poster={item.thumbnailUrl ?? undefined}
          src={item.videoUrl} aria-label={label} onError={() => setFailed(true)} />
      ) : (
        <a href={item.thumbnailUrl!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`}>
          {/* Google hosts these short-lived URLs; bypass the image optimisation cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="h-28 w-full object-cover" src={item.thumbnailUrl!} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        </a>
      )}
      <p className="break-words px-2 py-1 text-xs text-ink-3">{label}</p>
    </div>
  );
}

export function ReviewMedia({ items, replyUrl }: { items?: unknown; replyUrl?: string | null }) {
  const media = normalizeReviewMedia(items);
  const googleUrl = googleReviewReplyUrl(replyUrl);
  if (!media.length && !googleUrl) return null;
  return (
    <div className="mt-3 space-y-2" aria-label="Review attachments">
      {media.length > 0 ? <>
        <p className="text-xs font-medium text-ink-2">Customer photos and videos</p>
        <div className="flex flex-wrap gap-2">{media.map((item, index) => <Attachment key={`${index}:${item.thumbnailUrl}:${item.videoUrl}`} item={item} index={index} />)}</div>
      </> : null}
      {googleUrl ? <a className="inline-block text-xs font-medium text-info hover:underline" href={googleUrl} target="_blank" rel="noopener noreferrer">Open review in Google ↗</a> : null}
    </div>
  );
}
