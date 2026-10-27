import { describe, expect, it } from "vitest";
import { clearSupabaseAuthCookies } from "@/lib/supabase/clear-auth-cookies";

describe("clearSupabaseAuthCookies", () => {
  it("expires every sb-* cookie on the store and optional response", () => {
    const setCalls: Array<{ name: string; maxAge: number }> = [];
    const responseCalls: Array<{ name: string; maxAge: number }> = [];
    const cleared = clearSupabaseAuthCookies(
      {
        getAll: () => [
          { name: "sb-yzagcxdzlsjpowokqewm-auth-token.0" },
          { name: "sb-yrmlbimuupirmttngxys-auth-token" },
          { name: "other" },
        ],
        set: (name, _value, options) => {
          setCalls.push({ name, maxAge: options.maxAge });
        },
      },
      {
        cookies: {
          set: (name, _value, options) => {
            responseCalls.push({ name, maxAge: options.maxAge });
          },
        },
      }
    );
    expect(cleared).toEqual([
      "sb-yzagcxdzlsjpowokqewm-auth-token.0",
      "sb-yrmlbimuupirmttngxys-auth-token",
    ]);
    expect(setCalls.every((call) => call.maxAge === 0)).toBe(true);
    expect(responseCalls.map((call) => call.name)).toEqual(cleared);
  });

  it("preserves cookies for the active project ref", () => {
    const cleared = clearSupabaseAuthCookies(
      {
        getAll: () => [
          { name: "sb-yzagcxdzlsjpowokqewm-auth-token.0" },
          { name: "sb-yrmlbimuupirmttngxys-auth-token" },
          { name: "sb-yrmlbimuupirmttngxys-auth-token-code-verifier" },
        ],
        set: () => undefined,
      },
      undefined,
      "yrmlbimuupirmttngxys"
    );
    expect(cleared).toEqual(["sb-yzagcxdzlsjpowokqewm-auth-token.0"]);
  });
});
