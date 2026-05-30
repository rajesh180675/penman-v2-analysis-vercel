import { MappingStatement } from "./mappingPolicy";
import { CapitalineMappingSpec } from "./mappingSpec";

/* ================================================================
   Phase 3.1: Three-Tier Mapping Ontology — Layer 3
   Pattern-Based Expansion / Clustering Engine

   Clustering engine groups similar unknown labels and suggests
   mapping spec additions based on pattern similarity and correlation.
=============================================================== */

// ── Similarity metrics ──────────────────────────────────────────────

/** Jaccard similarity on token sets after normalization. */
export function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection += 1;
  return intersection / (tokensA.size + tokensB.size - intersection);
}

/** Dice coefficient on token sets. */
export function tokenDice(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  const sizeA = tokensA.size;
  const sizeB = tokensB.size;
  if (sizeA === 0 || sizeB === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection += 1;
  return (2 * intersection) / (sizeA + sizeB);
}

/** Pearson correlation between two parallel value arrays. */
export function pearsonCorrelation(X: number[], Y: number[]): number {
  const n = X.length;
  if (n < 3) return 0;
  const meanX = X.reduce((s, v) => s + v, 0) / n;
  const meanY = Y.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = X[i]! - meanX;
    const dy = Y[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom > 0 ? cov / denom : 0;
}

// ── Clustering ──────────────────────────────────────────────────────

export interface UnmappedLabel {
  key: string;
  statement: MappingStatement | "Unknown";
  /** Value history across periods (aligned). */
  values: number[];
}

export interface ClusterCandidate {
  /** Canonical spec key the cluster maps to. */
  canonicalKey: string;
  /** All labels in this cluster. */
  labels: UnmappedLabel[];
  /** Average similarity within the cluster. */
  avgSim: number;
  /** Recommendation. */
  recommendation: ClusterRecommendation;
  rationale: string;
}

export type ClusterRecommendation =
  | "add-alias"       // High similarity — add to existing spec as alias
  | "add-sub-key"     // Moderate similarity — new sub-key in existing group
  | "review-manual"   // Low similarity — needs human review
  | "presentation-variant" // Duplicate/subtotal — ignore
  | "correlation-match";   // Matched by value correlation, not text

export interface ClusterResult {
  clusters: ClusterCandidate[];
  unclustered: UnmappedLabel[];
  stats: {
    totalUnknown: number;
    clusteredCount: number;
    aliasRecommendation: number;
    reviewCount: number;
  };
}

const CLUSTER_SIM_THRESHOLD = 0.55;

export function clusterUnknownLabels(
  unknownLabels: UnmappedLabel[],
  options?: {
    /** Override similarity threshold (default 0.55). */
    simThreshold?: number | undefined;
    /** Max labels returned as suggestions (default 20). */
    maxSuggestions?: number | undefined;
  },
): ClusterResult {
  const { simThreshold = CLUSTER_SIM_THRESHOLD, maxSuggestions = 20 } = options ?? {};

  const clusters = new Map<string, ClusterCandidate>();
  const unclustered: UnmappedLabel[] = [];

  // Build a reverse index from known canonical keys to their token sets
  const canonicalEntries = flattenSpecKeys();

  for (const label of unknownLabels) {
    let bestMatch: { key: string; sim: number } | null = null;

    // Text similarity against all known spec keys
    for (const ce of canonicalEntries) {
      const sim = tokenDice(label.key, ce.key);
      if (sim > simThreshold && (!bestMatch || sim > bestMatch.sim)) {
        bestMatch = { key: ce.canonicalKey, sim };
      }
    }

    if (bestMatch) {
      const existing = clusters.get(bestMatch.key);
      if (existing) {
        existing.labels.push(label);
        // Recompute average similarity
        existing.avgSim = existing.labels.reduce((s, l) => {
          const matchSim = existing.labels.reduce((ss, other) => {
            if (other === l) return ss;
            return ss + tokenDice(l.key, other.key);
          }, 0) / Math.max(existing.labels.length - 1, 1);
          return s + matchSim;
        }, 0) / Math.max(existing.labels.length, 1);
      } else {
        clusters.set(bestMatch.key, {
          canonicalKey: bestMatch.key,
          labels: [label],
          avgSim: bestMatch.sim,
          recommendation: recommendForSim(bestLabelSim([label], bestMatch.key)),
          rationale: `Text similarity score ${(bestMatch.sim * 100).toFixed(0)}% matches existing spec key "${bestMatch.key}"`,
        });
      }
    } else {
      unclustered.push(label);
    }
  }

  // Sort clusters by avgSim descending
  const sortedClusters = Array.from(clusters.values())
    .sort((a, b) => b.avgSim - a.avgSim)
    .slice(0, maxSuggestions);

  return {
    clusters: sortedClusters,
    unclustered,
    stats: {
      totalUnknown: unknownLabels.length,
      clusteredCount: sortedClusters.reduce((s, c) => s + c.labels.length, 0),
      aliasRecommendation: sortedClusters.filter((c) => c.recommendation === "add-alias").length,
      reviewCount: sortedClusters.filter((c) => c.recommendation === "review-manual").length,
    },
  };
}

// ── Correlation-based matching ─────────────────────────────────────

export interface CorrelationMatch {
  unknownKey: string;
  statement: MappingStatement | "Unknown";
  /** Most correlated canonical key. */
  canonicalKey: string;
  /** Most correlated existing unknown label (if any). */
  correlatedUnknown: string | null;
  pearsonWithKnown: number;
  pearsonWithUnknown: number;
  recommendation: "strong-candidate" | "potential-subset" | "ambiguous";
  rationale: string;
}

/**
 * Match unknown labels to canonical keys by value correlation.
 * Requires parallel period values for both unknown and known.
 * A label with |r| > 0.95 and a canonical key is a strong alias candidate.
 */
export function findCorrelationMatches(
  unknownLabels: UnmappedLabel[],
  knownLabels: Map<string, number[]>,
  correlationThreshold = 0.95,
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];

  for (const unl of unknownLabels) {
    if (unl.values.length < 3) continue;

    let bestKnown: { key: string; r: number } | null = null;
    for (const [key, vals] of knownLabels) {
      if (vals.length !== unl.values.length) continue;
      // Skip if values are constant (no signal)
      if (vals.every((v) => v === vals[0]) || unl.values.every((v) => v === unl.values[0])) continue;
      const r = Math.abs(pearsonCorrelation(vals, unl.values));
      if (r > correlationThreshold && (!bestKnown || r > bestKnown.r)) {
        bestKnown = { key, r };
      }
    }

    // Also check correlation with other unknown labels
    let bestUnknown: { key: string; r: number } | null = null;
    for (const other of unknownLabels) {
      if (other.key === unl.key) continue;
      if (other.values.length !== unl.values.length) continue;
      if (other.values.every((v) => v === other.values[0]) || unl.values.every((v) => v === unl.values[0])) continue;
      const r = Math.abs(pearsonCorrelation(other.values, unl.values));
      if (r > 0.98 && (!bestUnknown || r > bestUnknown.r)) {
        bestUnknown = { key: other.key, r };
      }
    }

    if (bestKnown || bestUnknown) {
      const recommendation: CorrelationMatch["recommendation"] =
        bestKnown && bestKnown.r >= 0.99
          ? "strong-candidate"
          : bestKnown ? "potential-subset" : "ambiguous";

      matches.push({
        unknownKey: unl.key,
        statement: unl.statement,
        canonicalKey: bestKnown?.key ?? "(none)",
        correlatedUnknown: bestUnknown?.key ?? null,
        pearsonWithKnown: bestKnown?.r ?? 0,
        pearsonWithUnknown: bestUnknown?.r ?? 0,
        recommendation,
        rationale: buildCorrelationRationale(bestKnown, bestUnknown),
      });
    }
  }

  return matches.sort((a, b) => b.pearsonWithKnown - a.pearsonWithKnown);
}

// ── Internal helpers ────────────────────────────────────────────────

function bestLabelSim(labels: UnmappedLabel[], canonicalKey: string): number {
  const canonicalEntry = flattenSpecKeys().find((ce) => ce.canonicalKey === canonicalKey);
  if (!canonicalEntry) return 0;
  return Math.max(...labels.map((l) => tokenDice(l.key, canonicalEntry.key)));
}

function recommendForSim(avgSim: number): ClusterRecommendation {
  if (avgSim < 0.25) return "review-manual";
  if (avgSim < 0.45) return "add-sub-key";
  return "add-alias";
}

/** Tokenize a label: lowercase words, remove punctuation, split camelCase/PascalCase. */
function tokenize(label: string): string[] {
  return label
    .toLowerCase()                                  // normalize case
    .replace(/([a-z])([A-Z])/g, "$1 $2")            // camelCase → camel Case
    .replace(/[-_/|]/g, " ")                        // separators → spaces
    .replace(/[:;.]/g, "")                          // remove trailing punctuation
    .replace(/and|&/g, "")                          // remove connectors
    .replace(/\b(?:total|the|of|for|other|net|not)\b/gi, "") // remove noise words
    .split(/\s+/)
    .filter((t) => t.length > 2);                   // skip very short words
}

/** Flatten the CapitalineMappingSpec into a list of (key, aliases). */
function flattenSpecKeys(): Array<{ key: string; canonicalKey: string }> {
  const result: Array<{ key: string; canonicalKey: string }> = [];

  function walk(obj: Record<string, unknown>, prefix: string) {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        for (const alias of v as string[]) {
          result.push({ key: alias, canonicalKey: path });
        }
      } else if (v && typeof v === "object") {
        walk(v as Record<string, unknown>, path);
      }
    }
  }

  walk(CapitalineMappingSpec as unknown as Record<string, unknown>, "");
  return result;
}

function buildCorrelationRationale(
  known: { key: string; r: number } | null,
  unknown: { key: string; r: number } | null,
): string {
  const parts: string[] = [];
  if (known) parts.push(`r=${known.r.toFixed(3)} with "${known.key}"`);
  if (unknown) parts.push(`r=${unknown.r.toFixed(3)} with "${unknown.key}" (unknown)`);
  return "Correlation: " + parts.join("; ");
}
