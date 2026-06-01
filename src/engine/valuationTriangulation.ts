import type { CashFlowDcfResult } from "./cashFlowDcf";
import type { EvEbitdaCrossCheck } from "./evEbitdaCrossCheck";
import type { ValuationScenarioCard } from "./valuationCommandCenter/types";
import type { ValuationTriangulationEvidence } from "./reconciliationResiduals";

function median(values: Array<number | null | undefined>): number | null {
  const finite = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0
    ? (finite[mid - 1]! + finite[mid]!) / 2
    : finite[mid]!;
}

/**
 * Build the light-weight method evidence consumed by the rigor ladder's
 * valuation-triangulation residual. This deliberately keeps each paradigm
 * separate; it does NOT blend the values back into a median headline.
 */
export function buildValuationTriangulationEvidence(params: {
  scenarios: ValuationScenarioCard[];
  cashFlowDcf?: CashFlowDcfResult | null | undefined;
  evEbitda?: EvEbitdaCrossCheck | null | undefined;
  shares?: number | null | undefined;
  periodEnd?: string | null | undefined;
}): ValuationTriangulationEvidence {
  const base = params.scenarios.find((scenario) => scenario.key === "base") ?? null;
  const accrualRivPerShare = median([
    base?.valuation.perShare?.intrinsic_re_per_share ?? null,
    base?.valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ]);
  const relativePerShare = params.evEbitda?.equityFromMedian != null
    && params.shares != null
    && params.shares > 0
    ? params.evEbitda.equityFromMedian / params.shares
    : null;

  return {
    periodEnd: params.periodEnd ?? null,
    methods: [
      {
        key: "accrual-riv",
        label: "Accrual RIV/ReOI",
        perShare: accrualRivPerShare,
      },
      {
        key: "cash-fcff-dcf",
        label: "Cash-statement FCFF DCF",
        perShare: params.cashFlowDcf?.perShare ?? null,
      },
      {
        key: "relative-ev-ebitda",
        label: "Relative EV/EBITDA",
        perShare: relativePerShare,
      },
    ],
  };
}
