/**
 * Forecasting Engine — V2
 * §4.3 Pro Forma, Fade Analysis, Scenario Analysis
 * Nissim & Penman (2001) §2.6, Table 3
 */
import { RecastPeriod, ForecastPeriod, ForecastScenario, FADE_PARAMS, NP_BENCHMARKS } from "./types";

/* §4.3.1 Fade-adjusted single ratio forecast */
export function fadeRatio(
  historicalValue: number,
  ratioKey: keyof typeof FADE_PARAMS,
  horizonT: number,
  industryMedian?: number,
): number[] {
  const alpha = FADE_PARAMS[ratioKey] ?? 0.85;
  const target = industryMedian ?? (NP_BENCHMARKS[ratioKey]?.median ?? historicalValue);
  const result: number[] = [];
  let prev = historicalValue;
  for (let t = 1; t <= horizonT; t++) {
    const next = alpha * prev + (1 - alpha) * target;
    result.push(next);
    prev = next;
  }
  return result;
}

/* §4.3.2 Pro Forma Period Builder — propagates accounting identities */
export function buildForecastPeriod(
  yearOffset: number,
  baseYear: string,
  prevForecast: { Sales_f: number; NOA_f: number; CSE_f: number; NFO_f: number },
  drivers: {
    sales_growth: number;
    core_sales_pm: number;
    ato: number;
    flev: number;
    nbc: number;
  },
  ke: number, kw: number,
  source: ForecastPeriod["source"],
): ForecastPeriod {
  const fyYear = parseInt(baseYear.slice(0, 4)) + yearOffset;
  const period_label = `FY${fyYear}E`;

  const Sales_f = prevForecast.Sales_f * (1 + drivers.sales_growth);
  const NOA_f   = drivers.ato > 0 ? Sales_f / drivers.ato : prevForecast.NOA_f;
  const ΔNOA_f  = NOA_f - prevForecast.NOA_f;
  const OI_f    = drivers.core_sales_pm * Sales_f;
  const FCF_f   = OI_f - ΔNOA_f;
  const CSE_f   = drivers.flev > -1 ? NOA_f / (1 + drivers.flev) : NOA_f;
  const NFO_f   = NOA_f - CSE_f;
  const NFE_f   = drivers.nbc * (prevForecast.NFO_f + NFO_f) / 2;
  const CNI_f   = OI_f - NFE_f;
  const RE_f    = CNI_f - ke * prevForecast.CSE_f;
  const ReOI_f  = OI_f - kw * prevForecast.NOA_f;

  return {
    year_offset: yearOffset,
    period_label,
    sales_growth_assumption: drivers.sales_growth,
    core_sales_pm_assumption: drivers.core_sales_pm,
    ato_assumption: drivers.ato,
    flev_assumption: drivers.flev,
    nbc_assumption: drivers.nbc,
    Sales_f, NOA_f, OI_f, NFE_f, CNI_f, CSE_f, NFO_f, ΔNOA_f, FCF_f, RE_f, ReOI_f,
    source,
  };
}

/* §4.3.3 Full Scenario — build all periods */
export function buildScenario(
  scenario: ForecastScenario,
  latestPeriod: RecastPeriod,
): ForecastPeriod[] {
  const periods: ForecastPeriod[] = [];
  let prev = {
    Sales_f: latestPeriod.is.Sales,
    NOA_f:   latestPeriod.bs.NOA,
    CSE_f:   latestPeriod.bs.CSE,
    NFO_f:   latestPeriod.bs.NFO,
  };
  const d = scenario.drivers;
  const baseYear = latestPeriod.period_end;

  for (let t = 1; t <= scenario.horizonT; t++) {
    const idx = Math.min(t - 1, d.sales_growth.length - 1);
    const fp = buildForecastPeriod(
      t, baseYear, prev,
      {
        sales_growth:    d.sales_growth[idx]    ?? d.sales_growth[d.sales_growth.length - 1],
        core_sales_pm:   d.core_sales_pm[idx]   ?? d.core_sales_pm[d.core_sales_pm.length - 1],
        ato:             d.ato[idx]              ?? d.ato[d.ato.length - 1],
        flev:            d.flev[idx]             ?? d.flev[d.flev.length - 1],
        nbc:             d.nbc[idx]              ?? d.nbc[d.nbc.length - 1],
      },
      d.ke, d.kw,
      'fade',
    );
    periods.push(fp);
    prev = { Sales_f: fp.Sales_f, NOA_f: fp.NOA_f, CSE_f: fp.CSE_f, NFO_f: fp.NFO_f };
  }
  return periods;
}

/* §4.3.3 Expected value across scenarios */
export function expectedValue(
  scenarios: ForecastScenario[],
  method: 'V_RE_CV3' | 'V_ReOI_CV03',
): number | null {
  let ev = 0, totalProb = 0;
  for (const sc of scenarios) {
    if (!sc.valuationResult) continue;
    const v = sc.valuationResult[method];
    if (v === undefined) continue;
    ev += sc.probability * v;
    totalProb += sc.probability;
  }
  return totalProb > 0 ? ev / totalProb : null;
}

/* §4.3.4 Sensitivity — vary one parameter ±20% */
export type SensParam = 'ke'|'kw'|'g'|'core_pm'|'ato'|'sales_growth';

export interface SensResult {
  param: SensParam;
  label: string;
  low: number;
  base: number;
  high: number;
  impact: number; // high - low
}

export function sensitivityAnalysis(
  baseV: number,
  params: Record<SensParam, number>,
  computeFn: (p: Record<SensParam, number>) => number,
): SensResult[] {
  const results: SensResult[] = [];
  for (const [param, baseVal] of Object.entries(params) as [SensParam, number][]) {
    const delta = baseVal !== 0 ? Math.abs(baseVal) * 0.20 : 0.005;
    const pLow  = { ...params, [param]: baseVal - delta };
    const pHigh = { ...params, [param]: baseVal + delta };
    const vLow  = computeFn(pLow);
    const vHigh = computeFn(pHigh);
    const LABELS: Record<SensParam, string> = {
      ke: 'Cost of Equity (ke)',
      kw: 'WACC (kw)',
      g:  'Terminal Growth (g)',
      core_pm: 'Core Sales PM',
      ato: 'Asset Turnover',
      sales_growth: 'Sales Growth',
    };
    results.push({ param, label: LABELS[param], low: vLow, base: baseV, high: vHigh, impact: Math.abs(vHigh - vLow) });
  }
  return results.sort((a, b) => b.impact - a.impact);
}
