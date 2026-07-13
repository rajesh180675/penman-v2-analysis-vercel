import { canonicalize, reproducibilityHash } from "../../lib/evidenceLocking";
import type {
  AnalysisRunCoreV1,
  AnalysisRunDraftV1,
  AnalysisRunIdentityCoreV1,
  AnalysisRunV1,
  Sha256ContentId,
  StableTrustEnvelopeV1,
} from "./contracts";

function copyAnalysisRunCore(source: AnalysisRunCoreV1): AnalysisRunCoreV1 {
  return {
    schemaVersion: source.schemaVersion,
    executorVersion: source.executorVersion,
    derivationMode: source.derivationMode,
    issuerId: source.issuerId,
    family: source.family,
    asOf: source.asOf,
    status: source.status,
    sourceArtifactIds: source.sourceArtifactIds,
    factSetRef: source.factSetRef,
    policyBundleRef: source.policyBundleRef,
    modelCatalogRef: source.modelCatalogRef,
    familyAnalysisRef: source.familyAnalysisRef,
    analysisWindowRef: source.analysisWindowRef,
    marketSnapshotRef: source.marketSnapshotRef,
    assumptionSetRef: source.assumptionSetRef,
    forecastCaseRefs: source.forecastCaseRefs,
    modelResultRefs: source.modelResultRefs,
    synthesisRef: source.synthesisRef,
    stageResults: source.stageResults,
    gateResults: source.gateResults,
    trustEnvelope: source.trustEnvelope,
    publicationRef: source.publicationRef,
  };
}

function stableTrustEnvelope(
  envelope: AnalysisRunCoreV1["trustEnvelope"],
): StableTrustEnvelopeV1 {
  const stableFields = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => key !== "generatedAt" && key !== "runContext"),
  );
  return {
    ...stableFields,
    runContext: {
      companyId: envelope.runContext.companyId,
      sourceMode: envelope.runContext.sourceMode,
      periodCount: envelope.runContext.periodCount,
      latestPeriod: envelope.runContext.latestPeriod,
    },
  } as StableTrustEnvelopeV1;
}

/**
 * Select the exact, versioned content that participates in run identity.
 *
 * This explicit projection prevents a run from hashing its own hash and keeps
 * volatile instance metadata out of reproducibility identity.
 */
export function selectAnalysisRunIdentityCore(
  source: AnalysisRunCoreV1,
): AnalysisRunIdentityCoreV1 {
  const core = copyAnalysisRunCore(source);
  return {
    ...core,
    trustEnvelope: stableTrustEnvelope(source.trustEnvelope),
  };
}

/** Canonical serialized bytes used as the SHA-256 input. */
export function canonicalizeAnalysisRunCore(source: AnalysisRunCoreV1): string {
  const identityCore = selectAnalysisRunIdentityCore(source);
  return canonicalize(identityCore as unknown as Record<string, unknown>);
}

/** Compute the canonical, algorithm-prefixed AnalysisRun identity. */
export async function hashAnalysisRunCore(
  source: AnalysisRunCoreV1,
): Promise<Sha256ContentId> {
  const identityCore = selectAnalysisRunIdentityCore(source);
  const digest = await reproducibilityHash(identityCore as unknown as Record<string, unknown>);
  return `sha256:${digest}`;
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = cloneAndFreeze(nested);
    }
    return Object.freeze(clone) as unknown as T;
  }
  return value;
}

/**
 * Finalize an immutable run without mutating or freezing the caller's draft.
 */
export async function createAnalysisRunV1(draft: AnalysisRunDraftV1): Promise<AnalysisRunV1> {
  const core = copyAnalysisRunCore(draft);
  const reproducibilityHash = await hashAnalysisRunCore(core);
  const run: AnalysisRunV1 = {
    ...core,
    runId: draft.runId,
    relation: draft.relation,
    createdAt: draft.createdAt,
    reproducibilityHash,
  };
  return cloneAndFreeze(run);
}

/** Verify that stable run content still matches its stamped identity. */
export async function verifyAnalysisRunIdentity(run: AnalysisRunV1): Promise<boolean> {
  return (await hashAnalysisRunCore(run)) === run.reproducibilityHash;
}
