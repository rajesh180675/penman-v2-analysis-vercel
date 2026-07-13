import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CURRENT_MODEL_REGISTRY, generateModelCatalogMarkdown } from "../src/engine/modelCatalog/index";

const catalogPath = fileURLToPath(new URL("../docs/generated/valuation-model-catalog.md", import.meta.url));
const normalize = (value: string) => value.replace(/\r\n/g, "\n").trimEnd();
const expected = normalize(generateModelCatalogMarkdown(CURRENT_MODEL_REGISTRY));
let actual: string;
try {
  actual = normalize(await readFile(catalogPath, "utf8"));
} catch (error) {
  console.error(`Generated valuation model catalog is missing: ${String(error)}`);
  process.exit(1);
}
if (actual !== expected) {
  console.error("Generated valuation model catalog is stale. Regenerate docs/generated/valuation-model-catalog.md from generateModelCatalogMarkdown(CURRENT_MODEL_REGISTRY).");
  process.exit(1);
}
console.log(`Model catalog fresh: ${CURRENT_MODEL_REGISTRY.list().length} definitions.`);
