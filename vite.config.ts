import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const singleFileBuild = process.env.VITE_SINGLE_FILE === "1";

function packageChunkName(id: string) {
  // Rollup always uses forward slashes in module IDs — normalize before matching
  const normalized = id.split(path.sep).join("/");
  const marker = "/node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;

  const packagePath = normalized.slice(markerIndex + marker.length);
  const segments = packagePath.split("/");
  const packageName = segments[0]?.startsWith("@")
    ? `${segments[0]}/${segments[1] ?? "pkg"}`
    : (segments[0] ?? "pkg");

  // Heavy packages — explicit named chunks so the entry bundle stays lean
  if (packageName === "recharts" || packageName.startsWith("d3-") || packageName === "victory-vendor") {
    return "vendor-charts";
  }
  if (packageName === "xlsx" || packageName === "jszip" || packageName === "exceljs") {
    return "vendor-file-parsing";
  }
  if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") {
    return "vendor-react";
  }

  return `vendor-${packageName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function appChunkName(id: string) {
  const normalized = id.split(path.sep).join("/");
  if (normalized.includes("/src/engine/__fixtures__/") || normalized.includes("/src/engine/goldenCompanySuite.ts") || normalized.includes("/src/engine/releaseGate.ts")) {
    return "engine-golden-suite";
  }
  if (
    normalized.includes("/src/engine/regressionHarness.ts")
    || normalized.includes("/src/engine/baselineGuardrails.ts")
    || normalized.includes("/src/engine/v3Analytics.ts")
  ) {
    // Engine modules only — keep these together so Rollup does not have to
    // synthesize a circular edge between manually split regression and V3
    // analytics chunks. UI components (RegressionReport, V3AnalyticsPanel,
    // AcademicReport) stay in their own lazy chunks so katex/recharts etc.
    // are not dragged into the initial preload.
    return "engine-advanced-analytics";
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(singleFileBuild ? [viteSingleFile()] : []),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: singleFileBuild
    ? {}
    : {
        // Vite's default 500 KB uncompressed warning is too noisy for this
        // intentionally lazy-loaded analytics app. scripts/check-bundle-budget.cjs
        // remains the authoritative gzip budget gate after every production build.
        chunkSizeWarningLimit: 1100,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes("node_modules")) return packageChunkName(id);
              return appChunkName(id);
            },
          },
        },
      },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
