import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Set env before any module import
// ---------------------------------------------------------------------------
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/google/callback";
// Valid 64-hex-char key for AES-256-GCM in tests
process.env.TOKEN_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000001";

// ---------------------------------------------------------------------------
// Shared mock instance — all tests mutate methods on this single object
// ---------------------------------------------------------------------------
const mockOAuthInstance = {
  generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?mock"),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
};

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(function () {
    return mockOAuthInstance;
  }),
}));

const mockSupabaseFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

vi.mock("@/lib/services/audit", () => ({
  AuditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

import { GoogleOAuthService, encryptToken, decryptToken } from "@/lib/services/google-oauth";
import { AppError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a properly HMAC-signed state by going through createAuthorizationUrl
 * and extracting the state parameter from the generated URL args.
 */
function createValidState(overrides?: Partial<{
  workspaceId: string;
  userId: string;
}>) {
  const workspaceId = overrides?.workspaceId ?? "ws-123";
  const userId = overrides?.userId ?? "user-456";

  // Capture the state that createAuthorizationUrl produces
  let capturedState = "";
  mockOAuthInstance.generateAuthUrl.mockImplementationOnce((opts: { state?: string }) => {
    capturedState = opts.state ?? "";
    return "https://accounts.google.com/o/oauth2/v2/auth?mock";
  });

  GoogleOAuthService.createAuthorizationUrl(workspaceId, userId);
  return capturedState;
}

/**
 * Creates an unsigned (raw base64url) state — used to test that unsigned
 * states are rejected.
 */
function createUnsignedState(payload: object) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoogleOAuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    mockOAuthInstance.generateAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?mock"
    );
  });

  // =========================================================================
  // encryptToken / decryptToken
  // =========================================================================
  describe("encryptToken / decryptToken", () => {
    it("round-trips a token correctly", () => {
      const original = "ya29.some-access-token";
      const encrypted = encryptToken(original);
      expect(encrypted).not.toContain(original);
      expect(decryptToken(encrypted)).toBe(original);
    });

    it("produces different ciphertext each call (random IV)", () => {
      const original = "ya29.token";
      expect(encryptToken(original)).not.toBe(encryptToken(original));
    });

    it("throws on tampered ciphertext", () => {
      const encrypted = encryptToken("secret");
      const parts = encrypted.split(":");
      // Flip a byte in the ciphertext
      parts[2] = "ff" + parts[2].slice(2);
      expect(() => decryptToken(parts.join(":"))).toThrow(AppError);
    });
  });

  // =========================================================================
  // createAuthorizationUrl
  // =========================================================================
  describe("createAuthorizationUrl", () => {
    it("returns a Google authorization URL", () => {
      const url = GoogleOAuthService.createAuthorizationUrl("ws-123", "user-456");
      expect(url).toContain("accounts.google.com");
    });

    it("passes HMAC-signed state containing workspace and user IDs", () => {
      GoogleOAuthService.createAuthorizationUrl("ws-123", "user-456");

      const args = mockOAuthInstance.generateAuthUrl.mock.calls[0][0] as {
        state: string;
      };

      // State must be signed (body.signature format)
      expect(args.state).toContain(".");

      // Validate via the service — should not throw and should contain correct IDs
      const decoded = GoogleOAuthService.validateState(args.state);
      expect(decoded.workspaceId).toBe("ws-123");
      expect(decoded.userId).toBe("user-456");
      expect(decoded.nonce).toBeTruthy();
      expect(decoded.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  // =========================================================================
  // validateState
  // =========================================================================
  describe("validateState", () => {
    it("returns decoded payload for valid signed state", () => {
      const state = createValidState();
      const result = GoogleOAuthService.validateState(state);
      expect(result.workspaceId).toBe("ws-123");
      expect(result.userId).toBe("user-456");
    });

    it("throws on invalid format (no dot separator)", () => {
      expect(() =>
        GoogleOAuthService.validateState("nodothere")
      ).toThrow(AppError);
    });

    it("throws on tampered signature", () => {
      const state = createValidState();
      const tampered = state.slice(0, -4) + "XXXX";
      expect(() => GoogleOAuthService.validateState(tampered)).toThrow(AppError);
    });

    it("throws when state is expired", () => {
      // Build a state with past expiry — must sign it properly
      // We manipulate via mocking the Date
      const realNow = Date.now;
      Date.now = () => realNow() - 20 * 60 * 1000; // shift 'now' back 20 min when creating
      const state = createValidState();
      Date.now = realNow; // restore

      expect(() => GoogleOAuthService.validateState(state)).toThrow(/expired/i);
    });

    it("throws on unsigned state (no HMAC)", () => {
      const payload = { workspaceId: "ws-123", userId: "user-456", nonce: "abc", expiresAt: Date.now() + 600000 };
      const state = createUnsignedState(payload);
      // Unsigned state has no dot, so it fails format check
      expect(() => GoogleOAuthService.validateState(state)).toThrow(AppError);
    });

    it("throws when workspaceId is missing in payload", () => {
      // We can't forge a valid signature, so verify that even a well-formed but
      // incomplete payload is rejected. Use a manipulated state produced by createValidState
      // then corrupt the body portion.
      const state = createValidState();
      const dot = state.lastIndexOf(".");
      const body = state.slice(0, dot);
      const sig = state.slice(dot + 1);

      // Decode body, remove workspaceId, re-encode — signature won't match
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
      delete payload.workspaceId;
      const newBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const forged = `${newBody}.${sig}`;

      expect(() => GoogleOAuthService.validateState(forged)).toThrow(AppError);
    });
  });

  // =========================================================================
  // handleCallback
  // =========================================================================
  describe("handleCallback", () => {
    it("throws on invalid_grant error from Google", async () => {
      mockOAuthInstance.getToken.mockRejectedValueOnce(new Error("invalid_grant"));

      const state = createValidState();
      await expect(
        GoogleOAuthService.handleCallback("bad-code", state)
      ).rejects.toThrow(/invalid or has already been used/i);
    });

    it("throws when Google does not return refresh_token", async () => {
      mockOAuthInstance.getToken.mockResolvedValueOnce({
        tokens: {
          access_token: "at-123",
          refresh_token: null,
          expiry_date: Date.now() + 3600000,
        },
      });

      const state = createValidState();
      await expect(
        GoogleOAuthService.handleCallback("some-code", state)
      ).rejects.toThrow(/refresh token/i);
    });

    it("stores connection on successful exchange", async () => {
      mockOAuthInstance.getToken.mockResolvedValueOnce({
        tokens: {
          access_token: "at-valid",
          refresh_token: "rt-valid",
          expiry_date: Date.now() + 3600000,
          scope: "https://www.googleapis.com/auth/business.manage openid email",
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "user@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      mockSupabaseFrom.mockReturnValue({
        upsert: vi.fn().mockReturnValue({ error: null }),
      });

      const state = createValidState();
      const result = await GoogleOAuthService.handleCallback("good-code", state);

      expect(result.googleEmail).toBe("user@example.com");
      expect(result.workspaceId).toBe("ws-123");
      expect(mockSupabaseFrom).toHaveBeenCalledWith("grm_google_connections");

      // Confirm the stored tokens are encrypted, not plaintext
      const upsertCall = mockSupabaseFrom().upsert as ReturnType<typeof vi.fn>;
      if (upsertCall.mock.calls.length > 0) {
        const storedData = upsertCall.mock.calls[0][0] as Record<string, string>;
        expect(storedData.access_token_enc).not.toBe("at-valid");
        expect(storedData.refresh_token_enc).not.toBe("rt-valid");
      }
    });
  });

  // =========================================================================
  // refreshAccessToken
  // =========================================================================
  describe("refreshAccessToken", () => {
    it("returns new access token on success", async () => {
      mockOAuthInstance.refreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: "new-at",
          expiry_date: Date.now() + 3600000,
        },
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ error: null }),
      });
      mockSupabaseFrom.mockReturnValue({ update: mockUpdate });

      // refreshAccessToken now receives an encrypted refresh token
      const encryptedRt = encryptToken("rt-valid");
      const token = await GoogleOAuthService.refreshAccessToken("conn-123", encryptedRt);
      expect(token).toBe("new-at");
    });

    it("marks connection revoked on invalid_grant", async () => {
      mockOAuthInstance.refreshAccessToken.mockRejectedValueOnce(
        new Error("invalid_grant: Token has been revoked")
      );

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ error: null }),
      });
      mockSupabaseFrom.mockReturnValue({ update: mockUpdate });

      const encryptedRt = encryptToken("bad-rt");
      await expect(
        GoogleOAuthService.refreshAccessToken("conn-123", encryptedRt)
      ).rejects.toThrow(/revoked/i);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "revoked" })
      );
    });

    it("marks connection expired on non-invalid_grant error", async () => {
      mockOAuthInstance.refreshAccessToken.mockRejectedValueOnce(
        new Error("network timeout")
      );

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ error: null }),
      });
      mockSupabaseFrom.mockReturnValue({ update: mockUpdate });

      const encryptedRt = encryptToken("rt-valid");
      await expect(
        GoogleOAuthService.refreshAccessToken("conn-123", encryptedRt)
      ).rejects.toThrow(/refresh/i);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "expired" })
      );
    });
  });

  // =========================================================================
  // getValidAccessToken
  // =========================================================================
  describe("getValidAccessToken", () => {
    it("returns decrypted cached token when not expired", async () => {
      const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const plainToken = "at-cached";
      const encryptedToken = encryptToken(plainToken);

      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({
              data: {
                id: "conn-1",
                access_token_enc: encryptedToken,
                refresh_token_enc: encryptToken("rt-cached"),
                token_expires_at: futureExpiry,
                status: "active",
                workspace_id: "ws-1",
              },
              error: null,
            }),
          }),
        }),
      });

      const token = await GoogleOAuthService.getValidAccessToken("conn-1");
      expect(token).toBe(plainToken);
    });

    it("throws when connection is revoked", async () => {
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({
              data: {
                id: "conn-1",
                access_token_enc: encryptToken("at"),
                refresh_token_enc: encryptToken("rt"),
                token_expires_at: new Date().toISOString(),
                status: "revoked",
                workspace_id: "ws-1",
              },
              error: null,
            }),
          }),
        }),
      });

      await expect(
        GoogleOAuthService.getValidAccessToken("conn-1")
      ).rejects.toThrow(/revoked/i);
    });

    it("throws when connection not found", async () => {
      mockSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({
              data: null,
              error: { message: "not found" },
            }),
          }),
        }),
      });

      await expect(
        GoogleOAuthService.getValidAccessToken("nonexistent")
      ).rejects.toThrow(/not found/i);
    });
  });
});
