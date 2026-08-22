import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    forks: {
      singleFork: true,
    },
    setupFiles: ["./test/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});


