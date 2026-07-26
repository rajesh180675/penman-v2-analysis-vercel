import { canonicalize, reproducibilityHash } from "../../lib/evidenceLocking";
import type { FactSetRef } from "../analysisRun";
import {
  FACT_SET_SCHEMA_VERSION,
  type CanonicalFact,
  type CanonicalFactIdentity,
  type FactSet,
  type FactSetContent,
  type Sha256Id,
  type SourceArtifact,
} from "./contracts";

/** Artifact provenance participating in fact identity, normalized as a set. */
export function sourceArtifactIdsForFact(fact: CanonicalFact): readonly Sha256Id[] {
  const ids =
    fact.origin.kind === "derived"
      ? fact.origin.sourceArtifactIds
      : [fact.origin.artifactId];
  return [...ids].sort();
}

/**
 * Select the exact fields which make a fact distinct.
 *
 * Unit and currency are identity-bearing so a crore-share observation can
 * never collide with a superficially equal INR-crore observation. Filing and
 * artifact identity ensure an amended filing is additive rather than an
 * overwrite.
 */
export function selectCanonicalFactIdentity(fact: CanonicalFact): CanonicalFactIdentity {
  return {
    issuerId: fact.issuerId,
    conceptId: fact.conceptId,
    statement: fact.statement,
    factKind: fact.factKind,
    period: fact.period,
    unit: fact.value.normalizedUnit,
    currency: fact.value.kind === "numeric" ? fact.value.currency : null,
    scope: fact.scope,
    dimensions: fact.dimensions,
    accountingStandard: fact.accountingStandard,
    filingVersion: fact.filingVersion,
    sourceArtifactIds: sourceArtifactIdsForFact(fact),
  };
}

export function canonicalizeCanonicalFactIdentity(fact: CanonicalFact): string {
  return canonicalize(
    selectCanonicalFactIdentity(fact) as unknown as Record<string, unknown>,
  );
}

/** Stable map key for duplicate/conflict checks; not a substitute for factId. */
export function canonicalFactIdentityKey(fact: CanonicalFact): string {
  return canonicalizeCanonicalFactIdentity(fact);
}

function selectStableFactContent(fact: CanonicalFact): CanonicalFact {
  if (fact.factKind !== "derived") return fact;
  return {
    ...fact,
    origin: {
      ...fact.origin,
      sourceArtifactIds: [...fact.origin.sourceArtifactIds].sort(),
      inputFactIds: [...fact.origin.inputFactIds].sort(),
    },
  };
}

/** Canonical payload (excluding factId) used to distinguish duplicates from conflicts. */
export function canonicalizeCanonicalFact(fact: CanonicalFact): string {
  const stable = selectStableFactContent(fact);
  return canonicalize(
    { ...stable, factId: undefined } as unknown as Record<string, unknown>,
  );
}

/**
 * Acquisition time is provenance, not content.
 *
 * `acquiredAt` records when we happened to fetch the bytes, so it differs
 * between two parses of a byte-identical ZIP. Leaving it in the identity
 * projection made `factSetId` non-reproducible, which is why every adapter
 * pinned it to `null` — the field could not be populated without breaking the
 * hash. Excluding it here is what makes real acquisition timestamps safe to
 * record.
 *
 * `filingAsOf` deliberately stays in: two exports of the same period filed on
 * different dates are a restatement, and a restatement must not hash-collide
 * with the original. Same reasoning as `filingVersion` in fact identity.
 */
function selectStableArtifactContent(artifact: SourceArtifact): SourceArtifact {
  return { ...artifact, acquiredAt: null };
}

/**
 * Stable FactSet projection. Arrays that are semantically sets are sorted;
 * the self-referential factSetId is deliberately excluded.
 */
export function selectFactSetIdentityContent(
  source: FactSetContent | FactSet,
): FactSetContent {
  return {
    schemaVersion: source.schemaVersion,
    issuerId: source.issuerId,
    sourceArtifacts: [...source.sourceArtifacts]
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
      .map(selectStableArtifactContent),
    facts: [...source.facts]
      .sort((left, right) => left.factId.localeCompare(right.factId))
      .map(selectStableFactContent),
  };
}

export function canonicalizeFactSetContent(source: FactSetContent | FactSet): string {
  return canonicalize(
    selectFactSetIdentityContent(source) as unknown as Record<string, unknown>,
  );
}

export async function hashFactSetContent(
  source: FactSetContent | FactSet,
): Promise<Sha256Id> {
  const stable = selectFactSetIdentityContent(source);
  const digest = await reproducibilityHash(stable as unknown as Record<string, unknown>);
  return `sha256:${digest}`;
}

export async function verifyFactSetIdentity(factSet: FactSet): Promise<boolean> {
  return (await hashFactSetContent(factSet)) === factSet.factSetId;
}

/** Build the AnalysisRun-compatible immutable reference for a persisted set. */
export function factSetContentRef(factSet: FactSet): FactSetRef {
  const canonicalBytes = new TextEncoder().encode(canonicalizeFactSetContent(factSet));
  return {
    kind: "fact-set",
    contentHash: factSet.factSetId,
    mediaType: "application/vnd.penman.canonical-fact-set+json",
    byteLength: canonicalBytes.byteLength,
    schemaVersion: FACT_SET_SCHEMA_VERSION,
  };
}
