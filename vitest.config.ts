import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
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
