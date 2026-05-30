/* ══════════════════════════════════════════════════════════════════
   S-16.3 — Section 6B rendering (per-share + market-implied summary)
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ./shareCount, ./marketImplied, ./shared — no back-edge.
══════════════════════════════════════════════════════════════════ */
import { CanonicalOutputRegistry } from "./shared";
import type { ShareCountResult } from "./shareCount";
import type { MarketImpliedResult } from "./marketImplied";

export type Section6BStatus = "full" | "partial" | "empty";
export interface Section6BResult {
  status: Section6BStatus;
  intrinsic_per_share: number | null;
  shares: number | null;
  shares_source: string;
  shares_confidence: string;
  market_price: number | null;
  market_cap: number | null;
  margin_of_safety: number | null;
  implied_g: number | null;
  implied_ke: number | null;
  mos_interpretation: string;
  implied_g_note: string;
  implied_ke_note: string;
  dilution_note: string;
  v_primary_over_mcap: number | null;
}

export function buildSection6B(
  shareCount: ShareCountResult,
  marketImplied: MarketImpliedResult,
  registry: CanonicalOutputRegistry
): Section6BResult {
  const shares = shareCount.shares;
  const V_primary = registry.get<number>("V_primary") ?? null;

  if (!shares || !V_primary) {
    return {
      status: "empty",
      intrinsic_per_share: null,
      shares: null,
      shares_source: shareCount.source,
      shares_confidence: shareCount.confidence,
      market_price: null,
      market_cap: null,
      margin_of_safety: null,
      implied_g: null,
      implied_ke: null,
      mos_interpretation: "",
      implied_g_note: "",
      implied_ke_note: "",
      dilution_note: shareCount.dilution_note ?? "",
      v_primary_over_mcap: null,
    };
  }

  const intrinsic_per_share = V_primary / shares;

  if (marketImplied.status === "market_price_required" || marketImplied.status === "shares_unavailable") {
    return {
      status: "partial",
      intrinsic_per_share,
      shares,
      shares_source: shareCount.source,
      shares_confidence: shareCount.confidence,
      market_price: null,
      market_cap: null,
      margin_of_safety: null,
      implied_g: null,
      implied_ke: null,
      mos_interpretation: "",
      implied_g_note: "",
      implied_ke_note: "",
      dilution_note: shareCount.dilution_note ?? "",
      v_primary_over_mcap: null,
    };
  }

  const mcap = marketImplied.market_cap ?? null;
  return {
    status: "full",
    intrinsic_per_share,
    shares,
    shares_source: shareCount.source,
    shares_confidence: shareCount.confidence,
    market_price: marketImplied.market_price ?? null,
    market_cap: mcap,
    margin_of_safety: marketImplied.margin_of_safety ?? null,
    implied_g: marketImplied.implied_g ?? null,
    implied_ke: marketImplied.implied_ke ?? null,
    mos_interpretation: marketImplied.mos_interpretation ?? "",
    implied_g_note: marketImplied.implied_g_note ?? "",
    implied_ke_note: marketImplied.implied_ke_note ?? "",
    dilution_note: shareCount.dilution_note ?? "",
    v_primary_over_mcap: mcap && mcap > 0 ? V_primary / mcap : null,
  };
}
