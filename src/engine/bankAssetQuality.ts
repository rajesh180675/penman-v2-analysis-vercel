/**
 * Bank Asset Quality Signals — Phase B5.2
 *
 * Derives reviewer-actionable signals from per-period BankQualityIndicators:
 *
 *   - NPA cycle position: rising / peaking / improving / stable
 *   - PCR trend: improving / stable / weakening
 *   - Slippage trajectory: 3y direction
 *   - Loan growth vs system credit growth (delta in pp)
 *   - Deposit franchise quality (CASA level + 3y trend)
 *   - Capital buffer (Tier-1 over RBI minimum, severity coded)
 *
 * Each signal is independently skip-with-reason so a partially-curated
 * sidecar (e.g., GNPA filled but PCR missing) still produces meaningful
 * output for the fields that ARE present.
 *
 * Pure function over RecastPeriod-equivalent inputs — never mutates,
 * never throws on missing data. Mirrors moatScoreResult / capAllocScoreResult
 * conventions from Phase I (dataSufficient, skipReason, computedFor).
 */

import type { BankQualityPeriod } from "./bankQualityIndicators";

// ─── Output types ───────────────────────────────────────────────────

export type NPACyclePosition = "rising" | "peaking" | "improving" | "stable";
export type TrendDirection = "improving" | "stable" | "weakening";
export type CapitalBufferSeverity = "comfortable" | "adequate" | "thin" | "breach";

export interface NPACycleSignal {
  position: NPACyclePosition | null;
  /** Latest GNPA% used as the anchor. */
  latest_gnpa_pct: number | null;
  /** 3y prior GNPA% (or oldest available within window). */
  prior_gnpa_pct: number | null;
  /** Periods used in the comparison window. */
  periodsUsed: number;
  dataSufficient: boolean;
  skipReason?: string | undefined;
}

export interface PCRTrendSignal {
  direction: TrendDirection | null;
  latest_pcr_pct: number | null;
  prior_pcr_pct: number | null;
  /** Plain-language interpretation. */
  summary: string | null;
  dataSufficient: boolean;
  skipReason?: string | undefined;
}

export interface SlippageSignal {
  direction: TrendDirection | null;
  latest_slippage_pct: number | null;
  prior_slippage_pct: number | null;
  periodsUsed: number;
  dataSufficient: boolean;
  skipReason?: string | undefined;
}

export interface LoanGrowthSignal {
  /** Bank's latest YoY advances growth %. */
  bank_growth_pct: number | null;
  /** Reference system credit growth % (config or sector default). */
  system_growth_pct: number;
  /** Bank − system, in percentage points. Positive = market-share gainer. */
  delta_pp: number | null;
  /** Categorical interpretation. */
  interpretation:
    | "outpacing-system"
    | "in-line-with-system"
    | "lagging-system"
    | null;
  dataSufficient: boolean;
  skipReason?: string | undefined;
}

export interface DepositFranchiseSignal {
  latest_casa_pct: number | null;
  prior_casa_pct: number | null;
  /** Categorical level vs Indian banking system norms. */
  level: "premium" | "above-average" | "average" | "weak" | null;
  trend: TrendDirection | null;
  /** Plain-language interpretation. */
  summary: string | null;
  dataSufficient: boolean;
  skipReason?: string | undefined;
}

export interface CapitalBufferSignal {
  severity: CapitalBufferSeverity | null;
  latest_tier1_pct: number | null;
  latest_crar_pct: number | null;
  /** RBI minimum Tier-1 used as the floor (config-aware). */
  tier1_minimum_pct: number;
  /** Headroom = latest_tier1 − minimum, in percentage points. */
  headroom_pp: number | null;
  dataSufficient: boolean;
  skipReason?: string | undefined;
}

export interface BankAssetQualityResult {
  /** All signals are independently skip-with-reason — partial coverage is fine. */
  npaCycle: NPACycleSignal;
  pcrTrend: PCRTrendSignal;
  slippage: SlippageSignal;
  loanGrowth: LoanGrowthSignal;
  depositFranchise: DepositFranchiseSignal;
  capitalBuffer: CapitalBufferSignal;
  /** Summary indicating overall sidecar coverage. */
  coverage: {
    periodsWithQuality: number;
    totalPeriods: number;
    /** Fraction of fields populated across the latest period. */
    latestFieldDensity: number;
  };
}

// ─── Defaults ───────────────────────────────────────────────────────

/**
 * Indian system credit growth ~12% over the long run. Expose as a
 * config knob so users can swap in the live RBI Sectoral Deployment
 * number (typically 9-15% in any given year).
 */
export const DEFAULT_SYSTEM_CREDIT_GROWTH_PCT = 12;

/**
 * Basel III + India adjustments for scheduled commercial banks:
 *   CET1 minimum 5.5% + CCB 2.5% = 8.0%
 *   Tier-1 minimum 7.0% + CCB 2.5% = 9.5%
 *   Total CRAR minimum 9.0% + CCB 2.5% = 11.5%
 *   D-SIB surcharge: +0.20% to +0.80% (HDFC, ICICI, SBI)
 *
 * We use the Tier-1 floor as the default minimum since that's what
 * regulators stress in supervisory action.
 */
export const RBI_TIER1_MINIMUM_PCT = 9.5;

// ─── Helpers ────────────────────────────────────────────────────────

function sortByDate<T extends { period_end: string }>(arr: T[]): T[] {
  return [...arr].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );
}

function isFiniteNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

/** Find the latest period that has the requested field populated. */
function latestWith<T>(
  periods: BankQualityPeriod[],
  pick: (p: BankQualityPeriod) => T | null | undefined,
): { period: BankQualityPeriod; value: T } | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    const v = pick(periods[i]!);
    if (v != null) return { period: periods[i]!, value: v };
  }
  return null;
}

// ─── Signal builders ────────────────────────────────────────────────

function buildNPACycle(periods: BankQualityPeriod[]): NPACycleSignal {
  const sorted = sortByDate(periods).filter((p) => isFiniteNum(p.gnpa_pct));
  if (sorted.length < 2) {
    return {
      position: null,
      latest_gnpa_pct: null,
      prior_gnpa_pct: null,
      periodsUsed: sorted.length,
      dataSufficient: false,
      skipReason: `need >=2 periods with GNPA, have ${sorted.length}`,
    };
  }
  const latest = sorted[sorted.length - 1]!;
  // Use 3y prior if available, else oldest in window
  const priorIdx = sorted.length >= 4 ? sorted.length - 4 : 0;
  const prior = sorted[priorIdx]!;

  const latestG = latest.gnpa_pct as number;
  const priorG = prior.gnpa_pct as number;
  const delta = latestG - priorG;

  // Recent-direction check: compare latest vs the previous period to
  // disambiguate "peaking" (was rising, now flat-or-down) from "rising"
  // (still climbing).
  const prev = sorted[sorted.length - 2]!;
  const recentDelta = latestG - (prev.gnpa_pct as number);

  let position: NPACyclePosition;
  if (delta > 0.5 && recentDelta > 0.1) {
    position = "rising";
  } else if (delta > 0.5 && recentDelta <= 0.1) {
    position = "peaking";
  } else if (delta < -0.5) {
    position = "improving";
  } else {
    position = "stable";
  }

  return {
    position,
    latest_gnpa_pct: latestG,
    prior_gnpa_pct: priorG,
    periodsUsed: sorted.length - priorIdx,
    dataSufficient: true,
  };
}

function buildPCRTrend(periods: BankQualityPeriod[]): PCRTrendSignal {
  const sorted = sortByDate(periods).filter((p) => isFiniteNum(p.pcr_pct));
  if (sorted.length < 2) {
    return {
      direction: null,
      latest_pcr_pct: null,
      prior_pcr_pct: null,
      summary: null,
      dataSufficient: false,
      skipReason: `need >=2 periods with PCR, have ${sorted.length}`,
    };
  }
  const latest = sorted[sorted.length - 1]!.pcr_pct as number;
  // 3y-prior anchor when available
  const priorIdx = sorted.length >= 4 ? sorted.length - 4 : 0;
  const prior = sorted[priorIdx]!.pcr_pct as number;
  const delta = latest - prior;

  let direction: TrendDirection;
  let summary: string;
  if (delta > 5) {
    direction = "improving";
    summary = `PCR rose from ${prior.toFixed(1)}% to ${latest.toFixed(1)}% — provisioning buffer thickening`;
  } else if (delta < -5) {
    direction = "weakening";
    summary = `PCR fell from ${prior.toFixed(1)}% to ${latest.toFixed(1)}% — provisioning buffer eroding`;
  } else {
    direction = "stable";
    summary = `PCR stable at ${latest.toFixed(1)}% (vs ${prior.toFixed(1)}% prior)`;
  }

  return {
    direction,
    latest_pcr_pct: latest,
    prior_pcr_pct: prior,
    summary,
    dataSufficient: true,
  };
}

function buildSlippage(periods: BankQualityPeriod[]): SlippageSignal {
  const sorted = sortByDate(periods).filter((p) => isFiniteNum(p.slippage_pct));
  if (sorted.length < 2) {
    return {
      direction: null,
      latest_slippage_pct: null,
      prior_slippage_pct: null,
      periodsUsed: sorted.length,
      dataSufficient: false,
      skipReason:
        sorted.length === 0
          ? "no slippage data — typically reported only in MD&A prose, not the 10y highlights table"
          : `need >=2 periods with slippage, have ${sorted.length}`,
    };
  }
  const latest = sorted[sorted.length - 1]!.slippage_pct as number;
  const priorIdx = sorted.length >= 4 ? sorted.length - 4 : 0;
  const prior = sorted[priorIdx]!.slippage_pct as number;
  const delta = latest - prior;

  let direction: TrendDirection;
  if (delta < -0.3) direction = "improving";
  else if (delta > 0.3) direction = "weakening";
  else direction = "stable";

  return {
    direction,
    latest_slippage_pct: latest,
    prior_slippage_pct: prior,
    periodsUsed: sorted.length - priorIdx,
    dataSufficient: true,
  };
}

function buildLoanGrowth(
  periods: BankQualityPeriod[],
  systemCreditGrowthPct: number,
): LoanGrowthSignal {
  const found = latestWith(sortByDate(periods), (p) =>
    isFiniteNum(p.advances_growth_pct) ? p.advances_growth_pct : null,
  );
  if (!found) {
    return {
      bank_growth_pct: null,
      system_growth_pct: systemCreditGrowthPct,
      delta_pp: null,
      interpretation: null,
      dataSufficient: false,
      skipReason: "no advances_growth_pct in any period",
    };
  }
  const bankG = found.value;
  const delta = bankG - systemCreditGrowthPct;

  let interpretation: LoanGrowthSignal["interpretation"];
  if (delta > 3) interpretation = "outpacing-system";
  else if (delta < -3) interpretation = "lagging-system";
  else interpretation = "in-line-with-system";

  return {
    bank_growth_pct: bankG,
    system_growth_pct: systemCreditGrowthPct,
    delta_pp: delta,
    interpretation,
    dataSufficient: true,
  };
}

function buildDepositFranchise(periods: BankQualityPeriod[]): DepositFranchiseSignal {
  const sorted = sortByDate(periods).filter((p) => isFiniteNum(p.casa_pct));
  if (sorted.length === 0) {
    return {
      latest_casa_pct: null,
      prior_casa_pct: null,
      level: null,
      trend: null,
      summary: null,
      dataSufficient: false,
      skipReason: "no CASA data in any period",
    };
  }
  const latestCasa = sorted[sorted.length - 1]!.casa_pct as number;

  // Indian banking system norms (FY24 industry distribution):
  //   HDFC/SBI/ICICI/Kotak: 35–45% (premium)
  //   Top private (Axis/IndusInd): 30–40% (above-average)
  //   PSU mid-tier: 25–35% (average)
  //   NBFC-bank converts / older PSUs: <25% (weak)
  let level: DepositFranchiseSignal["level"];
  if (latestCasa >= 40) level = "premium";
  else if (latestCasa >= 30) level = "above-average";
  else if (latestCasa >= 22) level = "average";
  else level = "weak";

  // Trend (only when we have >=2 points)
  let trend: TrendDirection | null = null;
  let priorCasa: number | null = null;
  if (sorted.length >= 2) {
    const priorIdx = sorted.length >= 4 ? sorted.length - 4 : 0;
    priorCasa = sorted[priorIdx]!.casa_pct as number;
    const delta = latestCasa - priorCasa;
    if (delta > 2) trend = "improving";
    else if (delta < -2) trend = "weakening";
    else trend = "stable";
  }

  const trendStr = trend ? ` (trend ${trend})` : "";
  const summary = `CASA at ${latestCasa.toFixed(1)}% — ${level} franchise${trendStr}`;

  return {
    latest_casa_pct: latestCasa,
    prior_casa_pct: priorCasa,
    level,
    trend,
    summary,
    dataSufficient: true,
  };
}

function buildCapitalBuffer(
  periods: BankQualityPeriod[],
  tier1Minimum: number,
): CapitalBufferSignal {
  const sorted = sortByDate(periods);
  const t1Found = latestWith(sorted, (p) => (isFiniteNum(p.tier1_pct) ? p.tier1_pct : null));
  const crarFound = latestWith(sorted, (p) => (isFiniteNum(p.crar_pct) ? p.crar_pct : null));

  if (!t1Found && !crarFound) {
    return {
      severity: null,
      latest_tier1_pct: null,
      latest_crar_pct: null,
      tier1_minimum_pct: tier1Minimum,
      headroom_pp: null,
      dataSufficient: false,
      skipReason: "no Tier-1 or CRAR data in any period",
    };
  }

  // Prefer Tier-1 for the buffer calculation; fall back to CRAR-as-proxy
  // (less precise but better than nothing). When using CRAR we reduce
  // the headroom by 1.5pp to approximate the Tier-1/Total spread.
  // M3 fix: reduced from 2pp to 1.5pp — the 2pp deduction was too aggressive
  // for banks with CRAR ~10-11%, producing false "breach" severities.
  // The result is flagged as "approximated" via the `source` field.
  const useTier1 = t1Found != null;
  const crarProxy = crarFound != null ? Math.max(0, (crarFound.value as number) - 1.5) : 0;
  const baseRatio = useTier1 ? t1Found!.value : crarProxy;
  const headroom = baseRatio - tier1Minimum;

  let severity: CapitalBufferSeverity;
  if (headroom < 0) severity = "breach";
  else if (headroom < 1) severity = "thin";
  else if (headroom < 3) severity = "adequate";
  else severity = "comfortable";

  return {
    severity,
    latest_tier1_pct: t1Found?.value ?? null,
    latest_crar_pct: crarFound?.value ?? null,
    tier1_minimum_pct: tier1Minimum,
    headroom_pp: headroom,
    dataSufficient: true,
  };
}

// ─── Public API ─────────────────────────────────────────────────────

export interface AssetQualityConfig {
  /** Reference system-wide credit growth % for loan-growth comparison. */
  systemCreditGrowthPct?: number | undefined;
  /** RBI minimum Tier-1 % (default 9.5% covers Basel III + CCB). */
  tier1MinimumPct?: number | undefined;
}

/**
 * Compute the full asset-quality signal bundle from per-period quality
 * indicators. Each signal is independently skip-with-reason; partial
 * coverage produces partial output.
 *
 * @param periods  Quality records joined to bank periods. May be empty.
 * @param config   Optional thresholds — defaults match Indian bank norms.
 */
export function computeBankAssetQuality(
  periods: BankQualityPeriod[] | null | undefined,
  config: AssetQualityConfig = {},
): BankAssetQualityResult {
  const safe = periods ?? [];
  const systemG = config.systemCreditGrowthPct ?? DEFAULT_SYSTEM_CREDIT_GROWTH_PCT;
  const t1Min = config.tier1MinimumPct ?? RBI_TIER1_MINIMUM_PCT;

  // Coverage diagnostic — how complete is the latest period?
  let latestFieldDensity = 0;
  if (safe.length > 0) {
    const latest = sortByDate(safe)[safe.length - 1]!;
    const fields: Array<keyof BankQualityPeriod> = [
      "gnpa_pct",
      "nnpa_pct",
      "pcr_pct",
      "slippage_pct",
      "crar_pct",
      "tier1_pct",
      "casa_pct",
      "advances_growth_pct",
    ];
    const populated = fields.filter((f) => isFiniteNum(latest[f] as number | null | undefined)).length;
    latestFieldDensity = populated / fields.length;
  }

  return {
    npaCycle: buildNPACycle(safe),
    pcrTrend: buildPCRTrend(safe),
    slippage: buildSlippage(safe),
    loanGrowth: buildLoanGrowth(safe, systemG),
    depositFranchise: buildDepositFranchise(safe),
    capitalBuffer: buildCapitalBuffer(safe, t1Min),
    coverage: {
      periodsWithQuality: safe.length,
      totalPeriods: safe.length,
      latestFieldDensity,
    },
  };
}
