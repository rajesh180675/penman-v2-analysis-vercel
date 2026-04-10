import { MappingBacklogEntry } from "./mappingBacklogPolicy";
import { clusterUnknownLabels, ClusterCandidate } from "./mappingClusterEngine";
import { MAPPING_POLICY_VERSION, CAPITALINE_MAPPING_SPEC_VERSION } from "./policyVersions";

export type MappingPromotionState = "pending-review" | "approved" | "rejected" | "applied";

export interface MappingPromotionCandidate {
  id: string;
  state: MappingPromotionState;
  label: string;
  statement: string;
  suggestedTarget: string | null;
  action: string;
  priority: string;
  evidence: {
    latestValue: number | null;
    periodsObserved: number;
    nonZeroPeriods: number;
    maxAbsValue: number;
    clusterAvgSim: number | null;
    clusterRationale: string | null;
  };
  fingerprints: {
    mappingSpecVersion: string;
    mappingPolicyVersion: string;
  };
}

function candidateId(statement: string, key: string) {
  return `mp:${statement}:${key}`;
}

function clusterByLabel(clusters: ClusterCandidate[]) {
  const map = new Map<string, ClusterCandidate>();
  for (const cluster of clusters) {
    for (const label of cluster.labels) {
      map.set(`${label.statement}:${label.key}`, cluster);
    }
  }
  return map;
}

export function buildMappingPromotionCandidates(params: {
  outOfSpecLabels: MappingBacklogEntry[];
  clusterSuggestions: ReturnType<typeof clusterUnknownLabels>;
}): MappingPromotionCandidate[] {
  const { outOfSpecLabels, clusterSuggestions } = params;
  const clusters = clusterByLabel(clusterSuggestions.clusters);

  return outOfSpecLabels
    .filter((entry) => entry.triage.action !== "ignore-non-core")
    .map((entry) => {
      const cluster = clusters.get(`${entry.statement}:${entry.key}`) ?? null;
      return {
        id: candidateId(entry.statement, entry.key),
        state: "pending-review",
        label: entry.key,
        statement: entry.statement,
        suggestedTarget: cluster?.canonicalKey ?? null,
        action: entry.triage.action,
        priority: entry.triage.priority,
        evidence: {
          latestValue: entry.latestValue,
          periodsObserved: entry.periodsObserved,
          nonZeroPeriods: entry.nonZeroPeriods,
          maxAbsValue: entry.maxAbsValue,
          clusterAvgSim: cluster?.avgSim ?? null,
          clusterRationale: cluster?.rationale ?? null,
        },
        fingerprints: {
          mappingSpecVersion: CAPITALINE_MAPPING_SPEC_VERSION,
          mappingPolicyVersion: MAPPING_POLICY_VERSION,
        },
      } satisfies MappingPromotionCandidate;
    })
    .sort((a, b) => {
      const priorityRank: Record<string, number> = { blocking: 3, diagnostic: 2, optional: 1 };
      return (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0)
        || (b.evidence.maxAbsValue - a.evidence.maxAbsValue)
        || a.statement.localeCompare(b.statement)
        || a.label.localeCompare(b.label);
    });
}
