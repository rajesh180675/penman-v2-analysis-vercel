import type { ReverseDcfDiagnostics } from "../valuationCommandCenter";
import type { MarketImpliedExpectationLedger, MarketImpliedExpectationRow } from "./types";

const IMPLIED_GROWTH_CAP = 0.40;
const IMPLIED_TERMINAL_ROIC_CAP = 0.80;
const IMPLIED_KE_LOW_CAP = 0.06;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function interpretation(args: {
  value: number | null;
  cap?: number | null | undefined;
  saturated: boolean;
  comparisonAnchor: number | null;
}): MarketImpliedExpectationRow["interpretation"] {
  const { value, cap, saturated, comparisonAnchor } = args;
  if (value == null) return "unavailable";
  if (saturated) return "model_saturated";
  if (cap != null && value >= cap * 0.85) return "priced_for_perfection";
  if (comparisonAnchor != null && value > comparisonAnchor * 1.5) return "optimistic";
  return "reasonable";
}

function row(args: {
  key: MarketImpliedExpectationRow["key"];
  value: number | null | undefined;
  cap?: number | null | undefined;
  comparisonAnchor: number | null;
  saturated?: boolean | undefined;
}): MarketImpliedExpectationRow {
  const value = finiteOrNull(args.value);
  const saturated = Boolean(args.saturated ?? (value != null && args.cap != null && value >= args.cap - 1e-9));
  const gap = value != null && args.comparisonAnchor != null ? value - args.comparisonAnchor : null;
  return {
    key: args.key,
    value,
    cap: args.cap ?? null,
    saturated,
    comparisonAnchor: args.comparisonAnchor,
    gap,
    priceDerived: true,
    interpretation: interpretation({ value, cap: args.cap ?? null, saturated, comparisonAnchor: args.comparisonAnchor }),
  };
}

export function buildMarketImpliedExpectationLedger(args: {
  marketPrice: number | null;
  asOf: string | null;
  reverseDcf: ReverseDcfDiagnostics | null | undefined;
}): MarketImpliedExpectationLedger {
  const reverseDcf = args.reverseDcf ?? null;
  const rows: MarketImpliedExpectationRow[] = reverseDcf
    ? [
      row({
        key: "implied_growth",
        value: reverseDcf.impliedOwnerEarningsGrowth,
        cap: IMPLIED_GROWTH_CAP,
        comparisonAnchor: reverseDcf.normalizedGrowthAnchor,
      }),
      row({
        key: "implied_terminal_roic",
        value: reverseDcf.impliedTerminalROIC,
        cap: IMPLIED_TERMINAL_ROIC_CAP,
        comparisonAnchor: reverseDcf.normalizedGrowthAnchor,
      }),
      row({
        key: "implied_ke",
        value: reverseDcf.impliedKE,
        cap: IMPLIED_KE_LOW_CAP,
        comparisonAnchor: null,
        saturated: reverseDcf.impliedKE != null && reverseDcf.impliedKE <= IMPLIED_KE_LOW_CAP,
      }),
    ]
    : [
      row({ key: "implied_growth", value: null, cap: IMPLIED_GROWTH_CAP, comparisonAnchor: null }),
      row({ key: "implied_terminal_roic", value: null, cap: IMPLIED_TERMINAL_ROIC_CAP, comparisonAnchor: null }),
      row({ key: "implied_ke", value: null, cap: IMPLIED_KE_LOW_CAP, comparisonAnchor: null }),
    ];

  const saturated = rows.some((item) => item.saturated);
  return {
    marketPrice: args.marketPrice,
    asOf: args.asOf,
    rows,
    intrinsicConfidenceEffect: "none",
    warning: saturated
      ? "Current price implies expectations beyond model caps; this is a bounded diagnostic and does not validate intrinsic value."
      : "Reverse DCF explains market-implied expectations; it does not validate intrinsic value or raise intrinsic confidence.",
  };
}
