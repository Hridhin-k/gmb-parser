# Blocked AI reply recovery

The reported production failures were traced to eight `reply_draft` provider
responses recorded as `content-filter`. Bulk job history identifies five distinct
affected reviews, all rating-only reviews with no written comment. Four still had
no saved reply when investigated. The historical records did not preserve Google's
raw rejection reason, so they cannot establish whether those requests were
stopped for safety or recitation.

The Google SDK maps several provider finish reasons to `content-filter`, including
`SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT` and `SPII`.
[Google documents the distinct finish reasons and prompt feedback](https://ai.google.dev/api/generate-content#finishreason).
The application now distinguishes recitation (`AI_RECITATION_BLOCKED`) from safety
blocks (`AI_SAFETY_BLOCKED`). Both return actionable messages; neither is retried
automatically or sent to a fallback provider.

For an initial rating-only draft, a confirmed provider content block can recover
using a small set of prepared acknowledgement templates. Only the star rating is
used. The model's blocked output is discarded. Templates are checked against
reply guardrails and the workspace/location never-say rules, then selected saved
contact details can be appended through the usual human-requested contact flow.
The existing approval and publishing checks remain in force.

Recovery is intentionally limited:

- Written comments, existing drafts, language changes and other rewrites do not
  receive a generic replacement. A blocked response leaves the prior draft intact
  and offers manual writing or the existing template actions.
- Budget, billing, configuration, truncation, timeout and unknown network failures
  are not treated as content blocks and cannot activate the template fallback.
- If the configured rules reject every prepared template, generation stays
  blocked with a manual recovery message.
- No safety threshold or provider protection is disabled. There are no additional
  paid calls to recover a blocked rating-only draft.

Template drafts use the `template` reply source (migration
`0017_template_reply_source.sql`) and `template:rating-only-v1` provenance.
Single-item generation, background saves and bulk results preserve that source;
the inbox displays **Template draft** and explains why it was prepared. The audit
log records `reply.template_generated` with the original failure code. The failed
provider attempt is still accounted for against its actual provider/model.

Audit diagnostics retain the raw finish reason when exposed, prompt/output block
stage, provider block code and bounded safety categories/probabilities. They do
not copy provider response text, blocked output or prompt-feedback messages.
