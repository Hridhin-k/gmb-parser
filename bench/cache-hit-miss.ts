import {
  dashboardContextCacheKey,
  forgetWorkspaceDashboardCaches,
  locationWindowCacheKey,
} from "../lib/services/dashboard-cache";
import { remember, resetTtlCacheForTests } from "../lib/ttl-cache";

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = process.hrtime.bigint();
  await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stdout.write(`${JSON.stringify({ label, ms: Number(ms.toFixed(3)) })}\n`);
}

async function main() {
  resetTtlCacheForTests();
  const key = dashboardContextCacheKey(
    "ws",
    { clientId: null, groupId: null, locationId: null },
    { start: null, end: null }
  );

  await time("miss", () =>
    remember(key, 45_000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { reviews: 0 };
    })
  );
  await time("hit", () => remember(key, 45_000, async () => ({ reviews: 99 })));
  forgetWorkspaceDashboardCaches("ws");
  await time("miss_after_invalidate", () =>
    remember(key, 45_000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { reviews: 1 };
    })
  );
  process.stdout.write(
    `${JSON.stringify({
      sliceKey: locationWindowCacheKey("slice", "ws", ["b", "a"], null, null),
    })}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
