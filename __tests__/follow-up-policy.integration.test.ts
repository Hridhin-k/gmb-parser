import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { DEFAULT_ESCALATION_POLICY } from "@/lib/escalations";
import { EscalationService, EscalationContactStore } from "@/lib/services/escalations";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("follow-up settings persistence", () => {
  const ws = randomUUID(), user = randomUUID(), manager = randomUUID(), otherWs = randomUUID();
  const storeA = randomUUID(), storeB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
  let ready = false;
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const url = new URL(process.env.DATABASE_URL || "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55432") throw new Error("Requires the dedicated local test database");
    await getPool().query('INSERT INTO authn.users(id,email,name) VALUES ($1,$2,\'Follow-up tester\')', [user, `${user}@grm.test`]);
    await getPool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES ($1,'Follow-up test',$2)", [ws, `test-${ws}`]);
    ready = true;
    await getPool().query("INSERT INTO authn.users(id,email) VALUES($1,$2)", [manager, `${manager}@grm.test`]);
    await getPool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES($1,'Other contact test',$2)", [otherWs, `test-${otherWs}`]);
    await getPool().query("INSERT INTO grm_clients(id,workspace_id,name) VALUES($1,$3,'Store A business'),($2,$3,'Store B business')", [clientA, clientB, ws]);
    const { rows: [connection] } = await getPool().query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at)
      VALUES($1,$2,'contact@test.invalid','test','test',now()) RETURNING id`, [ws, user]);
    const { rows: [account] } = await getPool().query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type)
      VALUES($1,$2,$3,'Contacts','LOCATION_GROUP') RETURNING id`, [ws, connection.id, `accounts/${randomUUID()}`]);
    await getPool().query(`INSERT INTO grm_google_locations(id,workspace_id,client_id,google_account_id,google_location_name,location_title,primary_phone)
      VALUES($1,$3,$5,$4,'locations/contact-a','Store A','+44 1111111111'),($2,$3,$6,$4,'locations/contact-b','Store B','+44 2222222222')`, [storeA, storeB, ws, account.id, clientA, clientB]);
    await getPool().query(`INSERT INTO grm_workspace_members(workspace_id,user_id,role,scope_client_id)
      VALUES($1,$2,'owner',NULL),($1,$3,'brand_manager',$4)`, [ws, user, manager, clientA]);
  });
  afterAll(async () => {
    if (ready) {
      await getPool().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, otherWs]]);
      await getPool().query("DELETE FROM authn.users WHERE id=ANY($1::uuid[])", [[user, manager]]);
      await getPool().end();
    }
  });

  it("creates and updates the workspace rule without overwriting customer contact details", async () => {
    expect(await EscalationService.savePolicy(ws, user, DEFAULT_ESCALATION_POLICY)).toEqual({ created: 0 });
    await EscalationContactStore.save(ws, user, { phone: "", email: "care@example.test" });
    const changed = { ...DEFAULT_ESCALATION_POLICY, maxStars: 2, dueHours: 8 };
    expect(await EscalationService.savePolicy(ws, user, changed)).toEqual({ created: 0 });
    expect(await EscalationService.policy(ws)).toEqual(changed);
    expect(await EscalationContactStore.read(ws)).toEqual({ phone: null, email: "care@example.test" });
    expect((await getPool().query("SELECT 1 FROM grm_escalation_policies WHERE workspace_id=$1", [ws])).rowCount).toBe(1);
  });

  it("keeps per-store contacts separate, falls back as a whole, and records the change", async () => {
    await EscalationContactStore.save(ws, user, { phone: "+44 1234567890", email: "central@example.test" });
    await EscalationContactStore.saveLocation(ws, user, storeA, { phone: " +44 9876543210 ", email: "" });
    await EscalationContactStore.saveLocation(ws, user, storeB, { phone: "", email: "Manager@Example.test" });
    expect(await EscalationContactStore.readMany(ws, [storeA, storeB, storeA])).toEqual({
      [storeA]: { phone: "+44 9876543210", email: null },
      [storeB]: { phone: null, email: "manager@example.test" },
    });
    const { rows: [event] } = await getPool().query("SELECT metadata FROM grm_audit_logs WHERE entity_id=$1 AND action='escalation.contact_updated'", [storeA]);
    expect(event.metadata).toMatchObject({ scope: "location", locationId: storeA,
      previous: { phone: null, email: null }, contact: { phone: "+44 9876543210", email: null }, usesWorkspaceDefault: false });
    await EscalationContactStore.saveLocation(ws, user, storeA, { phone: "", email: "" });
    expect(await EscalationContactStore.read(ws, storeA)).toEqual({ phone: "+44 1234567890", email: "central@example.test" });
    expect(await EscalationContactStore.read(ws, storeB)).toEqual({ phone: null, email: "manager@example.test" });
    expect((await getPool().query("SELECT primary_phone FROM grm_google_locations WHERE id=$1", [storeA])).rows[0].primary_phone).toBe("+44 1111111111");
  });

  it("rejects cross-workspace and out-of-scope writes and invalid input", async () => {
    await EscalationContactStore.saveLocation(ws, manager, storeA, { phone: "", email: "scoped@example.test" });
    await expect(EscalationContactStore.saveLocation(ws, manager, storeB, { phone: "", email: "wrong@example.test" }))
      .rejects.toThrow("permission");
    await expect(EscalationContactStore.saveLocation(otherWs, user, storeA, { phone: "", email: "wrong@example.test" }))
      .rejects.toThrow();
    expect(await EscalationContactStore.readMany(otherWs, [storeA, storeB])).toEqual({});
    await expect(EscalationContactStore.read(otherWs, storeA)).rejects.toThrow("not in this organization");
    await expect(EscalationContactStore.saveLocation(ws, user, storeB, { phone: "123", email: "" })).rejects.toThrow("phone");
    expect(await EscalationContactStore.read(ws, storeB)).toEqual({ phone: null, email: "manager@example.test" });
  });

});
