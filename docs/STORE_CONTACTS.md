# Store contacts for customer replies

In **Settings → Follow-up rules → Customer contact details**, choose a store to
save its manager or customer care phone/email. Choose **Default for stores without
their own contact** to edit the workspace default.

A store with either field saved uses only its own contact. We do not combine a
store phone with the default email (or vice versa). Clearing both store fields
restores the workspace default. Google's synced public phone is separate and
never overwrites this contact.

Reviews, follow-ups and mobile approval/escalation screens resolve contacts from
the selected review's location. Bulk drafts resolve each review independently;
the menu offers phone/email/both only when every selected review supports that
choice. If a contact is removed after the page loads, server-side drafting rejects
the missing choice before an AI call.

Saving requires the existing `edit_rules` permission for that location. Workspace
defaults require workspace scope. Contact changes record their scope, location ID,
before/after values and whether the store now inherits the default in the audit
log. Reads and writes are restricted by workspace; the settings picker includes
only visible stores.

Contacts are appended to drafts only on an explicit human action and are not
sent to the AI provider. Saved contacts can appear in public Google replies, so
use a contact intended for customers. Existing drafts and published replies are
not rewritten by saving a new contact.

Database migration: `0018_store_resolution_contacts.sql` adds nullable
`resolution_phone` and `resolution_email` fields to `grm_google_locations`.
