import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase/migrations");
const migrationName = "20261027007_report_alert_group_fk.sql";

describe("report and alert group_id foreign keys", () => {
  it("ships after the inbox index migration and only retargets the two tables", () => {
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    expect(files).toContain(migrationName);
    expect(files.indexOf(migrationName)).toBeGreaterThan(
      files.indexOf("20261027006_inbox_visible_workspace_index.sql")
    );

    const sql = readFileSync(path.join(migrationsDir, migrationName), "utf8");

    expect(sql).toContain("public.grm_report_schedules");
    expect(sql).toContain("public.grm_alert_rules");
    expect(sql).toContain("references public.grm_groups(id) on delete set null");
    expect(sql).toContain("grm_report_schedules_group_id_fkey");
    expect(sql).toContain("grm_alert_rules_group_id_fkey");

    expect(sql).toContain(
      "grm_report_schedules.group_id has values that are not in grm_groups. Refusing to retarget the foreign key."
    );
    expect(sql).toContain(
      "grm_alert_rules.group_id has values that are not in grm_groups. Refusing to retarget the foreign key."
    );

    // Do not widen the retarget beyond the audited mismatch.
    expect(sql).not.toContain("grm_google_locations");
    expect(sql.match(/references public\.grm_groups\(id\) on delete set null/g)).toHaveLength(2);
    expect(sql).not.toMatch(/on delete cascade/i);
    expect(sql).not.toMatch(/update\s+public\.grm_report_schedules/i);
    expect(sql).not.toMatch(/update\s+public\.grm_alert_rules/i);
  });

  it("keeps the fail-closed skip when the FK already points at grm_groups", () => {
    const sql = readFileSync(path.join(migrationsDir, migrationName), "utf8");
    expect(sql).toContain("v_target = 'public.grm_groups'::regclass then");
    expect(sql).toContain("return;");
  });
});
