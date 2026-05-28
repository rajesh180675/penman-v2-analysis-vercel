import { realpathSync } from "fs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = realpathSync.native(__dirname);

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      "@": resolve(projectRoot, "src"),
    },
  },
  test: {
    environment: "jsdom",
    exclude: [
      "node_modules",
      "e2e",
      // Audit-all-companies specs run the full pipeline against every
      // registry company. They're heavy (40+ minutes serial), can OOM
      // workers, and are gated behind the `test:audit` npm script.
      // Keep them out of the default `npm test` / CI `validate` pool.
      "src/engine/__tests__/audit-all-companies*.spec.ts",
    ],
    pool: "forks",
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/engine/**/*.ts", "src/lib/**/*.ts"],
      exclude: [
        "src/engine/__tests__/**",
        "src/engine/__fixtures__/**",
        "src/engine/goldenCompanySuite.ts",
        "src/**/*.spec.ts",
        "src/**/*.spec.tsx",
      ],
      // Conservative initial thresholds — tighten as coverage improves
      thresholds: {
        lines: 40,
        functions: 35,
        branches: 30,
        statements: 40,
      },
    },
  },
});
