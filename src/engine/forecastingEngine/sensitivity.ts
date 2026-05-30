import { ForecastScenario } from "../types";

export function applyDriverSensitivityToScenario(
  scenario: ForecastScenario,
  baseDrivers: Pick<Record<SensParam, number>, "core_pm" | "ato" | "sales_growth">,
  targetDrivers: Pick<Record<SensParam, number>, "core_pm" | "ato" | "sales_growth">,
): ForecastScenario {
  const scale = (target: number, base: number) => (base !== 0 ? target / base : 1);
  const pmScale = scale(targetDrivers.core_pm, baseDrivers.core_pm);
  const atoScale = scale(targetDrivers.ato, baseDrivers.ato);
  const salesScale = scale(targetDrivers.sales_growth, baseDrivers.sales_growth);

  return {
    ...scenario,
    drivers: {
      ...scenario.drivers,
      core_sales_pm: scenario.drivers.core_sales_pm.map((v) => v * pmScale),
      ato: scenario.drivers.ato.map((v) => v * atoScale),
      sales_growth: scenario.drivers.sales_growth.map((v) => v * salesScale),
      material_cost_ratio: scenario.drivers.material_cost_ratio?.map((v) => v / Math.max(pmScale, 1e-6)),
      employee_cost_ratio: scenario.drivers.employee_cost_ratio,
      depreciation_ratio: scenario.drivers.depreciation_ratio,
      sga_ratio: scenario.drivers.sga_ratio?.map((v) => v / Math.max(pmScale, 1e-6)),
      other_opex_ratio: scenario.drivers.other_opex_ratio?.map((v) => v / Math.max(pmScale, 1e-6)),
      other_operating_income_ratio: scenario.drivers.other_operating_income_ratio?.map((v) => v * Math.max(pmScale, 1)),
    },
  };
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
    if (v == null) continue;
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
