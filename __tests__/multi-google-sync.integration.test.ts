import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { GoogleBusinessProfileService as Profiles } from "@/lib/services/google-business-profile";
import { GoogleOAuthService } from "@/lib/services/google-oauth";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("multiple Google logins in one workspace", () => {
  const ws = randomUUID(), otherWs = randomUUID(), user = randomUUID(), a = randomUUID(), b = randomUUID();
  let ready = false;
  const accounts = vi.spyOn(Profiles, "listAccounts");
  const locations = vi.spyOn(Profiles, "listLocations");
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") throw new Error("Dedicated local database required");
    await getPool().query("INSERT INTO authn.users(id,email) VALUES($1,$2)", [user, `${user}@grm.test`]);
    await getPool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES($1,'Multi-account QA',$2),($3,'Other QA',$4)", [ws, `test-${ws}`, otherWs, `test-${otherWs}`]);
    ready = true;
    await getPool().query(`INSERT INTO grm_google_connections(id,workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at)
      VALUES($1,$3,$4,'first@example.test','test','test',now()),($2,$3,$4,'second@example.test','test','test',now())`, [a, b, ws, user]);
    vi.spyOn(GoogleOAuthService, "getValidAccessToken").mockImplementation(async (id) => id);
    accounts.mockImplementation(async (token) => [{ name: token === a ? "accounts/a" : "accounts/b", accountName: "QA", type: "PERSONAL", role: "OWNER", state: { status: "VERIFIED" } }]);
    locations.mockImplementation(async (token) => token === a
      ? [{ name: "locations/shared", title: "Shared store", storeCode: "SHARED" }]
      : [{ name: "locations/shared", title: "Shared store", storeCode: "SHARED" }, { name: "locations/second", title: "Second store" }]);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (ready) {
      await getPool().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, otherWs]]);
      await getPool().query("DELETE FROM authn.users WHERE id=$1", [user]);
      await getPool().end();
    }
  });

  it("discovers both logins independently and keeps shared profiles and saved contacts intact", async () => {
    expect((await Profiles.syncConnectionAccounts(a, ws)).locationsUpserted).toBe(1);
    const { rows: [original] } = await getPool().query("SELECT id,client_id,google_account_id,google_location_name FROM grm_google_locations WHERE workspace_id=$1", [ws]);
    await getPool().query("UPDATE grm_google_locations SET resolution_email='manager@example.test' WHERE id=$1", [original.id]);
    expect((await Profiles.syncConnectionAccounts(b, ws)).locationsUpserted).toBe(2);
    const { rows } = await getPool().query("SELECT id,client_id,google_account_id,google_location_name,resolution_email FROM grm_google_locations WHERE workspace_id=$1", [ws]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === original.id)).toMatchObject({ ...original, resolution_email: "manager@example.test" });
    const { rows: times } = await getPool().query("SELECT last_profile_sync_at FROM grm_google_connections WHERE workspace_id=$1", [ws]);
    expect(times.every((row) => Boolean(row.last_profile_sync_at))).toBe(true);
    const before = accounts.mock.calls.length;
    expect((await Profiles.syncConnectionAccounts(a, ws)).skippedGoogleFetch).toBe(true);
    expect(accounts.mock.calls.length).toBe(before);
  });

  it("review sync timestamps do not suppress discovery and a failed login remains retryable", async () => {
    await getPool().query("UPDATE grm_google_connections SET last_profile_sync_at=NULL WHERE id=$1", [b]);
    accounts.mockRejectedValueOnce(new Error("Mock Google unavailable"));
    await expect(Profiles.syncConnectionAccounts(b, ws)).rejects.toThrow("Mock Google unavailable");
    expect((await getPool().query("SELECT last_profile_sync_at FROM grm_google_connections WHERE id=$1", [b])).rows[0].last_profile_sync_at).toBeNull();
    expect((await Profiles.syncConnectionAccounts(b, ws)).skippedGoogleFetch).toBe(false);
    const before = accounts.mock.calls.length;
    await expect(Profiles.syncConnectionAccounts(a, otherWs)).rejects.toThrow("not found");
    expect(accounts.mock.calls.length).toBe(before);
  });

  it("does not transfer a shared Business Profile account from a working login", async () => {
    accounts.mockResolvedValueOnce([{ name: "accounts/a", accountName: "Shared account", type: "PERSONAL", role: "OWNER", state: { status: "VERIFIED" } }]);
    await Profiles.syncConnectionAccounts(b, ws, { force: true });
    expect((await getPool().query("SELECT connection_id FROM grm_google_accounts WHERE workspace_id=$1 AND google_account_name='accounts/a'", [ws])).rows[0].connection_id).toBe(a);
  });
});
