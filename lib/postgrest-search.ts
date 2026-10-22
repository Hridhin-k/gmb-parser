/**
 * Building PostgREST `.or()` filters from user text.
 *
 * Inside a logic tree, commas and parentheses are structural: a search
 * phrase like "We tried on a dress, and…" makes the parser reject the
 * whole filter ("failed to parse logic tree"). Values that may contain
 * such characters must be double-quoted, with embedded quotes escaped,
 * and LIKE wildcards neutralised so the user's text is matched
 * literally.
 */

/** Escapes a raw search phrase for a literal LIKE match inside a quoted .or() operand. */
export function escapeOrSearchValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/"/g, '\\"');
}

/**
 * Returns an `.or()` filter matching `value` as a literal substring of
 * any of the given text columns, safe for arbitrary user input.
 * Example: orIlikeAny(["comment", "reviewer_display_name"], q)
 */
export function orIlikeAny(columns: readonly string[], value: string): string {
  const pattern = `"%${escapeOrSearchValue(value)}%"`;
  return columns.map((column) => `${column}.ilike.${pattern}`).join(",");
}
