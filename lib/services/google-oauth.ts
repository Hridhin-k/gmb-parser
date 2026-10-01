import { OAuth2Client } from "google-auth-library";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "./audit";
import { AppError } from "@/lib/errors";
import crypto from "crypto";

// The single scope required by all Google Business Profile APIs.
// https://developers.google.com/my-business/content/implement-oauth
const GBP_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "openid",
  "email",
];

// Token expiry buffer — refresh 5 minutes before actual expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// AES-256-GCM token encryption
//
// Tokens are encrypted at rest so that even direct database access cannot
// expose usable credentials. The encryption key must be 32 bytes (64 hex chars)
// and stored in TOKEN_ENCRYPTION_KEY — never in the database.
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12; // 96 bits — GCM standard
// GCM authentication tag is fixed at 128 bits (16 bytes) by the cipher itself

function getEncryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new AppError(
      "TOKEN_ENCRYPTION_KEY is missing or invalid. Generate with: openssl rand -hex 32",
      "CONFIG_ERROR",
      500
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a plaintext token using AES-256-GCM.
 * Output format: <iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a token encrypted by encryptToken.
 * Throws AppError if the ciphertext is tampered or the key is wrong.
 */
export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new AppError("Malformed encrypted token", "CRYPTO_ERROR", 500);
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(
      "Token decryption failed — possible data tampering",
      "CRYPTO_ERROR",
      500
    );
  }
}

// ---------------------------------------------------------------------------
// HMAC-signed OAuth state
//
// Base64url-encoding alone does not prevent a CSRF attacker from supplying
// a crafted state payload. We sign the payload with HMAC-SHA256 using the
// same encryption key so any tampering is detected during validation.
// ---------------------------------------------------------------------------

interface OAuthStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

function signState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = getEncryptionKey();
  const sig = crypto
    .createHmac("sha256", key)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(state: string): OAuthStatePayload {
  const dot = state.lastIndexOf(".");
  if (dot === -1) {
    throw new AppError("Invalid OAuth state format", "OAUTH_INVALID_STATE", 400);
  }
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const key = getEncryptionKey();
  const expected = crypto
    .createHmac("sha256", key)
    .update(body)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new AppError("OAuth state signature invalid", "OAUTH_INVALID_STATE", 400);
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    throw new AppError("Malformed OAuth state payload", "OAUTH_INVALID_STATE", 400);
  }

  if (!payload.workspaceId || !payload.userId || !payload.nonce) {
    throw new AppError("Incomplete OAuth state payload", "OAUTH_INVALID_STATE", 400);
  }

  if (Date.now() > payload.expiresAt) {
    throw new AppError("OAuth state has expired", "OAUTH_STATE_EXPIRED", 400);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// OAuth client factory
// ---------------------------------------------------------------------------

function getOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new AppError(
      "Google OAuth is not configured",
      "CONFIG_ERROR",
      500
    );
  }

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

// ---------------------------------------------------------------------------
// GoogleOAuthService
// ---------------------------------------------------------------------------

export class GoogleOAuthService {
  /**
   * Generates the Google OAuth authorization URL with an HMAC-signed state parameter.
   * The state includes workspace/user context and a random nonce to prevent CSRF.
   */
  static createAuthorizationUrl(workspaceId: string, userId: string): string {
    const client = getOAuthClient();

    const statePayload: OAuthStatePayload = {
      workspaceId,
      userId,
      nonce: crypto.randomBytes(16).toString("hex"),
      expiresAt: Date.now() + 10 * 60 * 1000, // 10-minute validity
    };

    return client.generateAuthUrl({
      access_type: "offline",
      scope: GBP_SCOPES,
      state: signState(statePayload),
      prompt: "consent",
      include_granted_scopes: false,
    });
  }

  /**
   * Validates the HMAC-signed state parameter from the OAuth callback.
   * Returns the decoded payload or throws on tampering/expiry.
   */
  static validateState(state: string): OAuthStatePayload {
    return verifyState(state);
  }

  /**
   * Handles the full OAuth callback flow:
   * 1. Validate and verify HMAC state
   * 2. Exchange authorization code for tokens
   * 3. Encrypt tokens before storage
   * 4. Fetch Google user email
   * 5. Store connection in database
   */
  static async handleCallback(
    code: string,
    state: string
  ): Promise<{ workspaceId: string; googleEmail: string }> {
    const { workspaceId, userId } = this.validateState(state);
    const client = getOAuthClient();

    let accessToken: string;
    let refreshToken: string;
    let expiryDate: number;
    let scopes: string;

    try {
      const { tokens } = await client.getToken(code);

      if (!tokens.access_token) {
        throw new AppError(
          "Google did not return an access token",
          "OAUTH_TOKEN_EXCHANGE_FAILED",
          502
        );
      }

      if (!tokens.refresh_token) {
        throw new AppError(
          "Google did not return a refresh token. This may happen if the account was previously connected. Please revoke access in your Google account settings and try again.",
          "OAUTH_NO_REFRESH_TOKEN",
          400
        );
      }

      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token;
      expiryDate = tokens.expiry_date ?? Date.now() + 3600 * 1000;
      scopes = tokens.scope ?? GBP_SCOPES.join(" ");
    } catch (error) {
      if (error instanceof AppError) throw error;

      const message = error instanceof Error ? error.message : "Unknown";

      if (message.includes("invalid_grant")) {
        throw new AppError(
          "The authorization code is invalid or has already been used",
          "OAUTH_INVALID_GRANT",
          400
        );
      }

      await AuditService.log({
        workspaceId,
        userId,
        action: "google_connection.failed",
        entityType: "grm_google_connections",
        metadata: { error: message } as Record<string, unknown>,
      });

      throw new AppError(
        "Failed to exchange authorization code",
        "OAUTH_TOKEN_EXCHANGE_FAILED",
        502,
        { originalError: message }
      );
    }

    // Fetch the Google email for display
    const googleEmail = await this.fetchGoogleEmail(accessToken);

    // Encrypt tokens before writing to database
    const accessTokenEnc = encryptToken(accessToken);
    const refreshTokenEnc = encryptToken(refreshToken);

    const supabase = createAdminClient();
    const { error: upsertError } = await supabase
      .from("grm_google_connections")
      .upsert(
        {
          workspace_id: workspaceId,
          authorized_by_user_id: userId,
          google_email: googleEmail,
          access_token_enc: accessTokenEnc,
          refresh_token_enc: refreshTokenEnc,
          token_expires_at: new Date(expiryDate).toISOString(),
          scopes: scopes.split(" "),
          status: "active",
          last_refreshed_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,google_email" }
      );

    if (upsertError) {
      throw new AppError(
        "Failed to store Google connection",
        "DB_ERROR",
        500,
        { dbError: upsertError.message }
      );
    }

    await AuditService.log({
      workspaceId,
      userId,
      action: "google_connection.created",
      entityType: "grm_google_connections",
      metadata: { googleEmail } as Record<string, unknown>,
    });

    return { workspaceId, googleEmail };
  }

  /**
   * Returns a valid (decrypted) access token for the given connection.
   * Automatically refreshes if expired or about to expire.
   */
  static async getValidAccessToken(connectionId: string): Promise<string> {
    const supabase = createAdminClient();

    const { data: connection, error } = await supabase
      .from("grm_google_connections")
      .select("id, access_token_enc, refresh_token_enc, token_expires_at, status, workspace_id")
      .eq("id", connectionId)
      .single();

    if (error || !connection) {
      throw new AppError("Google connection not found", "NOT_FOUND", 404);
    }

    if (connection.status === "revoked") {
      throw new AppError(
        "This Google connection has been revoked",
        "OAUTH_REVOKED",
        403
      );
    }

    const expiresAt = new Date(connection.token_expires_at).getTime();
    const isExpired = Date.now() >= expiresAt - TOKEN_REFRESH_BUFFER_MS;

    if (!isExpired) {
      return decryptToken(connection.access_token_enc);
    }

    // Refresh the token — pass the encrypted refresh token; method decrypts internally
    return this.refreshAccessToken(connection.id, connection.refresh_token_enc);
  }

  /**
   * Refreshes the access token using the stored (encrypted) refresh token.
   * Updates the database with the new encrypted access token and expiry.
   */
  static async refreshAccessToken(
    connectionId: string,
    refreshTokenEnc: string
  ): Promise<string> {
    const refreshToken = decryptToken(refreshTokenEnc);
    const client = getOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });

    const supabase = createAdminClient();

    try {
      const { credentials } = await client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error("No access token in refresh response");
      }

      const newAccessTokenEnc = encryptToken(credentials.access_token);

      await supabase
        .from("grm_google_connections")
        .update({
          access_token_enc: newAccessTokenEnc,
          token_expires_at: new Date(
            credentials.expiry_date ?? Date.now() + 3600 * 1000
          ).toISOString(),
          last_refreshed_at: new Date().toISOString(),
          status: "active",
        })
        .eq("id", connectionId);

      return credentials.access_token;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown";

      // invalid_grant means the refresh token is no longer valid
      if (message.includes("invalid_grant")) {
        await supabase
          .from("grm_google_connections")
          .update({ status: "revoked" })
          .eq("id", connectionId);

        throw new AppError(
          "Google authorization has been revoked. Please reconnect your Google account.",
          "OAUTH_INVALID_GRANT",
          401
        );
      }

      // Mark as expired so the UI can prompt re-auth
      await supabase
        .from("grm_google_connections")
        .update({ status: "expired" })
        .eq("id", connectionId);

      throw new AppError(
        "Failed to refresh Google access token",
        "OAUTH_REFRESH_FAILED",
        502,
        { originalError: message }
      );
    }
  }

  /**
   * Revokes the Google OAuth connection and marks it in the database.
   */
  static async revokeConnection(
    connectionId: string,
    workspaceId: string,
    userId: string
  ): Promise<void> {
    const supabase = createAdminClient();

    const { data: connection, error } = await supabase
      .from("grm_google_connections")
      .select("id, access_token_enc, google_email")
      .eq("id", connectionId)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !connection) {
      throw new AppError("Google connection not found", "NOT_FOUND", 404);
    }

    // Attempt to revoke at Google — best effort, don't fail if Google returns error
    try {
      const client = getOAuthClient();
      const plainToken = decryptToken(connection.access_token_enc);
      await client.revokeToken(plainToken);
    } catch {
      // Google revocation is best-effort; the token may already be invalid
    }

    await supabase
      .from("grm_google_connections")
      .update({ status: "revoked" })
      .eq("id", connectionId);

    await AuditService.log({
      workspaceId,
      userId,
      action: "google_connection.revoked",
      entityType: "grm_google_connections",
      entityId: connectionId,
      metadata: { googleEmail: connection.google_email } as Record<string, unknown>,
    });
  }

  /**
   * Fetches the authenticated Google user's email address.
   */
  private static async fetchGoogleEmail(accessToken: string): Promise<string> {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new AppError(
        "Failed to fetch Google user info",
        "GOOGLE_API_ERROR",
        502
      );
    }

    const data = (await response.json()) as { email?: string };

    if (!data.email) {
      throw new AppError(
        "Google did not return an email address",
        "GOOGLE_API_ERROR",
        502
      );
    }

    return data.email;
  }

  /**
   * Gets all active connections for a workspace (safe — no token columns).
   */
  static async getWorkspaceConnections(workspaceId: string) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("grm_google_connections")
      .select(
        "id, workspace_id, authorized_by_user_id, google_email, scopes, status, last_refreshed_at, created_at, updated_at, token_expires_at"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new AppError("Failed to fetch connections", "DB_ERROR", 500);
    }

    return data;
  }
}
