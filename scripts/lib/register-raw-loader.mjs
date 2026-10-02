// Preload for scripts that import engine modules using Vite's `?raw` suffix,
// which Vite and Vitest resolve and plain Node does not: the file's text as the
// default export. The engine imports its mapping spec that way
// (src/engine/mappingAudit.ts).
//
//   node --import tsx/esm --import ./scripts/lib/register-raw-loader.mjs script.ts
//
// Needs Node 22.15+ (module.registerHooks), the in-thread hooks tsx itself uses.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const RAW = "?raw";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.endsWith(RAW)) return nextResolve(specifier, context);
    const resolved = nextResolve(specifier.slice(0, -RAW.length), context);
    return { ...resolved, url: `${resolved.url}${RAW}`, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(RAW)) return nextLoad(url, context);
    const text = readFileSync(fileURLToPath(url.slice(0, -RAW.length)), "utf8");
    return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  },
});
