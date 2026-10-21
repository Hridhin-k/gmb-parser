import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("review intelligence schema", () => {
  it("enforces identity, tenant isolation, deletion, and index use", () => {
    const root = mkdtempSync(join(tmpdir(), "grm-intel-"));
    const data = join(root, "data");
    const port = "54329";
    const bin = "/opt/homebrew/opt/postgresql@18/bin";
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` };
    const psql = `${bin}/psql`;
    const repo = process.cwd();
    try {
      execSync(`${bin}/initdb -D ${JSON.stringify(data)} --username=grmtest --auth=trust --no-sync`, {
        env,
        stdio: "pipe",
      });
      execSync(
        `${bin}/pg_ctl -D ${JSON.stringify(data)} -o ${JSON.stringify(`-p ${port} -k ${root}`)} -l ${JSON.stringify(join(root, "log"))} -w start`,
        { env, stdio: "pipe" }
      );
      const run = (file: string) => {
        execSync(
          `${psql} -h ${JSON.stringify(root)} -p ${port} -U grmtest -d postgres -v ON_ERROR_STOP=1 -f ${JSON.stringify(file)}`,
          { env, stdio: "pipe" }
        );
      };
      run(join(repo, "__tests__/sql/intelligence_preamble.sql"));
      run(join(repo, "supabase/migrations/20261020002_review_intelligence.sql"));
      run(join(repo, "__tests__/sql/intelligence_checks.sql"));
      for (const file of [
        "20261020003_review_versioning.sql",
        "20261020004_review_extraction.sql",
        "20261020005_review_clusters.sql",
        "20261020006_scope_summaries.sql",
        "20261020007_insight_reports.sql",
      ]) {
        run(join(repo, "supabase/migrations", file));
      }
      run(join(repo, "__tests__/sql/intelligence_rollforward.sql"));
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: Buffer }).stderr) : "";
      const stdout = error instanceof Error && "stdout" in error ? String((error as { stdout?: Buffer }).stdout) : "";
      throw new Error(`${stderr}\n${stdout}\n${error instanceof Error ? error.message : error}`);
    } finally {
      try {
        execSync(`${bin}/pg_ctl -D ${JSON.stringify(data)} -w stop`, { env, stdio: "pipe" });
      } catch {
        // The cluster may not have started.
      }
      rmSync(root, { recursive: true, force: true });
    }
    expect(true).toBe(true);
  }, 120_000);
});
