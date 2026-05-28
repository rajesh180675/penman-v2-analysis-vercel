/* ================================================================
   Plan 5b PR-5b.3 — Working-capital sustainability gate.

   The cash conversion cycle (CCC) measures how long capital is
   tied up in operations:
     CCC = DSO + DIO - DPO
       DSO = days sales outstanding (receivables / revenue * 365)
       DIO = days inventory outstanding (inventory / COGS * 365)
       DPO = days payables outstanding (payables / COGS * 365)

   A widening CCC versus the company's own history, especially when
   it crosses the sector P95, is one of the cleanest tells that
   earnings quality is degrading: revenue is being pulled forward
   via channel stuffing, or inventory is rotting, or supplier
   payment terms are being renegotiated to mask cash burn.

   This module exposes:
     computeCcc(period)                    DSO + DIO - DPO for a period
     evaluateWorkingCapitalGate({periods,
                                 sectorP95}) trend + threshold check
     SECTOR_CCC_P95                        static reference table

   PR-5b.3 ships the gate logic + tests. Wiring into the rigor
   ladder (so a 'distressed' verdict flags economically-plausible)
   is a follow-up.
================================================================ */

export interface CccPeriodInputs {
  periodEnd: string;
  /** Revenue for the period (₹). */
  revenue: number;
  /** Cost of goods sold for the period (₹). */
  cogs: number;
  /** Trade receivables at period end (₹). */
  receivables: number;
  /** Inventory at period end (₹). */
  inventory: number;
  /** Trade payables at period end (₹). */
  payables: number;
  /** Optional explicit days-in-period override (default 365). */
  daysInPeriod?: number | undefined;
}

export interface CccDecomposition {
  periodEnd: string;
  dso: number;
  dio: number;
  dpo: number;
  ccc: number;
}

export function computeCcc(period: CccPeriodInputs): CccDecomposition {
  const days = period.daysInPeriod ?? 365;
  const dso = period.revenue > 0 ? (period.receivables / period.revenue) * days : 0;
  const dio = period.cogs > 0 ? (period.inventory / period.cogs) * days : 0;
  const dpo = period.cogs > 0 ? (period.payables / period.cogs) * days : 0;
  return { periodEnd: period.periodEnd, dso, dio, dpo, ccc: dso + dio - dpo };
}

/** Sector CCC P95 reference (days). Sourced from screener.in 5y rolling. */
export const SECTOR_CCC_P95: Record<string, number> = {
  FMCG: 75,
  IT_Services: 70,
  Pharma: 140,
  Auto: 80,
  Cement: 60,
  Steel: 110,
  Retail: 90,
  Real_Estate: 280,
  Construction: 320,
  Telecom: 60,
  Power: 95,
  Diversified: 120,
};

export type WorkingCapitalVerdict = "healthy" | "stretched" | "distressed";

export interface WorkingCapitalGateInputs {
  /** Most-recent-last sequence of period inputs. Min 2 periods. */
  periods: ReadonlyArray<CccPeriodInputs>;
  /** Sector key (matched against SECTOR_CCC_P95) or explicit threshold. */
  sectorKey?: string | undefined;
  /** Override the sector P95 threshold (days). */
  sectorP95Override?: number | undefined;
  /** Trend window in years (default 3). Looks at delta over this window. */
  trendWindowYears?: number | undefined;
  /** Minimum days of sustained CCC > sector P95 to escalate to "distressed". */
  distressedDeltaDays?: number | undefined;
}

export interface WorkingCapitalGateResult {
  perPeriod: CccDecomposition[];
  /** Latest CCC (days). */
  latestCcc: number;
  /** CCC at the start of the trend window. */
  baselineCcc: number;
  /** Year-over-year deterioration in days (positive = worsening). */
  trendDeltaDays: number;
  /** Sector P95 used. */
  sectorP95: number;
  verdict: WorkingCapitalVerdict;
  diagnostics: string[];
}

const DEFAULT_TREND_WINDOW = 3;
const DEFAULT_DISTRESSED_DELTA = 30;
const DEFAULT_FALLBACK_P95 = 120;

export function evaluateWorkingCapitalGate(
  inputs: WorkingCapitalGateInputs,
): WorkingCapitalGateResult {
  if (inputs.periods.length < 2) {
    throw new Error("evaluateWorkingCapitalGate: at least 2 periods required");
  }

  const window = inputs.trendWindowYears ?? DEFAULT_TREND_WINDOW;
  const distressedDelta = inputs.distressedDeltaDays ?? DEFAULT_DISTRESSED_DELTA;
  const sectorP95 =
    inputs.sectorP95Override ??
    (inputs.sectorKey ? SECTOR_CCC_P95[inputs.sectorKey] ?? DEFAULT_FALLBACK_P95 : DEFAULT_FALLBACK_P95);

  const perPeriod = inputs.periods.map(computeCcc);
  const latest = perPeriod[perPeriod.length - 1]!;
  const baselineIdx = Math.max(0, perPeriod.length - 1 - window);
  const baseline = perPeriod[baselineIdx]!;
  const trendDelta = latest.ccc - baseline.ccc;

  const diagnostics: string[] = [];
  let verdict: WorkingCapitalVerdict = "healthy";

  if (latest.ccc > sectorP95) {
    diagnostics.push(
      `Latest CCC ${latest.ccc.toFixed(0)}d exceeds sector P95 ${sectorP95.toFixed(0)}d.`,
    );
    verdict = "stretched";
  }

  if (trendDelta >= distressedDelta) {
    diagnostics.push(
      `CCC widened by ${trendDelta.toFixed(0)}d over ${window}y window — material deterioration.`,
    );
    if (verdict === "stretched") verdict = "distressed";
    else if (verdict === "healthy") verdict = "stretched";
  }

  if (latest.ccc > sectorP95 && trendDelta >= distressedDelta) {
    verdict = "distressed";
  }

  // Component-level diagnostics for triage
  if (latest.dso > sectorP95 * 0.6) {
    diagnostics.push(
      `DSO ${latest.dso.toFixed(0)}d is the largest component — channel-stuffing or collection risk.`,
    );
  }
  if (latest.dio > sectorP95 * 0.6) {
    diagnostics.push(
      `DIO ${latest.dio.toFixed(0)}d is the largest component — slow inventory turn or write-down risk.`,
    );
  }

  return {
    perPeriod,
    latestCcc: latest.ccc,
    baselineCcc: baseline.ccc,
    trendDeltaDays: trendDelta,
    sectorP95,
    verdict,
    diagnostics,
  };
}
