import type { ValuationModelRegistry } from "./registry";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_CATEGORIES,
  MODEL_LIFECYCLES,
  type GeneratedModelCatalog,
  type GeneratedModelCatalogEntry,
  type ValuationModelCategory,
  type ValuationModelLifecycle,
} from "./types";

function categoryCounts(): Record<ValuationModelCategory, number> {
  return Object.fromEntries(MODEL_CATEGORIES.map((category) => [category, 0])) as Record<ValuationModelCategory, number>;
}

function lifecycleCounts(): Record<ValuationModelLifecycle, number> {
  return Object.fromEntries(MODEL_LIFECYCLES.map((lifecycle) => [lifecycle, 0])) as Record<ValuationModelLifecycle, number>;
}

/** Generate a deterministic, JSON-safe artifact. A wall-clock timestamp is
 * deliberately absent so identical definitions produce identical content.
 */
export function generateModelCatalog(registry: ValuationModelRegistry): GeneratedModelCatalog {
  const byCategory = categoryCounts();
  const byLifecycle = lifecycleCounts();
  const productionEvidenceGroups = new Set<string>();

  const entries: GeneratedModelCatalogEntry[] = registry.list().map((definition) => {
    byCategory[definition.category] += 1;
    byLifecycle[definition.lifecycle] += 1;
    if (
      definition.lifecycle === "production"
      && (definition.category === "intrinsic" || definition.category === "relative")
    ) {
      productionEvidenceGroups.add(definition.independenceGroup);
    }
    return {
      modelId: definition.modelId,
      modelVersion: definition.modelVersion,
      label: definition.label,
      families: [...definition.families],
      category: definition.category,
      lifecycle: definition.lifecycle,
      independenceGroup: definition.independenceGroup,
      inputContract: definition.inputContract,
      requirementIds: definition.requirements.map((requirement) => requirement.requirementId),
      guardIds: definition.guards.map((guard) => guard.guardId),
      implementation: { ...definition.implementation },
      lifecycleNote: definition.lifecycleNote,
      replacementModelId: definition.replacementModelId,
    };
  });

  const productionCountableModels = entries.filter(
    (entry) => entry.lifecycle === "production" && (entry.category === "intrinsic" || entry.category === "relative"),
  ).length;

  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    catalogVersion: registry.catalogVersion,
    entries,
    summary: {
      total: entries.length,
      byCategory,
      byLifecycle,
      productionCountableModels,
      independentProductionEvidenceGroups: productionEvidenceGroups.size,
    },
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Human-reviewable catalog report generated from the same registry artifact. */
export function generateModelCatalogMarkdown(registry: ValuationModelRegistry): string {
  const catalog = generateModelCatalog(registry);
  const lines = [
    "# Valuation Model Catalog",
    "",
    `- Schema: \`${catalog.schemaVersion}\``,
    `- Catalog: \`${catalog.catalogVersion}\``,
    `- Entries: ${catalog.summary.total}`,
    `- Production intrinsic/relative definitions: ${catalog.summary.productionCountableModels}`,
    `- Independent production evidence groups: ${catalog.summary.independentProductionEvidenceGroups}`,
    "",
    "| Model ID | Lifecycle | Category | Families | Independence group | Integration | Implementation |",
    "|---|---|---|---|---|---|---|",
  ];

  for (const entry of catalog.entries) {
    const implementation = `${entry.implementation.modulePath}#${entry.implementation.exportName}${entry.implementation.outputPath ? `:${entry.implementation.outputPath}` : ""}`;
    lines.push(
      `| \`${escapeCell(entry.modelId)}\` | ${entry.lifecycle} | ${entry.category} | ${entry.families.join(", ")} | ${escapeCell(entry.independenceGroup)} | ${entry.implementation.integration} | \`${escapeCell(implementation)}\` |`,
    );
  }

  lines.push(
    "",
    "> Counts come from explicit finite computed results at runtime. Catalog presence, applicability, and strategy labels never count as computation.",
    "",
  );
  return lines.join("\n");
}
