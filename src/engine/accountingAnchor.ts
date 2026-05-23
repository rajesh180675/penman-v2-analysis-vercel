/**
 * Accounting Anchor & Value-Creating Growth Engine
 *
 * Greenwald-Penman synthesis: anchor valuation in accounting fundamentals,
 * then evaluate whether the market's growth premium is justified.
 *
 * Three valuation layers:
 *   Layer 0: Asset Value (reproduction cost / book value)
 *   Layer 1: Earnings Power Value (EPV) — normalized earnings / cost of capital
 *   Layer 2: Growth Value — only justified if moat exists (ω > 0.5, RNOA > r)
 *
 * Value-Creating Growth decomposition:
 *   g_total = g_value_creating + g_neutral
 *   Only growth that earns above cost of capital creates value.
 *
 * Academic basis:
 *   - Greenwald et al. (2001): Value Investing
 *   - Penman (2011, 2021): Accounting for Value
 *   - Leibowitz & Kogelman (1990): Franchise Value
 */

import type { RecastPeriod } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AccountingAnchorResult {
  // Valuation layers (per share)
  layers: {
    assetValue: number;           // book value per share (Layer 0)
    epv: number;                  // earnings power value per share (Layer 1)
    growthValue: number;          // justified growth premium (Layer 2)
    totalIntrinsic: number;       // epv + justified growth
  };

  // Market comparison
  marketPrice: number;
  priceVsEPV: number;             // market price / EPV — <1 = deep value
  growthPremium: number;          // market price - EPV (what market pays for growth)
  growthPremiumPct: number;       // as % of EPV
  growthJustified: boolean;       // is premium warranted by moat + returns?

  // Signal
  signal: "deep_value" | "value" | "fair" | "growth_premium" | "speculative";
  narrative: string;

  // Value-creating growth decomposition
  growthDecomposition: {
    totalGrowth: number;          // actual NOA growth rate
    valueCreatingGrowth: number;  // portion earning above CoC
    valueNeutralGrowth: number;   // portion earning at CoC
    sustainableGrowth: number;    // max self-financeable
    externalCapitalNeeded: boolean;
    franchiseFactor: number;      // (ROIC - r) / (ROIC × r)
    growthFactor: number;         // g / (r - g)
  };

  // Inputs
  rnoa: number;
  omega: number;
  costOfCapital: number;
}

// ─── Core Implementation ───────────────────────────────────────────────────

export function computeAccountingAnchor(
  data: RecastPeriod[],
  costOfCapital: number,
  omega: number,
  marketPricePerShare: number,
  sharesOutstanding: number,
): AccountingAnchorResult | null {
  if (data.length < 3 || marketPricePerShare <= 0 || sharesOutstanding <= 0) return null;

  const latest = data[data.length - 1];
  const rnoa = latest.ratios?.RNOA;
  const noa = latest.bs?.NOA;
  const nfo = latest.bs?.NFO ?? 0;
  const cse = latest.bs?.CSE;

  if (rnoa == null || noa == null || noa <= 0 || cse == null || cse <= 0) return null;

  const r = costOfCapital;

  // ── Layer 0: Asset Value (book value) ──
  const assetValue = cse / sharesOutstanding;

  // ── Layer 1: Earnings Power Value ──
  // EPV = normalized NOPAT / WACC (no growth, no fade)
  // Use core operating income normalized over last 3-5 years
  const normalizedOI = computeNormalizedOI(data);
  const taxRate = latest.is?.taxRate ?? 0.25;
  const normalizedNOPAT = normalizedOI * (1 - taxRate);
  const epvFirm = r > 0 ? normalizedNOPAT / r : 0;
  const epvEquity = epvFirm - nfo;
  const epv = Math.max(0, epvEquity / sharesOutstanding);

  // ─ Layer 2: Growth Value ──
  // Justified only if RNOA > r AND ω > 0.5 (moat exists to protect returns)
  const moatExists = rnoa > r && omega > 0.5;
  const historicalGrowth = computeMedianGrowth(data);
  const g = Math.max(0, Math.min(0.20, historicalGrowth)); // clamp

  let justifiedGrowthValue = 0;
  if (moatExists && g > 0) {
    // Growth value = EPV × franchise factor × growth factor
    const ff = rnoa > 0 ? (rnoa - r) / (rnoa * r) : 0;
    const gf = (r - g) > 0.01 ? g / (r - g) : 0;
    justifiedGrowthValue = epv * ff * gf * r; // scale by r to normalize
  }

  const totalIntrinsic = epv + justifiedGrowthValue;

  // ── Market comparison ──
  const priceVsEPV = epv > 0 ? marketPricePerShare / epv : 999;
  const growthPremium = marketPricePerShare - epv;
  const growthPremiumPct = epv > 0 ? growthPremium / epv : 0;
  const growthJustified = moatExists && growthPremium <= justifiedGrowthValue * 1.2;

  // ── Signal ──
  let signal: AccountingAnchorResult["signal"];
  if (priceVsEPV < 0.7) signal = "deep_value";
  else if (priceVsEPV < 1.0) signal = "value";
  else if (priceVsEPV < 1.3) signal = "fair";
  else if (growthJustified) signal = "growth_premium";
  else signal = "speculative";

  // ── Value-Creating Growth Decomposition ──
  const totalGrowth = historicalGrowth;
  const valueCreatingGrowth = rnoa > 0 ? totalGrowth * (rnoa - r) / rnoa : 0;
  const valueNeutralGrowth = rnoa > 0 ? totalGrowth * r / rnoa : totalGrowth;

  // Sustainable growth
  const payout = computePayoutRatio(data);
  const sustainableGrowth = rnoa * (1 - payout);
  const externalCapitalNeeded = totalGrowth > sustainableGrowth * 1.1;

  // Franchise value components
  const franchiseFactor = rnoa > 0 ? (rnoa - r) / (rnoa * r) : 0;
  const growthFactor = (r - g) > 0.01 ? g / (r - g) : 0;

  // ── Narrative ──
  const narrative = buildNarrative(signal, priceVsEPV, growthPremiumPct, moatExists, rnoa, r, omega, totalGrowth, sustainableGrowth, externalCapitalNeeded);

  return {
    layers: { assetValue, epv, growthValue: justifiedGrowthValue, totalIntrinsic },
    marketPrice: marketPricePerShare,
    priceVsEPV,
    growthPremium,
    growthPremiumPct,
    growthJustified,
    signal,
    narrative,
    growthDecomposition: {
      totalGrowth,
      valueCreatingGrowth,
      valueNeutralGrowth,
      sustainableGrowth,
      externalCapitalNeeded,
      franchiseFactor,
      growthFactor,
    },
    rnoa,
    omega,
    costOfCapital: r,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeNormalizedOI(data: RecastPeriod[]): number {
  // Use median of last 5 years' core OI to strip cyclicality
  const ois: number[] = [];
  for (let i = Math.max(0, data.length - 5); i < data.length; i++) {
    const coreOI = data[i].cu?.CoreOI;
    const oi = data[i].is?.OI;
    ois.push(coreOI ?? oi ?? 0);
  }
  if (ois.length === 0) return 0;
  ois.sort((a, b) => a - b);
  return ois[Math.floor(ois.length / 2)];
}

function computeMedianGrowth(data: RecastPeriod[]): number {
  const rates: number[] = [];
  for (let i = Math.max(1, data.length - 5); i < data.length; i++) {
    const cur = data[i].bs?.NOA ?? 0;
    const prev = data[i - 1].bs?.NOA ?? 0;
    if (prev > 0 && cur > 0) rates.push((cur - prev) / prev);
  }
  if (rates.length === 0) return 0;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

function computePayoutRatio(data: RecastPeriod[]): number {
  const payouts: number[] = [];
  for (let i = Math.max(0, data.length - 5); i < data.length; i++) {
    const pat = data[i].is?.PAT;
    const div = data[i].cf?.DividendPaid;
    if (pat != null && pat > 0 && div != null) {
      payouts.push(Math.min(1, Math.abs(div) / pat));
    }
  }
  if (payouts.length === 0) return 0.30;
  payouts.sort((a, b) => a - b);
  return payouts[Math.floor(payouts.length / 2)];
}

function buildNarrative(
  signal: string, priceVsEPV: number, gpPct: number, moatExists: boolean,
  rnoa: number, r: number, omega: number, growth: number, sustainG: number,
  extCapital: boolean,
): string {
  const lines: string[] = [];

  if (signal === "deep_value") {
    lines.push(`Trading at ${(priceVsEPV * 100).toFixed(0)}% of EPV — market pays nothing for current earnings power, let alone growth.`);
  } else if (signal === "value") {
    lines.push(`Trading below EPV (${(priceVsEPV * 100).toFixed(0)}%) — market implies earnings will decline from current levels.`);
  } else if (signal === "fair") {
    lines.push(`Trading near EPV — price reflects current earnings power with minimal growth expectation.`);
  } else if (signal === "growth_premium") {
    lines.push(`${(gpPct * 100).toFixed(0)}% growth premium over EPV — justified by RNOA ${(rnoa * 100).toFixed(1)}% > CoC ${(r * 100).toFixed(1)}% and persistence ω=${omega.toFixed(2)}.`);
  } else {
    lines.push(`${(gpPct * 100).toFixed(0)}% growth premium over EPV — ${moatExists ? "moat exists but premium exceeds justified level" : "no durable moat to protect returns on new investment"}.`);
  }

  if (growth > 0) {
    const vcg = rnoa > 0 ? growth * (rnoa - r) / rnoa : 0;
    lines.push(`Of ${(growth * 100).toFixed(1)}% historical growth, only ${(vcg * 100).toFixed(1)}pp creates value (earns above CoC).`);
  }

  if (extCapital) {
    lines.push(`Growth (${(growth * 100).toFixed(1)}%) exceeds self-financing capacity (${(sustainG * 100).toFixed(1)}%) — requires external capital.`);
  }

  return lines.join(" ");
}
