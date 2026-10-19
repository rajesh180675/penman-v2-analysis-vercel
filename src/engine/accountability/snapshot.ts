/**
 * The forecast ledger: a forecast frozen on the day it was made, to be scored
 * when the years it predicts are reported.
 *
 * Walk-forward backtests re-run the model over old cutoffs, which can only
 * approximate what was knowable (restated data leaks in). A frozen snapshot is
 * the honest counterpart: written once, never regenerated, scored later.
 */
import type { ForecastPeriod, RecastPeriod } from "../types";
import { headlineInconsistencies } from "../filings/tieOut";
import type { AnnualHeadline } from "../filings/xbrlInstance";
import { filedCoreOperatingIncome } from "./filedCoreIncome";
import { placeInBand, type BandPosition } from "./scenarioBands";
import { scoreForecast } from "./walkForward";
import type { ScoredObservation } from "./types";

/**
 * v4 (2026-10-19): `scenarios` records the stress, bull and historical-panic
 * paths beside the base, so the bands, calibrated on the walk-forward
 * (scenarioBands.ts), can be tested against results filed after the freeze.
 * v3 (2026-10-19): `anchor` records the cutoff year as the forecast saw it, so
 * its margin can be scored as a move from there (scoreSnapshotAgainstFilings).
 * v2 (2026-10-11): the forecast is the app's own run's, and `basis` records the
 * business it forecasts. v1 snapshots were made by the accountability runner's
 * own copy of the run: always the consolidated statements, with no lending arm
 * carved out (the standalone accounts where consolidated history is short).
 */
export const FORECAST_SNAPSHOT_SCHEMA_VERSION = "2026-10-forecast-snapshot-v4" as const;

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
  /** The cutoff year's recast, on the basis the forecast was made from. */
  readonly anchor: SnapshotYear;
  readonly years: readonly SnapshotYear[];
  /** The run's other scenario cases, year by year as `years`. */
  readonly scenarios: SnapshotScenarios;
  /** Equity value per share at freeze, when a share basis resolved. */
  readonly intrinsicPerShare: number | null;
}

/** One year of a frozen forecast, or its anchor: operating income is core, after tax. */
export interface SnapshotYear {
  readonly periodEnd: string;
  readonly sales: number;
  readonly operatingIncome: number;
  readonly noa: number;
  readonly cni: number;
  readonly cse: number;
}

export interface SnapshotScenarios {
  readonly stress: readonly SnapshotYear[];
  readonly bull: readonly SnapshotYear[];
  readonly historicalPanic: readonly SnapshotYear[];
}

export function buildForecastSnapshot(input: {
  ticker: string;
  companyType: string;
  madeAt: string;
  cutoff: RecastPeriod;
  basis: ForecastSnapshotBasis;
  forecast: readonly ForecastPeriod[];
  scenarios: { readonly [K in keyof SnapshotScenarios]: readonly ForecastPeriod[] };
  assumptions: { ke: number; kw: number; g: number };
  intrinsicPerShare: number | null;
}): ForecastSnapshot {
  return {
    schemaVersion: FORECAST_SNAPSHOT_SCHEMA_VERSION,
    ticker: input.ticker,
    companyType: input.companyType,
    madeAt: input.madeAt,
    cutoffPeriod: input.cutoff.period_end,
    model: "command-center-base",
    basis: input.basis,
    assumptions: input.assumptions,
    anchor: anchorYear(input.cutoff),
    years: forecastYears(input.cutoff.period_end, input.forecast),
    scenarios: {
      stress: forecastYears(input.cutoff.period_end, input.scenarios.stress),
      bull: forecastYears(input.cutoff.period_end, input.scenarios.bull),
      historicalPanic: forecastYears(input.cutoff.period_end, input.scenarios.historicalPanic),
    },
    intrinsicPerShare: input.intrinsicPerShare,
  };
}

/** The year a forecast starts from, on the fields each forecast year records. */
export function anchorYear(cutoff: {
  readonly period_end: string;
  readonly is: Pick<RecastPeriod["is"], "Sales" | "OI" | "CNI">;
  readonly bs: Pick<RecastPeriod["bs"], "NOA" | "CSE">;
  readonly cu?: Pick<RecastPeriod["cu"], "CoreOI"> | undefined;
}): SnapshotYear {
  return {
    periodEnd: cutoff.period_end,
    sales: cutoff.is.Sales,
    operatingIncome: cutoff.cu?.CoreOI ?? cutoff.is.OI,
    noa: cutoff.bs.NOA,
    cni: cutoff.is.CNI,
    cse: cutoff.bs.CSE,
  };
}

/** A forecast's years, each dated a fiscal year after the one before, from the cutoff. */
export function forecastYears(cutoffPeriod: string, forecast: readonly ForecastPeriod[]): ForecastSnapshot["years"] {
  const baseYear = Number(cutoffPeriod.slice(0, 4));
  const suffix = cutoffPeriod.slice(4);
  return forecast.map((f, i) => ({
    periodEnd: `${baseYear + i + 1}${suffix}`,
    sales: f.Sales_f,
    operatingIncome: f.OI_f,
    noa: f.NOA_f,
    cni: f.CNI_f,
    cse: f.CSE_f,
  }));
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
  /** Revenue from operations as filed: gross of the excise duty it itemizes. */
  readonly revenue: number | null;
  readonly exciseDuty?: number | null | undefined;
  readonly profitAttributableToOwners: number | null;
  readonly equityAttributableToOwners: number | null;
  /** Core operating income after tax, from the filed lines (filedCoreIncome.ts); null where they are not on record. */
  readonly coreOperatingIncome?: number | null | undefined;
}

/**
 * Each fiscal year as first filed: the figure as originally reported, before
 * any revision filed later (data/filings/<SYMBOL>/as-filed.json records).
 */
export function firstFiledYears(records: readonly {
  readonly fiscalYearEnd: string;
  readonly filingDate: string;
  /** Fields a record was extracted before are absent. */
  readonly headline: Partial<AnnualHeadline> & Pick<AnnualHeadline, "revenue" | "profitAttributableToOwners" | "equityAttributableToOwners">;
}[]): FiledYear[] {
  const first = new Map<string, (typeof records)[number]>();
  for (const r of [...records].sort((a, b) => a.filingDate.localeCompare(b.filingDate))) {
    if (!first.has(r.fiscalYearEnd)) first.set(r.fiscalYearEnd, r);
  }
  const years = [...first.values()].sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd));
  // A filing that contradicts itself on profit has a tax line that cannot be
  // trusted either (Asian Paints FY2022: a ₹4,980 Cr credit its accounts do not have).
  const coreOperatingIncome = filedCoreOperatingIncome(years.map((r) =>
    headlineInconsistencies(r.headline).has("profitAfterTax") ? { ...r.headline, expenses: null, taxExpense: null } : r.headline));
  return years.map((r, i) => ({
    fiscalYearEnd: r.fiscalYearEnd,
    revenue: r.headline.revenue,
    exciseDuty: r.headline.exciseDuty ?? null,
    profitAttributableToOwners: r.headline.profitAttributableToOwners,
    equityAttributableToOwners: r.headline.equityAttributableToOwners,
    coreOperatingIncome: coreOperatingIncome[i]!,
  }));
}

export interface FiledScore {
  readonly metric: "sales-log-error" | "core-margin-point-error" | "cni-roe-point-error";
  readonly periodEnd: string;
  /** Years after the snapshot's cutoff. */
  readonly horizon: number;
  /**
   * Sales and CNI in ₹ crore, beside the filed net revenue or owners' profit.
   * The core margin as a fraction of sales: the forecast's restated on the
   * filed basis (the cutoff year's filed margin, moved as the forecast moved
   * its own), beside the filed margin.
   */
  readonly forecast: number;
  readonly actual: number;
  readonly model: number;
  /** The same error for "the cutoff year again", from the same filings. */
  readonly randomWalk: number;
  /**
   * The stress, bull and historical-panic cases on the basis of `forecast`,
   * and where the filed figure fell against stress and bull. Absent where the
   * forecast records no scenarios (snapshots before v4).
   */
  readonly band?: {
    readonly stress: number;
    readonly bull: number;
    readonly historicalPanic: number;
    readonly position: BandPosition;
  } | undefined;
}

/** What scoreSnapshotAgainstFilings reads: a frozen snapshot, or a run's base forecast. */
export interface ForecastToScore {
  readonly cutoffPeriod: string;
  /** The last period the forecast's data reached: later than the cutoff when the anchor walked back. */
  readonly latestReportedPeriod?: string | undefined;
  /** Absent on v1 snapshots. */
  readonly basis?: ForecastSnapshotBasis | undefined;
  /** The cutoff year the forecast started from; absent on v1 and v2 snapshots, whose margin is not scored. */
  readonly anchor?: Pick<SnapshotYear, "sales" | "operatingIncome"> | undefined;
  readonly years: ForecastSnapshot["years"];
  /** Absent before v4 snapshots, whose filed years are not placed in a band. */
  readonly scenarios?: SnapshotScenarios | undefined;
}

/**
 * Score a frozen forecast against results the company filed after its data
 * ended, before they reached the library: the out-of-sample test the walk-forward can only
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
 *
 * The core margin is scored as a move from the cutoff year: the forecast's
 * margin less its anchor's, against the filed margin less the cutoff year's
 * filed margin. The recast and the filings measure the margin's level a few
 * tenths of a point apart (filedCoreIncome.ts), and that gap cancels in a
 * move; a level comparison would charge it to the forecast and not to the
 * random walk, which is all filed. Only a forecast that records its anchor
 * (snapshots from v3, the app's own run) is scored on it.
 *
 * Where the forecast records its other scenarios (v4), each filed figure is
 * also placed against the stress and bull cases on the same basis, matched by
 * fiscal year, as the walk-forward band report places Capitaline's.
 */
export function scoreSnapshotAgainstFilings(
  snapshot: ForecastToScore,
  filings: readonly FiledYear[],
): { readonly scores: FiledScore[]; readonly skipped: string | null } {
  const basis = snapshot.basis;
  if (basis?.lendingArm) {
    return { scores: [], skipped: `a forecast of the business without ${basis.lendingArm}; the consolidated filings describe another business` };
  }
  if (basis?.accounts === "standalone") {
    return { scores: [], skipped: "a forecast on standalone accounts; the ledger is consolidated" };
  }
  const filed = (end: string) => filings.find((f) => f.fiscalYearEnd === end) ?? null;
  const netRevenue = (f: FiledYear | null) => (f?.revenue != null ? f.revenue - (f.exciseDuty ?? 0) : null);
  const filedMargin = (f: FiledYear | null) => {
    const sales = netRevenue(f);
    return f?.coreOperatingIncome != null && sales != null && sales > 0 ? f.coreOperatingIncome / sales : null;
  };
  const cutoff = filed(snapshot.cutoffPeriod);
  if (!cutoff) return { scores: [], skipped: `no filing for the cutoff year ${snapshot.cutoffPeriod}` };
  const anchor = snapshot.anchor;
  const anchorMargin = anchor && anchor.sales > 0 ? anchor.operatingIncome / anchor.sales : null;
  const cutoffMargin = filedMargin(cutoff);
  const seenThrough = snapshot.latestReportedPeriod ?? snapshot.cutoffPeriod;
  const scores: FiledScore[] = [];
  snapshot.years.forEach((year, i) => {
    if (year.periodEnd <= seenThrough) return;
    const actual = filed(year.periodEnd);
    const opening = filed(i === 0 ? snapshot.cutoffPeriod : snapshot.years[i - 1]!.periodEnd);
    if (!actual) return;
    const band = (filedValue: number, value: (scenario: SnapshotYear) => number | null): Pick<FiledScore, "band"> => {
      const [stress, bull, historicalPanic] = (["stress", "bull", "historicalPanic"] as const).map((key) => {
        const scenario = snapshot.scenarios?.[key].find((y) => y.periodEnd === year.periodEnd);
        return scenario ? value(scenario) : null;
      });
      return stress != null && bull != null && historicalPanic != null && [stress, bull, historicalPanic].every(Number.isFinite)
        ? { band: { stress, bull, historicalPanic, position: placeInBand(filedValue, stress, bull) } }
        : {};
    };
    const sales = netRevenue(actual);
    const cutoffSales = netRevenue(cutoff);
    if (sales != null && sales > 0 && cutoffSales != null && cutoffSales > 0 && year.sales > 0) {
      scores.push({ metric: "sales-log-error", periodEnd: year.periodEnd, horizon: i + 1, forecast: year.sales, actual: sales, model: Math.log(year.sales / sales), randomWalk: Math.log(cutoffSales / sales), ...band(sales, (y) => y.sales) });
    }
    const margin = filedMargin(actual);
    if (margin != null && cutoffMargin != null && anchorMargin != null && year.sales > 0) {
      const onFiledBasis = (y: SnapshotYear) => (y.sales > 0 ? cutoffMargin + (y.operatingIncome / y.sales - anchorMargin) : null);
      const forecast = onFiledBasis(year)!;
      scores.push({ metric: "core-margin-point-error", periodEnd: year.periodEnd, horizon: i + 1, forecast, actual: margin, model: forecast - margin, randomWalk: cutoffMargin - margin, ...band(margin, onFiledBasis) });
    }
    const profit = actual.profitAttributableToOwners;
    const scale = opening?.equityAttributableToOwners ?? null;
    const cutoffProfit = cutoff.profitAttributableToOwners;
    if (profit != null && cutoffProfit != null && scale != null && scale > 0) {
      scores.push({ metric: "cni-roe-point-error", periodEnd: year.periodEnd, horizon: i + 1, forecast: year.cni, actual: profit, model: (year.cni - profit) / scale, randomWalk: (cutoffProfit - profit) / scale, ...band(profit, (y) => y.cni) });
    }
  });
  return { scores, skipped: null };
}
