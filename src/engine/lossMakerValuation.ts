/**
 * Loss-Maker Valuation — Phase I3 robustness
 *
 * When earnings-based models (P/B Gordon, ERI, DDM, EPV, Penman-Nissim
 * residual income) all skip-with-reason because the company has no
 * positive earnings history, users are left with nothing actionable.
 * This module provides three earnings-independent anchors:
 *
 *   1. Revenue multiple (EV/Sales) — uses configured peer median or
 *      sector default; appropriate for early-stage growth names where
 *      the operating model is still proving out
 *   2. Reverse-DCF — solves for the steady-state revenue and operating
 *      margin the current market cap implies, so users can sense-check
 *      whether the price is asking for plausible execution
 *   3. Path-to-profitability — extrapolates current cash burn vs cash
 *      runway and flags whether the company has runway to reach
 *      breakeven before equity dilution becomes likely
 *
 * Canonical Indian cases: Paytm (FY22-FY25 losses), Zomato (pre-FY24),
 * Nykaa post-IPO, PB Fintech (Policybazaar), Ola pre-listing.
 *
 * This is NOT a primary valuation. It's a triangulation anchor that
 * answers "what would the company need to do to justify the current
 * price?" — useful precisely when DCF / residual income don't apply.
 */

import type { RecastPeriod, EngineConfig } from "./types";

export interface LossMakerValuationResult {
  /** Whether this dataset qualifies as a loss-maker. */
  isLossMaker: boolean;
  /** Years of negative or near-zero earnings (CNI ≤ 0). */
  lossYears: number;
  /** Total years analysed. */
  totalYears: number;
  /** Latest period revenue (Sales) in Cr. */
  latestRevenueCr: number | null;
  /** TTM revenue growth (YoY). */
  revenueGrowthYoY: number | null;
  /** 3-year revenue CAGR. */
  revenueCAGR3y: number | null;
  /** Latest CFO in Cr. Negative = burning cash, positive = self-funding. */
  latestCFOCr: number | null;
  /** Cash burn rate per year (3y avg of negative CFO; null if positive). */
  cashBurnRateCr: number | null;
  /** Per-share cash on books. */
  cashPerShare: number | null;
  /** Estimated runway in years at current burn rate. */
  runwayYears: number | null;

  /** Revenue-multiple anchor */
  revenueMultiple: {
    /** Multiple applied (peer median or sector default). */
    multiple: number;
    /** Source of the multiple. */
    source: "config-peer-median" | "sector-default" | "user-override";
    /** Implied EV at this multiple, in Cr. */
    impliedEVCr: number;
    /** Per-share value after netting cash and debt. */
    perShareValue: number | null;
    skipReason?: string | undefined;
  };

  /** Reverse-DCF: what does the current market cap imply? */
  reverseDCF: {
    /** Current market cap in Cr. */
    marketCapCr: number | null;
    /** Required steady-state operating margin (assuming 5y revenue path
     *  fade to 5% growth and 10% terminal kw) to justify current price. */
    impliedSteadyStateMargin: number | null;
    /** Required revenue at year 5 to justify current price at industry
     *  median PE of 15. */
    impliedYear5Revenue: number | null;
    /** Required revenue CAGR from current to year-5. */
    impliedRevenueCAGR: number | null;
    skipReason?: string | undefined;
  };

  /** Path-to-profitability flags */
  profitabilityPath: {
    /** Has revenue been growing >20%? */
    highGrowth: boolean;
    /** Has gross margin been improving? */
    improvingMargins: boolean;
    /** Is operating loss narrowing? */
    narrowingLoss: boolean;
    /** Aggregate signal: green/amber/red. */
    signal: "green" | "amber" | "red";
    /** Plain-language summary. */
    summary: string;
  };

  /** Recommended action for the user. */
  recommendation: string;
}

const SECTOR_DEFAULT_PS_MULTIPLE = 3.0;

function calcCAGR(latest: number, earliest: number, years: number): number | null {
  if (!Number.isFinite(latest) || !Number.isFinite(earliest)) return null;
  if (earliest <= 0 || latest <= 0 || years <= 0) return null;
  return Math.pow(latest / earliest, 1 / years) - 1;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/**
 * Compute loss-maker valuation. Only meaningful when traditional models skip.
 * Returns null for profitable companies (use the regular valuation instead).
 */
export function computeLossMakerValuation(
  periods: RecastPeriod[] | null | undefined,
  config: EngineConfig,
): LossMakerValuationResult | null {
  if (!periods || periods.length < 2) return null;

  const sorted = [...periods].sort(
    (a, b) =>
      new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  // Loss-maker test: at least half the periods have CNI ≤ 0.
  // For cyclical companies, raise the bar to 70% to avoid triggering on
  // normal trough years (e.g. Tata Steel with 2-3 loss years in 10).
  const lossYears = sorted.filter((p) => (p.is?.CNI ?? 0) <= 0).length;
  const totalYears = sorted.length;
  const isCyclical = config.company_type === "cyclical";
  const lossThreshold = isCyclical ? 0.70 : 0.50;
  const isLossMaker = lossYears / totalYears >= lossThreshold;

  if (!isLossMaker) return null;

  const latest = sorted[sorted.length - 1]!;
  const latestRevenueCr = latest.is?.Sales ?? null;

  // Revenue growth
  let revenueGrowthYoY: number | null = null;
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2]!;
    if ((prev.is?.Sales ?? 0) > 0 && (latest.is?.Sales ?? 0) > 0) {
      revenueGrowthYoY = (latest.is.Sales - prev.is.Sales) / prev.is.Sales;
    }
  }
  let revenueCAGR3y: number | null = null;
  if (sorted.length >= 4) {
    const earliest = sorted[sorted.length - 4]!;
    revenueCAGR3y = calcCAGR(latest.is?.Sales ?? 0, earliest.is?.Sales ?? 0, 3);
  }

  // Cash burn
  const latestCFOCr = latest.cf?.CFO ?? null;
  const recentCFOs = sorted.slice(-3).map((p) => p.cf?.CFO ?? 0);
  const cashBurnRateCr = recentCFOs.every((c) => c < 0)
    ? -recentCFOs.reduce((a, b) => a + b, 0) / recentCFOs.length
    : null;

  // Cash position — approximated by net financial position. Negative NFO
  // means net cash (firm has more financial assets than financial obligations);
  // positive NFO means net debt. We track netCashCr only when actually in
  // a net-cash position (NFO < 0). For net-debt firms (Vodafone Idea, most
  // distressed names), there is no cash buffer to fund burn — runway and
  // cash-per-share metrics are meaningless and we null them.
  const latestNFO = latest.bs?.NFO ?? null;
  const isNetCash = latestNFO != null && latestNFO < 0;
  const netCashCr = isNetCash ? -latestNFO : null;
  const sharesOutstanding = config.shares_outstanding ?? null;
  const cashPerShare =
    netCashCr != null && sharesOutstanding != null && sharesOutstanding > 0
      ? netCashCr / sharesOutstanding // both in Cr → ₹ per share
      : null;

  const runwayYears =
    netCashCr != null && cashBurnRateCr != null && cashBurnRateCr > 0
      ? netCashCr / cashBurnRateCr
      : null;

  // Revenue multiple
  const cfg = config as unknown as Record<string, unknown>;
  const peerMultiple =
    typeof cfg.peer_median_ev_sales === "number" ? cfg.peer_median_ev_sales : undefined;
  const userMultiple =
    typeof cfg.user_override_ev_sales === "number" ? cfg.user_override_ev_sales : undefined;
  let multiple = SECTOR_DEFAULT_PS_MULTIPLE;
  let source: LossMakerValuationResult["revenueMultiple"]["source"] = "sector-default";
  if (userMultiple != null && Number.isFinite(userMultiple)) {
    multiple = userMultiple;
    source = "user-override";
  } else if (peerMultiple != null && Number.isFinite(peerMultiple)) {
    multiple = peerMultiple;
    source = "config-peer-median";
  }

  // Equity value = Enterprise value - Net debt
  //              = EV(implied) - NFO   (NFO can be negative → net cash adds back)
  // Phase J4 fix: previous version did `EV - max(0, NFO) + (-NFO)`, which
  // double-counted debt for net-debt companies (Vodafone Idea: NFO ≈ +₹2.2L Cr
  // produced equity = EV - 2×NFO and therefore deeply negative). Single-line
  // `EV - NFO` is the canonical form and works for both polarities.
  const impliedEVCr =
    latestRevenueCr != null ? latestRevenueCr * multiple : 0;
  const equityValueCr =
    latestRevenueCr != null && latestNFO != null
      ? impliedEVCr - latestNFO
      : impliedEVCr;
  const perShareValue =
    sharesOutstanding != null && sharesOutstanding > 0 && latestRevenueCr != null
      ? equityValueCr / sharesOutstanding
      : null;

  // An EV/Sales anchor needs sales. Without them `impliedEVCr` is 0 and
  // `perShareValue` collapses to −NFO/shares — net financial position wearing
  // the label "Revenue Multiple (EV/Sales)", which reads as a valuation rather
  // than as the absence of one. `reverseDCF` below already declines on this
  // exact condition; the revenue-multiple side checked only `!= null` and so
  // published a figure derived from no revenue at all.
  const revenueMultipleSkipReason =
    latestRevenueCr == null
      ? "Revenue multiple requires latest-period sales, which are missing."
      : latestRevenueCr <= 0
        ? "Revenue multiple requires positive latest revenue."
        : undefined;

  // Reverse-DCF
  const marketCapCr =
    config.market_price != null && config.shares_outstanding != null
      ? config.market_price * config.shares_outstanding
      : null;

  let impliedSteadyStateMargin: number | null = null;
  let impliedYear5Revenue: number | null = null;
  let impliedRevenueCAGR: number | null = null;
  let reverseDCFSkipReason: string | undefined;

  if (marketCapCr == null) {
    reverseDCFSkipReason =
      "Reverse-DCF requires market price and shares outstanding in config.";
  } else if (latestRevenueCr == null || latestRevenueCr <= 0) {
    reverseDCFSkipReason = "Reverse-DCF requires positive latest revenue.";
  } else {
    // Solve: at industry median PE 15, what year-5 earnings does mcap imply?
    const targetPE = 15;
    const impliedYear5Earnings = marketCapCr / targetPE;
    // Assume year-5 margin matches industry median ~12%
    const targetMargin = 0.12;
    impliedYear5Revenue = impliedYear5Earnings / targetMargin;
    impliedRevenueCAGR = calcCAGR(impliedYear5Revenue, latestRevenueCr, 5);
    // What steady-state margin justifies current price at year-5 revenue
    // grown at observed 3y CAGR or 20% (whichever lower) for 5y?
    const realisticGrowth = Math.min(revenueCAGR3y ?? 0.2, 0.30);
    const expectedYear5Revenue =
      latestRevenueCr * Math.pow(1 + realisticGrowth, 5);
    impliedSteadyStateMargin =
      expectedYear5Revenue > 0
        ? (marketCapCr / targetPE) / expectedYear5Revenue
        : null;
  }

  // Path-to-profitability
  const highGrowth = (revenueGrowthYoY ?? 0) >= 0.20 || (revenueCAGR3y ?? 0) >= 0.20;
  // Margin trend (gross margin proxy via 1 - COGS/Sales)
  const grossMargins = sorted
    .map((p) => {
      const sales = p.is?.Sales ?? 0;
      const cogs = p.is?.COGS ?? 0;
      return sales > 0 ? 1 - cogs / sales : null;
    })
    .filter((v): v is number => v != null);
  const earlyGM = median(grossMargins.slice(0, Math.ceil(grossMargins.length / 2)));
  const lateGM = median(grossMargins.slice(Math.floor(grossMargins.length / 2)));
  const improvingMargins =
    earlyGM != null && lateGM != null && lateGM > earlyGM + 0.02;
  // Loss trend
  const opLosses = sorted
    .map((p) => p.is?.OI ?? 0)
    .filter((v) => v < 0);
  const narrowingLoss =
    opLosses.length >= 3 &&
    Math.abs(opLosses[opLosses.length - 1]!) <
      Math.abs(opLosses[opLosses.length - 3]!) * 0.7;

  let signal: "green" | "amber" | "red";
  let summary: string;
  const flags = [highGrowth, improvingMargins, narrowingLoss].filter(Boolean).length;
  if (flags >= 2) {
    signal = "green";
    summary = `Strong path: ${flags}/3 positive signals (${[
      highGrowth ? "high growth" : null,
      improvingMargins ? "improving margins" : null,
      narrowingLoss ? "narrowing loss" : null,
    ]
      .filter(Boolean)
      .join(", ")}). Loss-making but trajectory is constructive.`;
  } else if (flags === 1) {
    signal = "amber";
    summary = `Mixed path: only 1/3 positive signals. Path to profitability uncertain — runway management is critical.`;
  } else {
    signal = "red";
    summary = `Weak path: 0/3 positive signals. Neither growth, margins, nor loss-narrowing improving. Equity at material risk of dilution or impairment.`;
  }

  // Overall recommendation. The multiple is only quotable when it was applied
  // to something, so where there is no anchor the reason replaces it rather
  // than sitting beside it: this string is the sentence a reviewer acts on, and
  // it travels into the V3 banner without the panel's guard around it.
  let recommendation: string;
  if (runwayYears != null && runwayYears < 2) {
    const anchorClause = revenueMultipleSkipReason
      ? `No revenue-multiple anchor is available: ${revenueMultipleSkipReason} Stress-test against equity dilution risk.`
      : `Anchor on revenue-multiple of ${multiple.toFixed(1)}x and stress-test against equity dilution risk.`;
    recommendation = `Loss-maker with <2 years runway at current burn. ${anchorClause} Reverse-DCF asks for ${
      impliedRevenueCAGR != null ? `${(impliedRevenueCAGR * 100).toFixed(0)}% revenue CAGR for 5y` : "growth assumptions that need sense-checking"
    }.`;
  } else if (signal === "green") {
    const anchorClause = revenueMultipleSkipReason
      ? `No revenue-multiple anchor: ${revenueMultipleSkipReason}`
      : `Revenue-multiple anchor: ${multiple.toFixed(1)}x ⇒ ${perShareValue != null ? `₹${perShareValue.toFixed(0)}/share` : "use peer median"}.`;
    recommendation = `Loss-maker with constructive trajectory. ${anchorClause} Compare with current price; reverse-DCF implied CAGR is ${impliedRevenueCAGR != null ? `${(impliedRevenueCAGR * 100).toFixed(0)}%` : "TBD"}.`;
  } else {
    // "Treat any revenue-multiple anchor as upper bound" presupposes an anchor
    // to bound. With no sales there is none, and the sentence sends the reader
    // looking for a figure the panel is declining to show.
    const anchorClause = revenueMultipleSkipReason
      ? `No revenue-multiple anchor is available: ${revenueMultipleSkipReason}`
      : `Treat any revenue-multiple anchor as upper bound, not fair value.`;
    recommendation = `Loss-maker with weak path-to-profitability signals. ${anchorClause} Consider waiting for either margin inflection or constructive guidance before sizing position.`;
  }

  return {
    isLossMaker: true,
    lossYears,
    totalYears,
    latestRevenueCr,
    revenueGrowthYoY,
    revenueCAGR3y,
    latestCFOCr,
    cashBurnRateCr,
    cashPerShare,
    runwayYears,
    revenueMultiple: {
      multiple,
      source,
      impliedEVCr,
      perShareValue,
      skipReason: revenueMultipleSkipReason,
    },
    reverseDCF: {
      marketCapCr,
      impliedSteadyStateMargin,
      impliedYear5Revenue,
      impliedRevenueCAGR,
      skipReason: reverseDCFSkipReason,
    },
    profitabilityPath: {
      highGrowth,
      improvingMargins,
      narrowingLoss,
      signal,
      summary,
    },
    recommendation,
  };
}
