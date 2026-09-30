import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { "server-only": serverOnlyStub } },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
          // One shared database: run files serially, reset between tests.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
