import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { DEFAULT_ESCALATION_POLICY } from "@/lib/escalations";
import { EscalationService, EscalationContactStore } from "@/lib/services/escalations";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("follow-up settings persistence", () => {
  const ws = randomUUID(), user = randomUUID();
  let ready = false;
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const url = new URL(process.env.DATABASE_URL || "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55432") throw new Error("Requires the dedicated local test database");
    await getPool().query('INSERT INTO authn.users(id,email,name) VALUES ($1,$2,\'Follow-up tester\')', [user, `${user}@grm.test`]);
    await getPool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES ($1,'Follow-up test',$2)", [ws, `test-${ws}`]);
    ready = true;
  });
  afterAll(async () => {
    if (ready) {
      await getPool().query("DELETE FROM grm_workspaces WHERE id=$1", [ws]);
      await getPool().query("DELETE FROM authn.users WHERE id=$1", [user]);
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
});
