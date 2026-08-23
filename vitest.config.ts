import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // HTTP suites createApp + facilitator getSupported; parallel probes need headroom.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
