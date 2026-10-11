/**
 * The forecast ledger: a forecast frozen on the day it was made, to be scored
 * when the years it predicts are reported.
 *
 * Walk-forward backtests re-run the model over old cutoffs, which can only
 * approximate what was knowable (restated data leaks in). A frozen snapshot is
 * the honest counterpart: written once, never regenerated, scored later.
 */
import type { ForecastPeriod, RecastPeriod } from "../types";
import { scoreForecast } from "./walkForward";
import type { ScoredObservation } from "./types";

/**
 * v2 (2026-10-11): the forecast is the app's own run's, and `basis` records the
 * business it forecasts. v1 snapshots were made by the accountability runner's
 * own copy of the run: always the consolidated statements, with no lending arm
 * carved out (the standalone accounts where consolidated history is short).
 */
export const FORECAST_SNAPSHOT_SCHEMA_VERSION = "2026-10-forecast-snapshot-v2" as const;

/** What a frozen forecast is a forecast of, so it is scored against the same thing. */
export interface ForecastSnapshotBasis {
  /** The accounts the run analysed: standalone only when the consolidated history is too short. */
  readonly accounts: "consolidated" | "standalone";
  /**
   * The lending arm the valuation carved out of the accounts, when it carved
   * one (valuationBasis): the forecast is then of the business without it, and
   * its actuals must be carved the same way. Null when nothing was carved.
   */
  readonly lendingArm: string | null;
}

export interface ForecastSnapshot {
  readonly schemaVersion: typeof FORECAST_SNAPSHOT_SCHEMA_VERSION;
  readonly ticker: string;
  readonly companyType: string;
  /** Calendar date the forecast was frozen. */
  readonly madeAt: string;
  /** Last reported period the forecast was allowed to see. */
  readonly cutoffPeriod: string;
  readonly model: "command-center-base";
  readonly basis: ForecastSnapshotBasis;
  readonly assumptions: { readonly ke: number; readonly kw: number; readonly g: number };
  readonly years: readonly {
    readonly periodEnd: string;
    readonly sales: number;
    readonly operatingIncome: number;
    readonly noa: number;
    readonly cni: number;
    readonly cse: number;
  }[];
  /** Equity value per share at freeze, when a share basis resolved. */
  readonly intrinsicPerShare: number | null;
}

export function buildForecastSnapshot(input: {
  ticker: string;
  companyType: string;
  madeAt: string;
  cutoff: RecastPeriod;
  basis: ForecastSnapshotBasis;
  forecast: readonly ForecastPeriod[];
  assumptions: { ke: number; kw: number; g: number };
  intrinsicPerShare: number | null;
}): ForecastSnapshot {
  const baseYear = Number(input.cutoff.period_end.slice(0, 4));
  const suffix = input.cutoff.period_end.slice(4);
  return {
    schemaVersion: FORECAST_SNAPSHOT_SCHEMA_VERSION,
    ticker: input.ticker,
    companyType: input.companyType,
    madeAt: input.madeAt,
    cutoffPeriod: input.cutoff.period_end,
    model: "command-center-base",
    basis: input.basis,
    assumptions: input.assumptions,
    years: input.forecast.map((f, i) => ({
      periodEnd: `${baseYear + i + 1}${suffix}`,
      sales: f.Sales_f,
      operatingIncome: f.OI_f,
      noa: f.NOA_f,
      cni: f.CNI_f,
      cse: f.CSE_f,
    })),
    intrinsicPerShare: input.intrinsicPerShare,
  };
}

/**
 * Score a frozen snapshot against the periods now available. Periods after
 * the cutoff are the actuals; periods up to it rebuild the naive benchmarks,
 * so they use only what the snapshot could see.
 */
export function scoreSnapshot(snapshot: ForecastSnapshot, periods: readonly RecastPeriod[]): {
  observations: ScoredObservation[];
  reportedYears: number;
} {
  const sorted = [...periods].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const history = sorted.filter((p) => p.period_end <= snapshot.cutoffPeriod);
  const future = sorted.filter((p) => p.period_end > snapshot.cutoffPeriod);
  if (!history.length || history[history.length - 1]!.period_end !== snapshot.cutoffPeriod) {
    return { observations: [], reportedYears: 0 };
  }
  const forecast = snapshot.years.map((y) => ({
    Sales_f: y.sales,
    OI_f: y.operatingIncome,
    NOA_f: y.noa,
    CNI_f: y.cni,
    CSE_f: y.cse,
  })) as unknown as ForecastPeriod[];
  return {
    observations: scoreForecast(history, forecast, future, snapshot.years.length),
    reportedYears: future.length,
  };
}
