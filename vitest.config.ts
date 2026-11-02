import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve @limiq/* to each package's SOURCE so tests run without a build step.
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@limiq/core": pkg("core"),
      "@limiq/store-memory": pkg("store-memory"),
      "@limiq/store-redis": pkg("store-redis"),
      "@limiq/express": pkg("middleware-express"),
      "@limiq/prometheus": pkg("metrics-prometheus"),
      "@limiq/dashboard": pkg("dashboard"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/index.ts", "**/*.d.ts"],
    },
  },
});
