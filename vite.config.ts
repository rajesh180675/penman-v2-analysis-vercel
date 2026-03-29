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
              if (!id.includes("node_modules")) return undefined;
              return packageChunkName(id);
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
