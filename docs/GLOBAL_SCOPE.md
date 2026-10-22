# Global scope

The header scope selector is the only organisation, group, and outlet control on review screens. Later phases should read this contract instead of adding another client, group, or location dropdown.

## Names

| Selector label | Stored as | Table |
| --- | --- | --- |
| Organisation | client | `grm_clients` |
| Group | group | `grm_groups` (a region, or a city whose `parent_id` is that region) |
| Outlet | location | `grm_google_locations` |

A group is a set of locations. Reviews stay on `location_id`. Selecting a group does not copy reviews.

The workspace is the tenant. It is not a fourth scope level. When a member can see more than one organisation, the top row is the workspace ("All organisations") and `clientId` is null.

## URL

Keep using `client`, `group`, and `location`. Do not add `organisation` or `outlet` params.

`lib/scope.ts` is the pure model:

- `readScopeRequest` keeps only UUIDs.
- `resolveScope(catalog, request)` returns one level: `organisation`, `group`, or `location`.
- `locationIds` is the authorised set for that selection.
- A group includes locations on that group and on its child cities (`locationInGroup`).
- A location selection clears the group id so queries are not combined with a stale group.
- An unknown or other-tenant id sets `dropped` and falls back inside the catalog. It is never copied into `locationIds`.
- A permission that no longer matches a place sets `blocked`. `clientId`, `groupId`, and `locationId` are then `UNAVAILABLE_SCOPE_ID` and `locationIds` is empty. Pass those ids through. Do not turn them into null, or the query becomes "everything".

## Server

Pages and exports call `readPageScope(userId, workspaceId, searchParams)` from `lib/services/scope-catalog.ts`.

Pass `clientId`, `groupId`, and `locationId` into the existing workspace-scoped query (`getDashboardContext`, inbox, escalations, review export). The catalog is loaded with the service role and then cut to the member's lock (`visibleCatalog`). Row filters still include `workspace_id`.

Do not filter access in the browser. The selector only writes the URL.

`lib/shell.ts` `scopedHref` copies `client`, `group`, and `location` onto the next review route. Page filters such as `rating`, `filter`, `q`, `assignee`, and `stars` stay on the page that owns them.

Changing scope deletes `page` only. Date range, rating, status, sentiment, and assignee stay, and the dataset is their intersection with `locationIds`. Clear a local filter only when that value cannot exist in the new scope.

Sidebar badges stay at the permission boundary. The dashboard layout cannot read the URL, so badges are not selection-scoped.

## Screens

Overview, Inbox, Escalations, Analytics, Reports, Review requests, and the agency home all call `readPageScope`. Phone routes under `/m` use the same resolver.

The header owns the selector. Do not render a second client, group, or location control on these screens.

## Later phases

Import `readPageScope` at the top of the server page or route. Thread the three ids into the query you already have. If a new list is location-based, filter with `scope.locationIds` (an empty array means no rows). Do not add a new hierarchy table for this selector.
