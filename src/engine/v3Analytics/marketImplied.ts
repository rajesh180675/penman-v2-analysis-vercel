/* ══════════════════════════════════════════════════════════════════
   §16.2 Market-implied analytics (intrinsic/share, implied g, implied ke)
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ../types and ./shared only — no back-edge to v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { RecastPeriod } from "../types";
import { CanonicalOutputRegistry } from "./shared";

export interface MarketImpliedResult {
  status: "full" | "market_price_required" | "shares_unavailable";
  intrinsic_per_share?: number | undefined;
  /** Per-share denominator (diluted weighted-average when available). */
  shares?: number | undefined;
  shares_source?: string | undefined;
  /** Market-cap denominator (period-end paid-up when available). */
  market_cap_shares?: number | undefined;
  market_cap_shares_source?: string | undefined;
  market_cap?: number | undefined;
  market_price?: number | undefined;
  margin_of_safety?: number | undefined;
  implied_g?: number | null | undefined;
  implied_ke?: number | null | undefined;
  mos_interpretation?: string | undefined;
  implied_g_note?: string | undefined;
  implied_ke_note?: string | undefined;
  prompt?: string | undefined;
}

export function computeMarketImplied(
  registry: CanonicalOutputRegistry,
  valuation: { V_primary: number; ke: number; g_effective: number; CSE0: number; pvRE: number; explicit_periods: number; RE_anchor: number; periods: RecastPeriod[] },
  marketPrice?: number | undefined,
  sharesOverride?: number | undefined,
  marketCapSharesOverride?: number | undefined,
): MarketImpliedResult {
  const shares = sharesOverride ?? registry.get<number>("shares_outstanding");
  const sharesSource = registry.get<string>("shares_source") ?? "registry";
  if (!shares || shares <= 0) return { status: "shares_unavailable" };
  const marketCapShares = marketCapSharesOverride ?? shares;
  const marketCapSharesSource = marketCapSharesOverride != null ? "period-end paid-up shares" : sharesSource;
  const intrinsic_per_share = valuation.V_primary / shares;
  if (marketPrice == null || !Number.isFinite(marketPrice) || marketPrice <= 0) {
    return {
      status: "market_price_required",
      intrinsic_per_share,
      shares,
      shares_source: sharesSource,
      market_cap_shares: marketCapShares,
      market_cap_shares_source: marketCapSharesSource,
      prompt: `Intrinsic value per share is ₹${intrinsic_per_share.toFixed(1)}. Enter market price for implied analytics.`,
    };
  }
  const market_cap = marketPrice * marketCapShares;
  const margin_of_safety = (intrinsic_per_share - marketPrice) / marketPrice;
  const mos_interpretation = margin_of_safety > 0.2
    ? "Substantial margin of safety."
    : margin_of_safety > 0
    ? "Modest margin of safety."
    : margin_of_safety > -0.3
    ? "Market price exceeds intrinsic estimate."
    : "Market embeds expectations above current RE model trajectory.";
  const vAtG = (g: number) => {
    if (g >= valuation.ke - 0.001) return Number.POSITIVE_INFINITY;
    const cv = valuation.RE_anchor * (1 + g) / (valuation.ke - g);
    return valuation.CSE0 + valuation.pvRE + cv / Math.pow(1 + valuation.ke, valuation.explicit_periods);
  };
  let implied_g: number | null = null;
  let gNote = "";
  let lo = -0.10;
  let hi = valuation.ke - 0.005;
  if (vAtG(hi) >= market_cap && vAtG(lo) <= market_cap) {
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const vm = vAtG(mid);
      if (Math.abs(vm - market_cap) / Math.max(market_cap, 1) < 0.001) {
        implied_g = mid;
        break;
      }
      if (vm < market_cap) lo = mid;
      else hi = mid;
      implied_g = mid;
    }
    gNote = `Implied terminal RE growth at current ke is ${((implied_g ?? 0) * 100).toFixed(2)}%.`;
  } else {
    gNote = "No plausible g in bounded search range reconciles to market cap.";
  }
  const vAtKe = (keTry: number) => {
    const g = valuation.g_effective;
    if (keTry <= g + 0.001) return Number.POSITIVE_INFINITY;
    const pvRE = valuation.periods.slice(1).reduce((acc, p, idx) => acc + (p.ri?.RE ?? 0) / Math.pow(1 + keTry, idx + 1), 0);
    const cv = valuation.RE_anchor * (1 + g) / (keTry - g);
    return valuation.CSE0 + pvRE + cv / Math.pow(1 + keTry, valuation.explicit_periods);
  };
  let implied_ke: number | null = null;
  let keNote = "";
  let keLo = valuation.g_effective + 0.005;
  let keHi = 0.25;
  if (vAtKe(keLo) >= market_cap) {
    for (let i = 0; i < 100; i++) {
      const mid = (keLo + keHi) / 2;
      const vm = vAtKe(mid);
      if (Math.abs(vm - market_cap) / Math.max(market_cap, 1) < 0.001) {
        implied_ke = mid;
        break;
      }
      if (vm > market_cap) keLo = mid;
      else keHi = mid;
      implied_ke = mid;
    }
    keNote = `Implied ke at fixed g is ${((implied_ke ?? 0) * 100).toFixed(2)}%.`;
  } else {
    keNote = `Market cap exceeds model value even at low ke (${(keLo*100).toFixed(1)}%).`;
  }
  registry.register("market_intrinsic_per_share", intrinsic_per_share, "S-16.2");
  registry.register("market_cap", market_cap, "S-16.2");
  registry.register("market_price", marketPrice, "S-16.2");
  registry.register("market_margin_of_safety", margin_of_safety, "S-16.2");
  if (implied_g != null) registry.register("market_implied_g", implied_g, "S-16.2");
  if (implied_ke != null) registry.register("market_implied_ke", implied_ke, "S-16.2");
  return {
    status: "full",
    intrinsic_per_share,
    shares,
    shares_source: sharesSource,
    market_cap_shares: marketCapShares,
    market_cap_shares_source: marketCapSharesSource,
    market_cap,
    market_price: marketPrice,
    margin_of_safety,
    implied_g,
    implied_ke,
    mos_interpretation,
    implied_g_note: gNote,
    implied_ke_note: keNote,
  };
}
