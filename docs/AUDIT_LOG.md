# Audit log diagnostics

Settings → Security displays the saved metadata for every event. The reason is
shown in the row; **View details** expands nested results, full object and actor
IDs, the event ID and the exact UTC timestamp. Page search includes these
details. Action, actor, object and date filters still apply across the log.

## Failure coverage

- Reply publishing records the review, reply, location, business and Google
  connection/resource IDs, attempt number, failure count, stage, duration,
  classified error code/message, Google HTTP status when available, retryability,
  missing-review verification outcome and resulting state. Preflight and token
  refresh failures are recorded even when Google never receives the reply.
- An unconfirmed Google write stays pending and is explicitly logged as
  uncertain. Checking it again records the reconciliation result or failure.
- Every AI provider attempt records its operation, task, provider/model, finish
  reason, known usage, duration, request ID, fallback/attempt and outcome. Failures
  also record safe error codes/messages, available provider HTTP status and
  request/error identifiers, retryability and whether fallback will follow.
  Configuration and budget blocks say that no provider call was made.
- AI drafts/previews carry the actor and review/location/config context when
  available. Analysis batches carry their run and review IDs; synthesis carries
  its report ID. Non-human operations use a null actor, displayed as System
  (migration `0016_system_audit_events.sql`).
- Draft workflow and background save failures, guardrail blocks, observation
  validation/persistence failures, omitted batch reviews, failed analysis runs,
  failed reports and bulk jobs are recorded. Bulk summaries include failed
  review IDs and their errors without duplicating generated reply text.

## Data handling and limits

Metadata is scrubbed on insert and again when historical entries are displayed.
Credentials, authorization/cookie headers, raw request/response bodies, prompts
and stack fields are redacted recursively, including nested arrays. Numeric token
counts are preserved. AI SDK error bodies/messages are normalized before audit;
only bounded provider error identifiers and request IDs are extracted. Arbitrary
error metadata and provider-generated content are not copied into diagnostics.

Historical entries expose the metadata actually saved at the time; diagnostics
that were never recorded cannot be reconstructed. An AI request completing means
the provider returned usable output; separate workflow/save events describe later
validation or persistence failures. Request IDs correlate provider attempts,
including fallback. A provider request ID is absent when the provider/SDK does
not expose one. An uncertain publish never implies a successful Google reply.

Audit storage remains best effort. Database write errors are reported in server
logs with operation/workspace/object context, and cannot mask the original error,
turn a completed operation into a failure or trigger another paid AI call.
