# Automatic business grouping

During Google profile import, unassigned active stores are grouped by business title. Trailing store codes such as `(FAZ-TCR)` and numeric copy/Google-ID suffixes are removed; meaningful words such as `(Hospital)` are retained. Different titles otherwise need an explicit business assignment; the importer does not guess that unrelated names belong together.

Business identity normalises Unicode, letter case and whitespace, while preserving punctuation and the full name. A workspace-scoped unique marker prevents duplicate active businesses during concurrent imports. Old organisation markers are reused by business name without rewriting historical rows. Different workspaces never share business ownership.

Existing manual business assignments, groups and notes are preserved. Matching a uniquely named existing business reuses it without marking its notes as automatically managed. Legacy per-location auto businesses can be consolidated; a legacy business is archived only after a successful move leaves it with no stores, including held and inactive stores. Each successful store move records the previous and new business/group in the audit log.

Concurrent manual assignment or grouping takes precedence over the import snapshot. Review syncing, reply history and store-specific settings keep their location IDs. Grouped/held profiles require an explicit decision rather than automatic reassignment.
