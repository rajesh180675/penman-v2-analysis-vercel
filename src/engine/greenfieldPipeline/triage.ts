import type { AdjusterId, AnomalySignal, TriageResult } from "./types";
import { maxSeverity } from "./adapters";
import type { EngineConfig } from "../types";

const DEPENDENCIES: Record<AdjusterId, AdjusterId[]> = {
  A1_LEASE_ADJUSTER: [],
  A2_DIRTY_SURPLUS_ADJUSTER: ["A1_LEASE_ADJUSTER"],
  A3_PRE_BREAK_TRUNCATOR: ["A2_DIRTY_SURPLUS_ADJUSTER"],
  A4_BUYBACK_ADJUSTER: ["A1_LEASE_ADJUSTER", "A2_DIRTY_SURPLUS_ADJUSTER"],
};

function uniqueAdjusters(signals: readonly AnomalySignal[]): AdjusterId[] {
  const values = new Set<AdjusterId>();
  for (const signal of signals) {
    for (const adjuster of signal.suggestedAdjusters) values.add(adjuster);
  }
  return Array.from(values);
}

function topoSort(requested: readonly AdjusterId[]): { order: AdjusterId[]; cycle: boolean } {
  const requestedWithDependencies = new Set<AdjusterId>();
  function addWithDeps(adjuster: AdjusterId): void {
    if (requestedWithDependencies.has(adjuster)) return;
    for (const dependency of DEPENDENCIES[adjuster]) addWithDeps(dependency);
    requestedWithDependencies.add(adjuster);
  }
  for (const adjuster of requested) addWithDeps(adjuster);

  const permanent = new Set<AdjusterId>();
  const temporary = new Set<AdjusterId>();
  const order: AdjusterId[] = [];
  let cycle = false;

  function visit(adjuster: AdjusterId): void {
    if (permanent.has(adjuster)) return;
    if (temporary.has(adjuster)) {
      cycle = true;
      return;
    }
    temporary.add(adjuster);
    for (const dependency of DEPENDENCIES[adjuster]) {
      if (requestedWithDependencies.has(dependency)) visit(dependency);
    }
    temporary.delete(adjuster);
    permanent.add(adjuster);
    order.push(adjuster);
  }

  for (const adjuster of Array.from(requestedWithDependencies)) visit(adjuster);
  return { order, cycle };
}

export function triageSignals(signals: readonly AnomalySignal[], config: EngineConfig): TriageResult {
  const structuralBreakWindowPolicy = config.structural_break_window_policy ?? "auto-post-break";
  const adjustmentMode = config.greenfield_adjustment_mode ?? "adjusted-with-audit";
  const suppressedIds = new Map<string, { suppressedBy: string; reason: string }>();

  for (const suppressor of signals) {
    for (const candidate of suppressor.suppresses) {
      const target = signals.find((signal) => signal.detectorId === candidate.detectorId && signal.period === candidate.period);
      if (target) {
        suppressedIds.set(target.id, { suppressedBy: suppressor.id, reason: candidate.reason });
      }
    }
  }

  const activeSignals = signals.filter((signal) => !suppressedIds.has(signal.id));
  const suppressedSignals = signals.flatMap((signal) => {
    const match = suppressedIds.get(signal.id);
    return match ? [{ signal, suppressedBy: match.suppressedBy, reason: match.reason }] : [];
  });
  const requestedAdjusters = adjustmentMode === "as-reported-only" ? [] : uniqueAdjusters(activeSignals);
  const sorted = topoSort(requestedAdjusters);
  const rationale: string[] = [];

  if (suppressedSignals.length > 0) {
    rationale.push(`${suppressedSignals.length} signal(s) suppressed by higher-specificity same-period evidence.`);
  }
  if (sorted.cycle) {
    rationale.push("Adjuster dependency cycle detected; fail-closed to as-reported only.");
  }
  if (structuralBreakWindowPolicy === "keep-all") {
    rationale.push("User policy keep-all selected; pre-break truncation will not exclude periods.");
  }
  if (adjustmentMode === "as-reported-only") {
    rationale.push("Adjustment mode is as-reported-only; detectors still surface but adjusters are skipped.");
  }

  return {
    activeSignals,
    suppressedSignals,
    aggregateSeverity: maxSeverity(activeSignals.map((signal) => signal.severity)),
    adjusterOrder: sorted.cycle ? [] : sorted.order,
    rationale,
    userPolicy: { structuralBreakWindowPolicy, adjustmentMode },
  };
}
