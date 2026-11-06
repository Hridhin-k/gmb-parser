# Editing a published response

In Reviews → Sent, choose **Edit response**. The editor starts with the latest reply text returned by Google, including replies originally posted outside the app. Cancel leaves all saved data and the live reply unchanged.

**Save update draft** saves locally, resets approval, and opens the draft in **To reply**. The current Google response stays live. Review the update, then choose **Send update** (or submit for approval if your role requires it). The existing approval and publishing flow updates the same Google review reply. Customer edits are flagged for a person to check; the app does not decide that the public reply must be rewritten automatically.

Manual editing follows the same permissions and public-text guardrails as other manual drafts. AI-only members cannot edit text. Pending publishes cannot be edited. Conflicting saves are rejected rather than silently overwriting another editor's work. Saving clears approval, old failure/retry state and client approval, and records the prior draft/live text and proposed replacement in the audit log. The draft and audit record commit together. No Google write or AI call occurs while editing or saving.

## Review update notifications

Google supports `NEW_REVIEW` and `UPDATED_REVIEW` notifications through [Cloud Pub/Sub](https://developers.google.com/my-business/content/notification-setup), with the review resource name in the event. See Google's [notification types](https://developers.google.com/my-business/reference/notifications/rest/v1/NotificationSetting#NotificationType).

The current configured daily catch-up runs at 04:00 UTC and selects reviews **created within the last 30 days**. Although the Google list is sorted by update time, older review edits are excluded by the import's creation-date filter. A full All time sync picks them up. Daily catch-up alone therefore does not cover every historical edit.

A notification integration should authenticate Pub/Sub push messages, deduplicate deliveries, map the account/location to its workspace, and fetch the individual review without the recent creation-date restriction. Daily polling should remain as reconciliation. Google Cloud topic/subscription permissions and Business Profile account notification settings must be configured before this is live. This change adds response editing; it does not enable Pub/Sub notifications. That work remains in the separate webhook task.
