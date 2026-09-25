/**
 * Walk-forward backtest of the app's own forecast.
 *
 * For each cutoff t with enough history: forecast from history[..t] exactly as
 * the Valuation tab does (buildAnchoredForecast), then score years t+1…t+H
 * against what the later periods actually report, beside two naive
 * benchmarks computed from the same truncated history.
 *
 * Caveat stated wherever results are shown: Capitaline serves the latest
 * restated figures, not what was known at the time, so a cutoff can see
 * restatements of its own history. That is a look-ahead the planned
 * point-in-time filings ledger removes; until then results are optimistic
 * to the extent restatements were informative.
 */
import { buildAnchoredForecast } from "../anchoredValuationPeriods";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import { deriveKwFromStructure } from "../PenmanNissimEngine";
import type { EngineConfig, ForecastPeriod, RecastPeriod } from "../types";
import {
  ACCOUNTABILITY_SCHEMA_VERSION,
  type CompanyWalkForward,
  type ForecastOrigin,
  type ScoredObservation,
} from "./types";

export const MIN_HISTORY_FOR_ORIGIN = 5;
export const DEFAULT_MAX_HORIZON = 3;
const TERMINAL_GROWTH = 0.04;
/** Below this NOA/sales, RNOA is a ratio to a near-zero base, not a return. */
export const MIN_NOA_TO_SALES = 0.1;

const yearOf = (period: RecastPeriod | string) => Number((typeof period === "string" ? period : period.period_end).slice(0, 4));

/** Core RNOA on OPENING NOA — the same basis for forecast and actual. */
function coreRnoa(coreOI: number, openingNoa: number): number | null {
  return openingNoa > 0 && Number.isFinite(coreOI) ? coreOI / openingNoa : null;
}

const coreOIOf = (period: RecastPeriod) => period.cu?.CoreOI ?? period.is.OI;

function trailingSalesCagr(history: readonly RecastPeriod[]): number | null {
  const n = history.length;
  if (n < 4) return null;
  const first = history[n - 4]!.is.Sales;
  const last = history[n - 1]!.is.Sales;
  return first > 0 && last > 0 ? (last / first) ** (1 / 3) - 1 : null;
}

function trailingMeanRnoa(history: readonly RecastPeriod[]): number | null {
  const values: number[] = [];
  for (let i = Math.max(1, history.length - 3); i < history.length; i++) {
    const value = coreRnoa(coreOIOf(history[i]!), history[i - 1]!.bs.NOA);
    if (value != null) values.push(value);
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Score one forecast against the actual periods that follow the cutoff.
 * Pure: forecast periods in, observations out.
 */
export function scoreForecast(
  history: readonly RecastPeriod[],
  forecast: readonly ForecastPeriod[],
  future: readonly RecastPeriod[],
  maxHorizon = DEFAULT_MAX_HORIZON,
): ScoredObservation[] {
  const cutoff = history[history.length - 1]!;
  const cutoffYear = yearOf(cutoff);
  const cagr = trailingSalesCagr(history);
  const meanRnoa = trailingMeanRnoa(history);
  const lastRnoa = history.length >= 2 ? coreRnoa(coreOIOf(cutoff), history[history.length - 2]!.bs.NOA) : null;
  const observations: ScoredObservation[] = [];

  for (let h = 1; h <= Math.min(maxHorizon, forecast.length); h++) {
    // Match by fiscal year, never by position: a missing year must not
    // silently pair a forecast with the wrong actual.
    const actual = future.find((period) => yearOf(period) === cutoffYear + h);
    const actualOpening = future.find((period) => yearOf(period) === cutoffYear + h - 1) ?? (h === 1 ? cutoff : undefined);
    if (!actual || !actualOpening) continue;
    const predicted = forecast[h - 1]!;
    const forecastOpeningNoa = h === 1 ? cutoff.bs.NOA : forecast[h - 2]!.NOA_f;

    // Sales, as a log error.
    if (predicted.Sales_f > 0 && actual.is.Sales > 0 && cutoff.is.Sales > 0) {
      const rw = cutoff.is.Sales;
      const trend = cagr != null ? cutoff.is.Sales * (1 + cagr) ** h : rw;
      observations.push({
        metric: "sales-log-error",
        horizon: h,
        model: Math.log(predicted.Sales_f / actual.is.Sales),
        naive: {
          "random-walk": Math.log(rw / actual.is.Sales),
          "trailing-trend": Math.log(trend / actual.is.Sales),
        },
      });
    }

    // Core operating margin, as OI error over actual sales — never a
    // near-zero denominator.
    if (actual.is.Sales > 0 && Number.isFinite(coreOIOf(actual))) {
      const actualOI = coreOIOf(actual);
      const trendOI = cagr != null ? coreOIOf(cutoff) * (1 + cagr) ** h : coreOIOf(cutoff);
      observations.push({
        metric: "core-oi-margin-error",
        horizon: h,
        model: (predicted.OI_f - actualOI) / actual.is.Sales,
        naive: {
          "random-walk": (coreOIOf(cutoff) - actualOI) / actual.is.Sales,
          "trailing-trend": (trendOI - actualOI) / actual.is.Sales,
        },
      });
    }

    // Core RNOA on opening NOA — only on an economically meaningful base.
    const actualRnoa = coreRnoa(coreOIOf(actual), actualOpening.bs.NOA);
    const modelRnoa = coreRnoa(predicted.OI_f, forecastOpeningNoa);
    const openingSales = h === 1 ? cutoff.is.Sales : forecast[h - 2]!.Sales_f;
    const meaningfulBase = actualOpening.bs.NOA >= MIN_NOA_TO_SALES * actualOpening.is.Sales
      && forecastOpeningNoa >= MIN_NOA_TO_SALES * openingSales;
    if (meaningfulBase && actualRnoa != null && modelRnoa != null && lastRnoa != null) {
      observations.push({
        metric: "core-rnoa-error",
        horizon: h,
        model: modelRnoa - actualRnoa,
        naive: {
          "random-walk": lastRnoa - actualRnoa,
          "trailing-trend": (meanRnoa ?? lastRnoa) - actualRnoa,
        },
      });
    }

    // CNI, scaled by actual opening equity: an ROE-point error.
    const scale = actualOpening.bs.CSE;
    if (scale > 0 && Number.isFinite(actual.is.CNI)) {
      const trendCni = cagr != null ? cutoff.is.CNI * (1 + cagr) ** h : cutoff.is.CNI;
      observations.push({
        metric: "cni-roe-point-error",
        horizon: h,
        model: (predicted.CNI_f - actual.is.CNI) / scale,
        naive: {
          "random-walk": (cutoff.is.CNI - actual.is.CNI) / scale,
          "trailing-trend": (trendCni - actual.is.CNI) / scale,
        },
      });
    }
  }
  return observations;
}

export interface WalkForwardOptions {
  readonly ticker: string;
  readonly companyType: string;
  readonly maxHorizon?: number | undefined;
  readonly minHistory?: number | undefined;
}

/** Run every admissible cutoff for one company. */
export function walkForwardCompany(
  periods: readonly RecastPeriod[],
  config: EngineConfig,
  options: WalkForwardOptions,
): CompanyWalkForward {
  const minHistory = options.minHistory ?? MIN_HISTORY_FOR_ORIGIN;
  const maxHorizon = options.maxHorizon ?? DEFAULT_MAX_HORIZON;
  const sorted = [...periods].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const origins: ForecastOrigin[] = [];
  const skipped: { cutoffPeriod: string; reason: string }[] = [];

  // The last cutoff needs at least one later period to score against.
  for (let cut = minHistory - 1; cut < sorted.length - 1; cut++) {
    const history = sorted.slice(0, cut + 1);
    const future = sorted.slice(cut + 1);
    const cutoff = history[history.length - 1]!;
    try {
      // Point-in-time capital costs: config defaults, not today's dated packs.
      const ke = resolveCostOfCapitalFromConfig({ config, current: cutoff, previous: history[history.length - 2] ?? null }).ke;
      const kw = deriveKwFromStructure(cutoff, history[history.length - 2]!, ke, config.risk_free_rate, config);
      const { periods: forecast } = buildAnchoredForecast({
        history,
        config,
        ke,
        kw,
        g: Math.min(TERMINAL_GROWTH, ke - 0.01),
        horizon: Math.max(maxHorizon, 5),
      });
      const observations = scoreForecast(history, forecast, future, maxHorizon);
      if (observations.length) origins.push({ cutoffPeriod: cutoff.period_end, historyLength: history.length, observations });
      else skipped.push({ cutoffPeriod: cutoff.period_end, reason: "no scorable actuals after the cutoff" });
    } catch (error) {
      skipped.push({ cutoffPeriod: cutoff.period_end, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
    ticker: options.ticker,
    companyType: options.companyType,
    origins,
    skipped,
  };
}

