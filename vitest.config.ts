import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20000,
  },
});
