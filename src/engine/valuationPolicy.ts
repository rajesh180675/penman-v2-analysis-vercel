import { computeContaminationTier } from "./anomalyDetection";
import { buildBusinessModelProfile } from "./forecastingEngine";
import { RawPeriodData, RecastPeriod, SpecFlag } from "./types";

export type ValuationReadinessStatus = "production-ready" | "warning" | "guarded";

export interface ValuationReadiness {
  status: ValuationReadinessStatus;
  latestPeriod: string | null;
  anchorPeriod: string | null;
  anchorIndex: number;
  fallbackUsed: boolean;
  contaminationTier: ReturnType<typeof computeContaminationTier>["tier"];
  persistenceStatus: "durable" | "mixed" | "fragile" | "unknown";
  persistenceScore: number | null;
  terminalFlags: SpecFlag[];
  terminalFlagLabels: string[];
  reasons: string[];
}

function getTerminalFlags(period: RecastPeriod | null | undefined): SpecFlag[] {
  return (period?.spec_flags ?? []).filter((flag) => flag.affects_terminal);
}

function isAcceptableAnchor(period: RecastPeriod | null | undefined): boolean {
  if (!period) return false;
  const contamination = computeContaminationTier(getTerminalFlags(period));
  return contamination.tier === "CLEAN" || contamination.tier === "CAUTION";
}

function derivePersistenceReadiness(periods: RecastPeriod[]) {
  const usablePeriods = periods.filter((period) => period.bs && period.ratios);
  if (usablePeriods.length < 2) {
    return {
      persistenceStatus: "unknown" as const,
      persistenceScore: null,
      reason: null,
    };
  }

  const profile = buildBusinessModelProfile(usablePeriods);
  if (profile.persistenceScore >= 65) {
    return {
      persistenceStatus: "durable" as const,
      persistenceScore: profile.persistenceScore,
      reason: null,
    };
  }
  if (profile.persistenceScore >= 45) {
    return {
      persistenceStatus: "mixed" as const,
      persistenceScore: profile.persistenceScore,
      reason: `Business-model persistence is mixed (${profile.persistenceScore.toFixed(0)}/100), so valuation confidence should stay conservative even with a clean parser state.`,
    };
  }
  return {
    persistenceStatus: "fragile" as const,
    persistenceScore: profile.persistenceScore,
    reason: `Business-model persistence is fragile (${profile.persistenceScore.toFixed(0)}/100); treat upside as lower-confidence even if accounting contamination is clean.`,
  };
}

export function resolveValuationReadiness(periods: RecastPeriod[]): ValuationReadiness {
  if (periods.length === 0) {
    return {
      status: "warning",
      latestPeriod: null,
      anchorPeriod: null,
      anchorIndex: -1,
      fallbackUsed: false,
      contaminationTier: "CLEAN",
      persistenceStatus: "unknown",
      persistenceScore: null,
      terminalFlags: [],
      terminalFlagLabels: [],
      reasons: ["No recast periods available."],
    };
  }

  const latestIndex = periods.length - 1;
  const latest = periods[latestIndex]!;
  const terminalFlags = getTerminalFlags(latest);
  const contamination = computeContaminationTier(terminalFlags);
  const terminalFlagLabels = terminalFlags.map((flag) => flag.label);
  const persistence = derivePersistenceReadiness(periods);
  const usablePeriods = periods.filter((period) => period.bs && period.ratios);
  const reasons = [contamination.message, ...(persistence.reason ? [persistence.reason] : [])];

  if (usablePeriods.length < 2) {
    reasons.push("Valuation requires at least two recast periods with ratio context.");
    return {
      status: "guarded",
      latestPeriod: latest.period_end,
      anchorPeriod: latest.period_end,
      anchorIndex: latestIndex,
      fallbackUsed: false,
      contaminationTier: contamination.tier,
      persistenceStatus: persistence.persistenceStatus,
      persistenceScore: persistence.persistenceScore,
      terminalFlags,
      terminalFlagLabels,
      reasons,
    };
  }

  if (usablePeriods.length < 4 && contamination.tier === "CLEAN") {
    reasons.push("Terminal confidence is being formed on fewer than four recast periods.");
  }

  const twoPeriodWarning = usablePeriods.length < 3 && contamination.tier === "CAUTION";
  if (twoPeriodWarning) {
    reasons.push("Valuation remains warning-grade because only two recast periods are available and the terminal period is not fully clean.");
  }

  if (contamination.tier === "CLEAN") {
    return {
      status: "production-ready",
      latestPeriod: latest.period_end,
      anchorPeriod: latest.period_end,
      anchorIndex: latestIndex,
      fallbackUsed: false,
      contaminationTier: contamination.tier,
      persistenceStatus: persistence.persistenceStatus,
      persistenceScore: persistence.persistenceScore,
      terminalFlags,
      terminalFlagLabels,
      reasons,
    };
  }

  if (contamination.tier === "CAUTION") {
    reasons.push(`Terminal period ${latest.period_end} has review flags but remains usable.`);
    return {
      status: "warning",
      latestPeriod: latest.period_end,
      anchorPeriod: latest.period_end,
      anchorIndex: latestIndex,
      fallbackUsed: false,
      contaminationTier: contamination.tier,
      persistenceStatus: persistence.persistenceStatus,
      persistenceScore: persistence.persistenceScore,
      terminalFlags,
      terminalFlagLabels,
      reasons,
    };
  }

  for (let i = latestIndex - 1; i >= 1; i -= 1) {
    if (!isAcceptableAnchor(periods[i]!)) continue;
    reasons.push(`Using prior anchor period ${periods[i]!.period_end} because ${latest.period_end} is ${contamination.tier.toLowerCase()}.`);
    return {
      status: "guarded",
      latestPeriod: latest.period_end,
      anchorPeriod: periods[i]!.period_end,
      anchorIndex: i,
      fallbackUsed: true,
      contaminationTier: contamination.tier,
      persistenceStatus: persistence.persistenceStatus,
      persistenceScore: persistence.persistenceScore,
      terminalFlags,
      terminalFlagLabels,
      reasons,
    };
  }

  const fallbackIndex = periods.length >= 2 ? latestIndex - 1 : latestIndex;
  const fallbackPeriod = periods[fallbackIndex];
  reasons.push(
    fallbackIndex !== latestIndex
      ? `No clean fallback anchor was found. Using nearest prior period ${fallbackPeriod!.period_end} in guarded mode.`
      : "No prior anchor period is available. Using the latest period in guarded mode."
  );

  return {
    status: "guarded",
    latestPeriod: latest.period_end,
    anchorPeriod: fallbackPeriod?.period_end ?? latest.period_end,
    anchorIndex: fallbackIndex,
    fallbackUsed: fallbackIndex !== latestIndex,
    contaminationTier: contamination.tier,
    persistenceStatus: persistence.persistenceStatus,
    persistenceScore: persistence.persistenceScore,
    terminalFlags,
    terminalFlagLabels,
    reasons,
  };
}

export function deriveCompanyLabel(
  rawData?: RawPeriodData[] | null | undefined,
  configTicker?: string | null | undefined,
  explicitCompanyId?: string | null | undefined,
): string {
  const candidates = [
    configTicker,
    explicitCompanyId,
    rawData?.[rawData.length - 1]?.company_id,
    rawData?.[0]?.company_id,
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim()) return candidate.trim();
  }

  return "—";
}
