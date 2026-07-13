import {
  MODEL_CATEGORIES,
  MODEL_FAMILIES,
  MODEL_INTEGRATION_STATES,
  MODEL_LIFECYCLES,
  type ModelApplicabilityContext,
  type ModelApplicabilityResult,
  type ModelCatalogValidationIssue,
  type ModelDataRequirement,
  type ValuationModelDefinition,
} from "./types";

const MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const REQUIREMENT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function inList<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function issue(
  issues: ModelCatalogValidationIssue[],
  code: string,
  modelId: string | null,
  message: string,
  severity: ModelCatalogValidationIssue["severity"] = "error",
): void {
  issues.push({ severity, code, modelId, message });
}

/** Runtime validation is deliberate: generated catalogs can be loaded from
 * JSON in future, where TypeScript's unions provide no protection.
 */
export function validateModelCatalog(definitions: readonly unknown[]): ModelCatalogValidationIssue[] {
  const issues: ModelCatalogValidationIssue[] = [];
  const seenIds = new Set<string>();

  for (const candidate of definitions) {
    if (!isRecord(candidate)) {
      issue(issues, "definition-not-object", null, "Catalog definition must be an object.");
      continue;
    }

    const modelId = isNonEmptyString(candidate.modelId) ? candidate.modelId : null;
    if (modelId === null || !MODEL_ID_PATTERN.test(modelId)) {
      issue(issues, "invalid-model-id", modelId, "modelId must be lower-case dot/kebab notation.");
    } else if (seenIds.has(modelId)) {
      issue(issues, "duplicate-model-id", modelId, `Duplicate modelId '${modelId}'.`);
    } else {
      seenIds.add(modelId);
    }

    if (!isNonEmptyString(candidate.modelVersion)) {
      issue(issues, "invalid-model-version", modelId, "modelVersion is required.");
    }
    if (!isNonEmptyString(candidate.label)) {
      issue(issues, "invalid-label", modelId, "label is required.");
    }
    if (!isNonEmptyString(candidate.description)) {
      issue(issues, "invalid-description", modelId, "description is required.");
    }
    if (!isNonEmptyString(candidate.inputContract)) {
      issue(issues, "invalid-input-contract", modelId, "inputContract is required.");
    }
    if (!inList(candidate.category, MODEL_CATEGORIES)) {
      issue(issues, "invalid-category", modelId, `Unknown model category '${String(candidate.category)}'.`);
    }
    if (!inList(candidate.lifecycle, MODEL_LIFECYCLES)) {
      issue(issues, "invalid-lifecycle", modelId, `Unknown model lifecycle '${String(candidate.lifecycle)}'.`);
    }
    if (!isNonEmptyString(candidate.independenceGroup)) {
      issue(issues, "invalid-independence-group", modelId, "independenceGroup is required.");
    }

    if (!Array.isArray(candidate.families) || candidate.families.length === 0) {
      issue(issues, "invalid-families", modelId, "At least one applicability family is required.");
    } else {
      for (const family of candidate.families) {
        if (!inList(family, MODEL_FAMILIES)) {
          issue(issues, "invalid-family", modelId, `Unknown applicability family '${String(family)}'.`);
        }
      }
    }

    if (!Array.isArray(candidate.requirements)) {
      issue(issues, "invalid-requirements", modelId, "requirements must be an array.");
    } else {
      const seenRequirementIds = new Set<string>();
      for (const rawRequirement of candidate.requirements) {
        if (!isRecord(rawRequirement)) {
          issue(issues, "invalid-requirement", modelId, "Every requirement must be an object.");
          continue;
        }
        const requirementId = isNonEmptyString(rawRequirement.requirementId)
          ? rawRequirement.requirementId
          : null;
        if (requirementId === null || !REQUIREMENT_ID_PATTERN.test(requirementId)) {
          issue(issues, "invalid-requirement-id", modelId, "requirementId must use lower-case dot/kebab notation.");
        } else if (seenRequirementIds.has(requirementId)) {
          issue(issues, "duplicate-requirement-id", modelId, `Duplicate requirement '${requirementId}' within model.`);
        } else {
          seenRequirementIds.add(requirementId);
        }
        if (!Number.isInteger(rawRequirement.minimumObservations) || Number(rawRequirement.minimumObservations) < 0) {
          issue(issues, "invalid-minimum-observations", modelId, "minimumObservations must be a non-negative integer.");
        }
        if (!Array.isArray(rawRequirement.keys) || rawRequirement.keys.length === 0 || rawRequirement.keys.some((key) => !isNonEmptyString(key))) {
          issue(issues, "invalid-requirement-keys", modelId, "Every requirement needs at least one canonical key.");
        }
        if (!inList(rawRequirement.kind, ["fact", "assumption", "market", "segment", "sidecar"] as const)) {
          issue(issues, "invalid-requirement-kind", modelId, `Unknown requirement kind '${String(rawRequirement.kind)}'.`);
        }
        if (!inList(rawRequirement.purpose, ["compute", "guard", "enrichment"] as const)) {
          issue(issues, "invalid-requirement-purpose", modelId, `Unknown requirement purpose '${String(rawRequirement.purpose)}'.`);
        }
      }
    }

    if (!Array.isArray(candidate.guards)) {
      issue(issues, "invalid-guards", modelId, "guards must be an array.");
    }

    if (!isRecord(candidate.implementation)) {
      issue(issues, "invalid-implementation", modelId, "implementation reference is required.");
    } else {
      if (!isNonEmptyString(candidate.implementation.modulePath) || !isNonEmptyString(candidate.implementation.exportName)) {
        issue(issues, "invalid-implementation-reference", modelId, "Implementation modulePath and exportName are required.");
      }
      if (!inList(candidate.implementation.integration, MODEL_INTEGRATION_STATES)) {
        issue(issues, "invalid-integration-state", modelId, `Unknown integration state '${String(candidate.implementation.integration)}'.`);
      }
      if (candidate.lifecycle === "production" && candidate.implementation.integration === "not-wired") {
        issue(issues, "unwired-production-model", modelId, "A not-wired model cannot be classified as production.");
      }
    }

    const reverseDcfIdentity = `${modelId ?? ""} ${String(candidate.label ?? "")}`;
    if (/reverse[ ._-]?dcf/i.test(reverseDcfIdentity) && candidate.category !== "market-implied") {
      issue(issues, "reverse-dcf-category", modelId, "Reverse DCF must be categorized as market-implied.");
    }
    if (candidate.category === "aggregator" && candidate.independenceGroup !== "aggregation") {
      issue(issues, "aggregator-independence-group", modelId, "Aggregators should use the non-evidence 'aggregation' group.", "warning");
    }
    if (candidate.lifecycle === "deprecated" && !isNonEmptyString(candidate.replacementModelId)) {
      issue(issues, "deprecated-without-replacement", modelId, "Deprecated model has no replacementModelId.", "warning");
    }
  }

  return issues;
}

export class ModelCatalogValidationError extends Error {
  readonly issues: readonly ModelCatalogValidationIssue[];

  constructor(issues: readonly ModelCatalogValidationIssue[]) {
    super(issues.map((entry) => `${entry.code}: ${entry.message}`).join("\n"));
    this.name = "ModelCatalogValidationError";
    this.issues = issues;
  }
}

export class ValuationModelRegistry {
  readonly catalogVersion: string;
  readonly validationIssues: readonly ModelCatalogValidationIssue[];
  readonly #definitions: readonly ValuationModelDefinition[];
  readonly #byId: ReadonlyMap<string, ValuationModelDefinition>;

  private constructor(
    catalogVersion: string,
    definitions: readonly ValuationModelDefinition[],
    validationIssues: readonly ModelCatalogValidationIssue[],
  ) {
    this.catalogVersion = catalogVersion;
    this.#definitions = Object.freeze([...definitions].sort((left, right) => left.modelId.localeCompare(right.modelId)));
    this.#byId = new Map(this.#definitions.map((definition) => [definition.modelId, definition]));
    this.validationIssues = Object.freeze([...validationIssues]);
  }

  static create(catalogVersion: string, definitions: readonly unknown[]): ValuationModelRegistry {
    if (!isNonEmptyString(catalogVersion)) {
      throw new Error("catalogVersion is required.");
    }
    const validationIssues = validateModelCatalog(definitions);
    const errors = validationIssues.filter((entry) => entry.severity === "error");
    if (errors.length > 0) throw new ModelCatalogValidationError(validationIssues);
    return new ValuationModelRegistry(
      catalogVersion,
      definitions as readonly ValuationModelDefinition[],
      validationIssues,
    );
  }

  list(): readonly ValuationModelDefinition[] {
    return this.#definitions;
  }

  get(modelId: string): ValuationModelDefinition | undefined {
    return this.#byId.get(modelId);
  }

  require(modelId: string): ValuationModelDefinition {
    const definition = this.get(modelId);
    if (!definition) throw new Error(`Unknown valuation model '${modelId}'.`);
    return definition;
  }

  has(modelId: string): boolean {
    return this.#byId.has(modelId);
  }
}

function requiredForApplicability(requirement: ModelDataRequirement): boolean {
  return requirement.purpose === "compute" || requirement.purpose === "guard";
}

/** Applicability depends on normalized family plus explicit evidence only.
 * There is intentionally no strategyId/route-label input.
 */
export function evaluateModelApplicability(
  definition: ValuationModelDefinition,
  context: ModelApplicabilityContext,
): ModelApplicabilityResult {
  if (definition.lifecycle === "deprecated") {
    return {
      status: "not-applicable",
      modelId: definition.modelId,
      reasonCode: "deprecated-model",
      summary: `Model '${definition.modelId}' is deprecated and cannot run in a current analysis.`,
    };
  }
  if (!definition.families.includes("cross-family") && !definition.families.includes(context.family)) {
    return {
      status: "not-applicable",
      modelId: definition.modelId,
      reasonCode: "family-not-applicable",
      summary: `Model '${definition.modelId}' does not apply to family '${context.family}'.`,
    };
  }

  const evidenceById = new Map(context.requirementEvidence.map((entry) => [entry.requirementId, entry]));
  const required = definition.requirements.filter(requiredForApplicability);
  const invalidRequirementIds: string[] = [];
  const missingRequirements: ModelDataRequirement[] = [];
  const satisfiedRequirementIds: string[] = [];

  for (const requirement of required) {
    const evidence = evidenceById.get(requirement.requirementId);
    if (evidence?.status === "invalid") {
      invalidRequirementIds.push(requirement.requirementId);
      continue;
    }
    if (evidence?.status !== "available" || evidence.observations < requirement.minimumObservations) {
      missingRequirements.push(requirement);
      continue;
    }
    satisfiedRequirementIds.push(requirement.requirementId);
  }

  if (invalidRequirementIds.length > 0 || missingRequirements.length > 0) {
    const invalid = invalidRequirementIds.length > 0;
    return {
      status: "insufficient-evidence",
      modelId: definition.modelId,
      reasonCode: invalid ? "invalid-required-evidence" : "missing-required-evidence",
      missingRequirements,
      invalidRequirementIds,
      summary: invalid
        ? `${invalidRequirementIds.length} required evidence item(s) are invalid.`
        : `${missingRequirements.length} required evidence item(s) are unavailable or below observation minimums.`,
    };
  }

  return {
    status: "applicable",
    modelId: definition.modelId,
    satisfiedRequirementIds,
  };
}
