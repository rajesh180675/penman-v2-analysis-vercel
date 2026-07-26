import type { ValuationModelRegistry } from "./registry";
import type {
  IndependentModelEvidenceGroup,
  ValuationModelCategory,
  ValuationModelDefinition,
  ValuationModelResult,
} from "./types";

type ComputedValuationModelResult = Extract<ValuationModelResult, { status: "computed" }>;

export interface FiniteComputedModelSelection {
  readonly definition: ValuationModelDefinition;
  readonly result: ComputedValuationModelResult;
}

export interface ModelCountOptions {
  /** Defaults to true so experimental math cannot inflate maturity. */
  readonly productionOnly?: boolean | undefined;
  /** Defaults to intrinsic and relative. Other categories are non-countable. */
  readonly categories?: readonly ValuationModelCategory[] | undefined;
}

const DEFAULT_COUNTABLE_CATEGORIES = ["intrinsic", "relative"] as const;

function hasFiniteValuation(result: ComputedValuationModelResult): boolean {
  return [result.enterpriseValue, result.equityValue, result.perShare]
    .some((value) => typeof value === "number" && Number.isFinite(value));
}

function hasBlockingGuardFailure(result: ComputedValuationModelResult): boolean {
  return result.guardResults.some(
    (guard) => guard.blocksResult && (guard.status === "failed" || guard.status === "insufficient-evidence"),
  );
}

/**
 * Select explicit finite computations using the registry as the authority for
 * category/lifecycle. Result payloads cannot self-identify as intrinsic.
 */
export function selectFiniteComputedModelResults(
  results: readonly ValuationModelResult[],
  registry: ValuationModelRegistry,
  options: ModelCountOptions = {},
): readonly FiniteComputedModelSelection[] {
  const productionOnly = options.productionOnly ?? true;
  const categories = options.categories ?? DEFAULT_COUNTABLE_CATEGORIES;
  const selected: FiniteComputedModelSelection[] = [];

  for (const result of results) {
    if (result.status !== "computed" || !hasFiniteValuation(result) || hasBlockingGuardFailure(result)) continue;
    const definition = registry.get(result.modelId);
    if (!definition) continue;
    if (productionOnly && definition.lifecycle !== "production") continue;
    if (!categories.includes(definition.category)) continue;
    selected.push({ definition, result });
  }

  return selected;
}

/** Number of unique model definitions with at least one finite computed value.
 * Scenario/case repetitions do not multiply the model count.
 */
export function countFiniteComputedModels(
  results: readonly ValuationModelResult[],
  registry: ValuationModelRegistry,
  options: ModelCountOptions = {},
): number {
  return new Set(
    selectFiniteComputedModelResults(results, registry, options)
      .map((selection) => selection.definition.modelId),
  ).size;
}

/**
 * Collapse algebraically/evidentially correlated models into declared
 * independence groups. This is evidence grouping, not value synthesis; no
 * weighting or averaging is performed here.
 */
export function groupIndependentModelEvidence(
  results: readonly ValuationModelResult[],
  registry: ValuationModelRegistry,
  options: ModelCountOptions = {},
): readonly IndependentModelEvidenceGroup[] {
  const grouped = new Map<string, FiniteComputedModelSelection[]>();
  for (const selection of selectFiniteComputedModelResults(results, registry, options)) {
    const current = grouped.get(selection.definition.independenceGroup) ?? [];
    current.push(selection);
    grouped.set(selection.definition.independenceGroup, current);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([independenceGroup, selections]) => {
      const modelIds = [...new Set(selections.map((selection) => selection.definition.modelId))].sort();
      const categories = [...new Set(selections.map((selection) => selection.definition.category))]
        .filter((category): category is "intrinsic" | "relative" => category === "intrinsic" || category === "relative")
        .sort();
      return {
        independenceGroup,
        modelIds,
        categories,
        results: selections.map((selection) => selection.result),
      };
    });
}

export function countIndependentModelEvidenceGroups(
  results: readonly ValuationModelResult[],
  registry: ValuationModelRegistry,
  options: ModelCountOptions = {},
): number {
  return groupIndependentModelEvidence(results, registry, options).length;
}

/**
 * Independence groups for a set of model ids, with the registry as the sole
 * authority on which models are correlated.
 *
 * For callers that know WHICH models computed but do not hold
 * `ValuationModelResult` payloads — notably the audit harness, which reads
 * display names off legacy command-center and bank-valuation output. Those
 * callers previously kept their own name-to-group switches, which is how the
 * audit came to count justified P/B and equity residual income as two
 * independent confirmations when they are the same algebra: justified P/B under
 * Gordon growth is the closed form of the equity residual-income model, and the
 * registry groups both under `fi-book-residual-income`.
 *
 * Throws on an unknown model id. The caller's map is a static constant over a
 * closed set of names, so a miss is a programming error — and silently dropping
 * the entry would quietly change an independence count that gates release
 * claims.
 */
export function independenceGroupsForModelIds(
  modelIds: readonly string[],
  registry: ValuationModelRegistry,
): readonly string[] {
  const groups = modelIds.map((modelId) => registry.require(modelId).independenceGroup);
  return [...new Set(groups)].sort((left, right) => left.localeCompare(right));
}
