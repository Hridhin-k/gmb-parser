import { describe, expect, it } from "vitest";
import { escapeOrSearchValue, orIlikeAny } from "@/lib/postgrest-search";

describe("orIlikeAny", () => {
  it("quotes phrases containing commas so the logic tree still parses", () => {
    // Regression: an insight evidence link searches the inbox with the
    // first words of a review excerpt — "We tried on a dress, and…"
    // used to crash the reviews page with "failed to parse logic tree".
    expect(orIlikeAny(["comment", "reviewer_display_name"], "We tried on a dress, and")).toBe(
      'comment.ilike."%We tried on a dress, and%",reviewer_display_name.ilike."%We tried on a dress, and%"'
    );
  });

  it("keeps parentheses inside the quoted value", () => {
    expect(orIlikeAny(["comment"], "Norms (Pvt) Ltd")).toBe('comment.ilike."%Norms (Pvt) Ltd%"');
  });

  it("neutralises LIKE wildcards so user text matches literally", () => {
    expect(escapeOrSearchValue("100%")).toBe("100\\%");
    expect(escapeOrSearchValue("a_b")).toBe("a\\_b");
    expect(orIlikeAny(["comment"], "50%_off")).toBe('comment.ilike."%50\\%\\_off%"');
  });

  it("escapes quotes and backslashes", () => {
    expect(escapeOrSearchValue('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeOrSearchValue("a\\b")).toBe("a\\\\b");
  });

  it("leaves plain text untouched apart from quoting", () => {
    expect(orIlikeAny(["comment"], "hostile staff")).toBe('comment.ilike."%hostile staff%"');
  });
});
