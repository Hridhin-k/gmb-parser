import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { advanceLocalDemo, localDemoEnabled } from "@/lib/services/local-demo";

describe("local demo boundary", () => {
  const env = {
    NODE_ENV: "development", AUTH_DEV_OPEN_SIGNUP: "true", AUTH_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://app:example@127.0.0.1:55432/grm",
  } as NodeJS.ProcessEnv;

  it("requires development mode and the dedicated loopback database", () => {
    expect(localDemoEnabled(env)).toBe(true);
    expect(localDemoEnabled({ ...env, NODE_ENV: "production" })).toBe(false);
    expect(localDemoEnabled({ ...env, AUTH_DEV_OPEN_SIGNUP: "false" })).toBe(false);
    expect(localDemoEnabled({ ...env, AUTH_URL: "https://app.example.com" })).toBe(false);
    expect(localDemoEnabled({ ...env, DATABASE_URL: "postgresql://app:example@db.example.com:55432/grm" })).toBe(false);
    expect(localDemoEnabled({ ...env, DATABASE_URL: "postgresql://app:example@localhost:5432/grm" })).toBe(false);
  });
});

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("local demo setup in Postgres", () => {
  const ws = randomUUID(), other = randomUUID(), user = randomUUID(), outsider = randomUUID();
  let ready = false;
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    vi.stubEnv("NODE_ENV", "development");
    if (!localDemoEnabled()) throw new Error("Requires the dedicated local demo database");
    await getPool().query('INSERT INTO authn.users(id,email,name) VALUES ($1,$2,\'Demo test\')', [user, `${user}@grm.test`]);
    await getPool().query(`INSERT INTO grm_workspaces(id,name,slug,feature_flags)
      VALUES ($1,'Test demo',$2,'{"local_demo":true}'),($3,'Other workspace',$4,'{}')`,
    [ws, `test-${ws}`, other, `test-${other}`]);
    await getPool().query("INSERT INTO grm_workspace_members(workspace_id,user_id,role,active) VALUES ($1,$2,'owner',true)", [ws, user]);
    await getPool().query("INSERT INTO grm_onboarding(workspace_id,step) VALUES ($1,'connect')", [ws]);
    ready = true;
  });
  afterAll(async () => {
    if (ready) {
      await getPool().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, other]]);
      await getPool().query("DELETE FROM authn.users WHERE id=$1", [user]);
      await getPool().end();
    }
    vi.unstubAllEnvs();
  });

  it("rejects imports before connection and access outside an owned demo", async () => {
    await expect(advanceLocalDemo(ws, user, "demo-import")).rejects.toThrow("Connect the demo account first");
    await expect(advanceLocalDemo(ws, outsider, "demo-connect")).rejects.toThrow("Only a demo workspace admin");
    await expect(advanceLocalDemo(other, user, "demo-connect")).rejects.toThrow("Only a demo workspace admin");
    expect((await getPool().query("SELECT 1 FROM grm_google_connections WHERE workspace_id=$1", [ws])).rowCount).toBe(0);
  });

  it("adds only an account at connect, then one location and six reviews at import", async () => {
    await advanceLocalDemo(ws, user, "demo-connect");
    await advanceLocalDemo(ws, user, "demo-connect");
    expect((await getPool().query("SELECT status FROM grm_google_connections WHERE workspace_id=$1", [ws])).rows).toEqual([{ status: "revoked" }]);
    expect((await getPool().query("SELECT 1 FROM grm_google_locations WHERE workspace_id=$1", [ws])).rowCount).toBe(0);
    expect((await getPool().query("SELECT 1 FROM grm_reviews WHERE workspace_id=$1", [ws])).rowCount).toBe(0);
    await advanceLocalDemo(ws, user, "demo-import");
    await advanceLocalDemo(ws, user, "demo-import");
    expect((await getPool().query("SELECT total_review_count FROM grm_google_locations WHERE workspace_id=$1", [ws])).rows).toEqual([{ total_review_count: 6 }]);
    expect((await getPool().query("SELECT 1 FROM grm_reviews WHERE workspace_id=$1", [ws])).rowCount).toBe(6);
    expect((await getPool().query("SELECT 1 FROM grm_escalations WHERE workspace_id=$1", [ws])).rowCount).toBe(0);
    expect((await getPool().query("SELECT 1 FROM grm_clients WHERE workspace_id=$1", [other])).rowCount).toBe(0);
  });
});
