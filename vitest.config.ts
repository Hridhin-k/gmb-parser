import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.{ts,tsx}"],
    globals: true,
    environment: "node",
    // No pacing or long backoff in unit tests; gate behaviour has its own tests.
    env: { GOOGLE_API_RPM: "0", GOOGLE_API_RETRY_BASE_MS: "1" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
