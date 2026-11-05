# Multiple Google accounts

Use **Settings → Google connection → Connect another account** to authorize each
Google login for the current workspace. Your RevuPilot sign-in stays the same.
The authorization URL requests Google's account chooser plus offline consent;
see [Google's OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
Tokens remain encrypted and each login has its own connection row.

**Locations → Sync all Google accounts** and the portfolio action discover profiles
from every active login. Setup's profile picker also checks all active logins.
Settings offers **Sync this account** for a targeted retry. Accounts needing
reconnection remain listed separately.

The browser sends one sequential request per login. Each request rechecks the
connection's workspace membership, owner/admin sync permission and rate limit.
One failure or timeout is shown against that account while the others continue.
A timeout does not trigger an automatic retry: the request may still have saved
profiles, so check before retrying.

Discovery has a ten-minute cooldown per login using
`grm_google_connections.last_profile_sync_at` (migration
`0019_google_profile_sync_time.sql`). Review sync timestamps do not suppress
profile discovery. Reconnecting clears that login's discovery timestamp. Failed
fetches or database writes do not mark a discovery successful. Forced refresh
bypasses the cooldown for that account.

Profiles visible through several Google logins keep their canonical location ID,
resource name, business mapping, saved contacts and history. Existing historical
duplicates are not merged. A shared GBP account retains its working connection;
if that connection becomes unavailable, reconnect it, or resync another login
that manages the same GBP account. This change does not add automatic publishing
or change the scheduled review pipeline's per-location connection resolution.

Each sync records completion or failure with its connection ID, mode, counts or
safe error diagnostics in the audit log. OAuth credentials are never included.

Validation uses mocked Google responses and isolated local Postgres fixtures;
it does not grant access to a new real Google account or send public replies.
