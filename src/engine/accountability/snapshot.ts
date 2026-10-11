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

/** One fiscal year as first filed (data/filings ledger): what a frozen forecast is scored against. */
export interface FiledYear {
  readonly fiscalYearEnd: string;
  /** Revenue from operations as filed: gross of any excise duty it itemizes. */
  readonly revenue: number | null;
  readonly exciseDuty?: number | null | undefined;
  readonly profitAttributableToOwners: number | null;
  readonly equityAttributableToOwners: number | null;
}

export interface FiledScore {
  readonly metric: "sales-log-error" | "cni-roe-point-error";
  readonly periodEnd: string;
  /** Years after the snapshot's cutoff. */
  readonly horizon: number;
  readonly model: number;
  /** The same error for "the cutoff year again", from the same filings. */
  readonly randomWalk: number;
}

/**
 * Score a frozen forecast against results the company later filed, before any
 * of them reached the library: the out-of-sample test the walk-forward can only
 * approximate (Capitaline serves restated history). Model, benchmark and
 * actuals all come from first filings, so they share one basis.
 *
 * Only years after the snapshot's `latestReportedPeriod` are scored: a forecast
 * from an anchor that walked back was built on data that included the years
 * between, so scoring those would be look-ahead. A snapshot of a business the
 * filings do not describe (a lending arm carved out; standalone accounts beside
 * a consolidated ledger) is not scored.
 *
 * Sales are compared net of itemized excise, as Capitaline's are. Forecast CNI
 * is compared with owners' profit (OCI aside), in points of the opening year's
 * filed owners' equity.
 */
export function scoreSnapshotAgainstFilings(
  snapshot: ForecastSnapshot & { readonly latestReportedPeriod?: string | undefined },
  filings: readonly FiledYear[],
): { readonly scores: FiledScore[]; readonly skipped: string | null } {
  const basis = (snapshot as Partial<ForecastSnapshot>).basis;
  if (basis?.lendingArm) {
    return { scores: [], skipped: `a forecast of the business without ${basis.lendingArm}; the consolidated filings describe another business` };
  }
  if (basis?.accounts === "standalone") {
    return { scores: [], skipped: "a forecast on standalone accounts; the ledger is consolidated" };
  }
  const filed = (end: string) => filings.find((f) => f.fiscalYearEnd === end) ?? null;
  const netRevenue = (f: FiledYear | null) => (f?.revenue != null ? f.revenue - (f.exciseDuty ?? 0) : null);
  const cutoff = filed(snapshot.cutoffPeriod);
  if (!cutoff) return { scores: [], skipped: `no filing for the cutoff year ${snapshot.cutoffPeriod}` };
  const seenThrough = snapshot.latestReportedPeriod ?? snapshot.cutoffPeriod;
  const scores: FiledScore[] = [];
  snapshot.years.forEach((year, i) => {
    if (year.periodEnd <= seenThrough) return;
    const actual = filed(year.periodEnd);
    const opening = filed(i === 0 ? snapshot.cutoffPeriod : snapshot.years[i - 1]!.periodEnd);
    if (!actual) return;
    const sales = netRevenue(actual);
    const cutoffSales = netRevenue(cutoff);
    if (sales != null && sales > 0 && cutoffSales != null && cutoffSales > 0 && year.sales > 0) {
      scores.push({ metric: "sales-log-error", periodEnd: year.periodEnd, horizon: i + 1, model: Math.log(year.sales / sales), randomWalk: Math.log(cutoffSales / sales) });
    }
    const profit = actual.profitAttributableToOwners;
    const scale = opening?.equityAttributableToOwners ?? null;
    const cutoffProfit = cutoff.profitAttributableToOwners;
    if (profit != null && cutoffProfit != null && scale != null && scale > 0) {
      scores.push({ metric: "cni-roe-point-error", periodEnd: year.periodEnd, horizon: i + 1, model: (year.cni - profit) / scale, randomWalk: (cutoffProfit - profit) / scale });
    }
  });
  return { scores, skipped: null };
}
