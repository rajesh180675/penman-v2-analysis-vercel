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
  const marker = `${path.sep}node_modules${path.sep}`;
  const markerIndex = id.lastIndexOf(marker);
  if (markerIndex < 0) return "vendor";

  const packagePath = id.slice(markerIndex + marker.length);
  const segments = packagePath.split(path.sep);
  const packageName = segments[0]?.startsWith("@")
    ? `${segments[0]}-${segments[1] ?? "pkg"}`
    : (segments[0] ?? "pkg");

  return `vendor-${packageName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function appChunkName(id: string) {
  const normalized = id.split(path.sep).join("/");
  if (normalized.includes("/src/engine/__fixtures__/") || normalized.includes("/src/engine/goldenCompanySuite.ts") || normalized.includes("/src/engine/releaseGate.ts")) {
    return "engine-golden-suite";
  }
  if (normalized.includes("/src/engine/regressionHarness.ts") || normalized.includes("/src/engine/baselineGuardrails.ts") || normalized.includes("/src/components/RegressionReport.tsx")) {
    return "engine-regression";
  }
  if (normalized.includes("/src/engine/v3Analytics.ts") || normalized.includes("/src/components/V3AnalyticsPanel.tsx")) {
    return "engine-v3-analytics";
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
  build: {
    rollupOptions: singleFileBuild
      ? undefined
      : {
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
