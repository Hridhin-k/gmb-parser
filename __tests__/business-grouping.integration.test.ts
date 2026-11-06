import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { autoClientMarker, autoOrgMarker, autoProvisionClientsFromLocations as provision } from "@/lib/services/auto-provision-clients";
import { ensureUnassignedClient } from "@/lib/services/unassigned-client";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("business grouping in Postgres", () => {
  const ws = randomUUID(), other = randomUUID(), user = randomUUID();
  let account: string, ready = false;
  const db = () => getPool();
  async function client(name: string, notes: string | null = null, workspace = ws) {
    return (await db().query("INSERT INTO grm_clients(workspace_id,name,notes) VALUES($1,$2,$3) RETURNING id", [workspace, name, notes])).rows[0].id as string;
  }
  async function location(title: string, owner: string | null = null, held = false, active = true) {
    const id = randomUUID();
    await db().query(`INSERT INTO grm_google_locations(id,workspace_id,google_account_id,google_location_name,location_title,client_id,hold_reason,is_active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, ws, account, `locations/${id}`, title, owner, held ? "unverified" : null, active]);
    return id;
  }
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") throw new Error("Dedicated local database required");
    await db().query("INSERT INTO authn.users(id,email) VALUES($1,$2)", [user, `${user}@grm.test`]);
    await db().query("INSERT INTO grm_workspaces(id,name,slug) VALUES($1,'Grouping QA',$2),($3,'Other QA',$4)", [ws, `test-${ws}`, other, `test-${other}`]);
    ready = true;
    const { rows: [connection] } = await db().query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at)
      VALUES($1,$2,'test@example.test','test','test',now()) RETURNING id`, [ws, user]);
    account = (await db().query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type)
      VALUES($1,$2,'accounts/test','QA','LOCATION_GROUP') RETURNING id`, [ws, connection.id])).rows[0].id;
    await ensureUnassignedClient(ws);
  });
  afterAll(async () => {
    if (ready) {
      await db().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, other]]);
      await db().query("DELETE FROM authn.users WHERE id=$1", [user]);
      await db().end();
    }
  });

  it("groups branch suffixes, preserves manual notes/assignments, and stays idempotent", async () => {
    const saved = await client("Fazyo", "Call the owner before changing settings");
    const unrelated = await client("Manually chosen business");
    const first = await location("Fazyo");
    const second = await location("Fazyo (FAZ-TCR)");
    const manual = await location("Fazyo (FAZ-KTYM)", unrelated);
    const unicodeA = await location("മലയാളം"), unicodeB = await location("தமிழ்");
    const foreign = await client("Fazyo", autoOrgMarker("Fazyo"), other);
    const result = await provision(ws, user);
    expect(result.locationsLinked).toBe(4);
    const { rows } = await db().query("SELECT id,client_id FROM grm_google_locations WHERE workspace_id=$1", [ws]);
    const owner = (id: string) => rows.find((row) => row.id === id)?.client_id;
    expect(owner(first)).toBe(saved); expect(owner(second)).toBe(saved);
    expect(owner(manual)).toBe(unrelated); expect(owner(unicodeA)).not.toBe(owner(unicodeB));
    expect((await db().query("SELECT notes FROM grm_clients WHERE id=$1", [saved])).rows[0].notes).toBe("Call the owner before changing settings");
    expect((await db().query("SELECT is_active FROM grm_clients WHERE id=$1", [foreign])).rows[0].is_active).toBe(true);
    expect(await provision(ws, user)).toEqual({ clientsCreated: 0, clientsReused: 0, locationsLinked: 0 });
  });

  it("merges legacy branches, archives only empty businesses, and audits each move", async () => {
    const legacy = await client("Legacy (1)", autoClientMarker("locations/legacy"));
    const empty = await client("Legacy (2)", autoClientMarker("locations/empty"));
    const first = await location("Legacy (LEG-ONE)", legacy);
    const second = await location("Legacy (LEG-TWO)", empty);
    const groupedOwner = await client("Hand grouped", autoClientMarker("locations/grouped"));
    const grouped = await location("Legacy (LEG-THREE)", groupedOwner);
    const brand = (await db().query("INSERT INTO grm_brands(workspace_id,client_id,name) VALUES($1,$2,'QA') RETURNING id", [ws, groupedOwner])).rows[0].id;
    const group = (await db().query("INSERT INTO grm_groups(workspace_id,client_id,brand_id,name) VALUES($1,$2,$3,'QA region') RETURNING id", [ws, groupedOwner, brand])).rows[0].id;
    await db().query("UPDATE grm_google_locations SET group_id=$1 WHERE id=$2", [group, grouped]);
    await location("Held legacy", legacy, true);
    await location("Inactive legacy", legacy, false, false);
    await provision(ws, user);
    const { rows } = await db().query("SELECT id,client_id FROM grm_google_locations WHERE id=ANY($1::uuid[])", [[first, second]]);
    expect(rows[0].client_id).toBe(rows[1].client_id);
    const states = (await db().query("SELECT id,is_active FROM grm_clients WHERE id=ANY($1::uuid[])", [[legacy, empty]])).rows;
    expect(states.find((row) => row.id === legacy)?.is_active).toBe(true);
    expect(states.find((row) => row.id === empty)?.is_active).toBe(false);
    expect((await db().query("SELECT metadata FROM grm_audit_logs WHERE workspace_id=$1 AND entity_id=$2 AND action='client.updated'", [ws, empty])).rows).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "empty_legacy_business", before: { isActive: true }, after: { isActive: false } }) }),
    ]);
    expect((await db().query("SELECT client_id,group_id FROM grm_google_locations WHERE id=$1", [grouped])).rows[0]).toEqual({ client_id: groupedOwner, group_id: group });
    const audits = (await db().query("SELECT metadata FROM grm_audit_logs WHERE workspace_id=$1 AND entity_id=$2", [ws, first])).rows;
    expect(audits).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ before: { clientId: legacy, groupId: null }, after: { clientId: rows[0].client_id, groupId: null } }) })]);
  });

  it("creates one business under concurrent discovery and keeps an old marker stable", async () => {
    const old = await client("Historic", "grm:auto:org:historic");
    const historic = await location("Historic (HIS-ONE)", old);
    const first = await location("Concurrent (CON-ONE)"), second = await location("Concurrent (CON-TWO)");
    await Promise.all(Array.from({ length: 5 }, () => provision(ws, user)));
    const businesses = (await db().query("SELECT id FROM grm_clients WHERE workspace_id=$1 AND notes=$2 AND is_active", [ws, autoOrgMarker("Concurrent")])).rows;
    expect(businesses).toHaveLength(1);
    const rows = (await db().query("SELECT client_id FROM grm_google_locations WHERE id=ANY($1::uuid[])", [[first, second]])).rows;
    expect(rows.every((row) => row.client_id === businesses[0].id)).toBe(true);
    expect((await db().query("SELECT client_id FROM grm_google_locations WHERE id=$1", [historic])).rows[0].client_id).toBe(old);
    expect(await provision(ws, user)).toEqual({ clientsCreated: 0, clientsReused: 0, locationsLinked: 0 });
  });
});
