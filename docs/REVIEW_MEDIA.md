# Review photos and videos

Investigated on 6 November 2026 against Google's current [Review resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews#ReviewMediaItem).

Google documents `reviewMediaItems` directly on each review. Each item can contain `thumbnailUrl`, an author-provided `thumbnailLabel`, and `videoUrl` for playable video. `reviewReplyUrl` opens Google's reply interface. These fields allow reliable association with an individual review; reviewer profile pictures are separate.

The application now saves these items during its existing review sync, includes them in change detection, and displays photo links and video controls beside the review in desktop rows, follow-ups, mobile approvals and complaint/detail panels. Google's reply URL is shown when supplied. Media changes alone do not change the text/reply fingerprints or request another AI draft. Media is not sent to the AI: repliers inspect it themselves before approving a reply.

Only HTTPS URLs on the appropriate Google media domains are accepted. Author labels render as plain text. Videos load only on demand; images load lazily without an image proxy/cache. Expired or inaccessible previews show a refresh/open-in-Google fallback. Browser playback depends on Google's URL access and browser codec support. No URLs are fabricated when Google omits a field, and an empty attachment list means no media was returned by the API, not proof the review has no attachments in Google's UI.

Existing reviews acquire attachments when fetched again. Incremental sync retains its existing pagination limits; a full review sync is needed to backfill all older reviews. This change does not initiate a production-wide backfill or make additional Google requests per review.

The separate [customer media endpoint](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media.customers/list) returns location-level contributions. Do not match that gallery to reviews by contributor name or time. The implementation uses only the review's own attachment list.

Validation uses synthetic Google responses and isolated local Postgres data. Live attachment availability, expiry and video playback need observation with a connected profile returning real media; no customer attachments were downloaded or Google replies posted during validation.
