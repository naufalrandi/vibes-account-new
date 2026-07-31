import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20000,
    // The setup hook runs the full migration chain on a cold database, which
    // routinely exceeds Vitest's 10s hook default and surfaced as spurious
    // "Hook timed out" suite failures that passed on a plain retry.
    hookTimeout: 60000,
  },
});
