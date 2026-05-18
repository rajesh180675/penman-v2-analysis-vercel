/**
 * Graham-Dodd Earnings Power Value (EPV)
 *
 * Greenwald et al. (2001) — "Value Investing: From Graham to Buffett and Beyond"
 *
 * EPV is the no-growth floor anchor: what is the business worth if it never
 * grows again but maintains current normalized earnings power indefinitely?
 *
 * Formula:
 *   Normalized NOPAT = median(CoreOI) × (1 - statutory tax rate)
 *   Maintenance Capex = min(avg Capex, avg Depreciation)  [Greenwald simplification]
 *   Adjusted Earnings = Normalized NOPAT - (Maintenance Capex - Depreciation)
 *     → If capex ≈ depreciation, adjustment is ~0 (steady-state)
 *     → If capex >> depreciation, excess is growth capex (excluded from EPV)
 *   EPV_operations = Adjusted Earnings / Ke
 *   EPV_equity = EPV_operations - NFO
 *   EPV_per_share = EPV_equity / diluted shares
 *
 * Interpretation:
 *   - If market price < EPV: market is pricing in decline (or it's cheap)
 *   - If market price ≈ EPV: market gives no credit for growth
 *   - If market price > EPV: market is pricing in growth (justified only if moat exists)
 *
 * This is the "moat test": EPV vs reproduction value of assets. If EPV > asset
 * reproduction value, a moat exists (franchise value). We approximate reproduction
 * value as book NOA (imperfect but directionally useful for Indian equities where
 * asset revaluation is rare).
 */

import { RecastPeriod, EngineConfig } from "./types";

export interface EPVResult {
  /** Normalized core operating income (median across periods, ₹ Cr). */
  normalizedCoreOI: number;
  /** Statutory tax rate used. */
  taxRate: number;
  /** Normalized NOPAT = normalizedCoreOI × (1 - taxRate). */
  normalizedNOPAT: number;
  /** Average depreciation across periods (₹ Cr). */
  avgDepreciation: number;
  /** Average capex across periods (₹ Cr, positive = outflow). */
  avgCapex: number;
  /** Maintenance capex estimate = min(avgCapex, avgDepreciation). */
  maintenanceCapex: number;
  /** Growth capex estimate = avgCapex - maintenanceCapex. */
  growthCapex: number;
  /** Adjusted earnings power = normalizedNOPAT (no capex adjustment needed when
   *  maintenance ≈ depreciation, which is already deducted from OI). */
  adjustedEarningsPower: number;
  /** Cost of equity used as discount rate. */
  ke: number;
  /** EPV of operations = adjustedEarningsPower / ke (₹ Cr). */
  epvOperations: number;
  /** Net Financial Obligations (debt - cash, ₹ Cr). */
  nfo: number;
  /** EPV of equity = epvOperations - NFO (₹ Cr). */
  epvEquity: number;
  /** Diluted shares outstanding (Cr). */
  sharesOutstanding: number | null;
  /** EPV per share (₹). */
  epvPerShare: number | null;
  /** Book NOA as proxy for reproduction value of assets (₹ Cr). */
  reproductionValue: number;
  /** Franchise value = EPV_operations - reproductionValue. Positive = moat. */
  franchiseValue: number;
  /** Moat signal: "moat" if franchise > 0, "no-moat" if ≤ 0. */
  moatSignal: "moat" | "no-moat" | "inconclusive";
  /** Margin of safety vs market price (null if no market price). */
  marginOfSafety: number | null;
  /** Explanation lines for audit trail. */
  explanation: string[];
  /** Number of periods used for normalization. */
  periodsUsed: number;
}

/** Compute median of a numeric array. */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute Graham-Dodd Earnings Power Value.
 *
 * @param data - Array of RecastPeriod (at least 3 recommended for normalization)
 * @param config - Engine config (for ke, tax rate, shares, market price)
 * @returns EPVResult or null if insufficient data
 */
export function computeEPV(
  data: RecastPeriod[],
  config: EngineConfig,
): EPVResult | null {
  if (data.length < 2) return null;

  // ── Normalize Core OI ──────────────────────────────────────────────────────
  // Use CoreOI (strips unusual items) for a cleaner earnings power estimate.
  // Median is more robust than mean for cyclical companies.
  const coreOIs = data
    .map(p => p.cu.CoreOI)
    .filter((v): v is number => v != null && isFinite(v));

  if (coreOIs.length < 2) return null;

  const normalizedCoreOI = median(coreOIs);
  if (normalizedCoreOI <= 0) {
    // Loss-maker — EPV is not meaningful (use loss-maker module instead)
    return null;
  }

  // ── Tax Rate ───────────────────────────────────────────────────────────────
  // Use statutory rate (more stable than effective rate which fluctuates with
  // deferred tax, MAT credits, etc.)
  const taxRate = config.statutory_tax_rate ?? 0.252;

  // ── Depreciation & Capex ───────────────────────────────────────────────────
  const depreciations = data
    .map(p => p.is.operatingCostBridge?.depreciation)
    .filter((v): v is number => v != null && isFinite(v) && v > 0);

  const capexes = data
    .map(p => Math.abs(p.cf.Capex))
    .filter((v): v is number => v != null && isFinite(v) && v > 0);

  const avgDepreciation = depreciations.length > 0
    ? depreciations.reduce((s, v) => s + v, 0) / depreciations.length
    : 0;

  const avgCapex = capexes.length > 0
    ? capexes.reduce((s, v) => s + v, 0) / capexes.length
    : 0;

  // Greenwald's maintenance capex: the minimum of actual capex and depreciation.
  // Rationale: if capex < depreciation, the company is under-investing (use capex).
  // If capex > depreciation, excess is growth capex (use depreciation as maintenance).
  const maintenanceCapex = Math.min(avgCapex, avgDepreciation);
  const growthCapex = Math.max(0, avgCapex - maintenanceCapex);

  // ── Adjusted Earnings Power ────────────────────────────────────────────────
  // CoreOI already has depreciation deducted. So:
  //   If maintenance capex ≈ depreciation → no adjustment needed
  //   If maintenance capex < depreciation → company is under-investing,
  //     add back (depreciation - maintenanceCapex) to reflect true maintenance cost
  //   If maintenance capex > depreciation → shouldn't happen by our min() above
  //
  // Net adjustment = depreciation - maintenanceCapex (always ≥ 0)
  // But since OI already deducts depreciation, and we want to deduct maintenance capex:
  //   Adjusted = OI + depreciation - maintenanceCapex
  //   = OI + (depreciation - maintenanceCapex)
  //
  // Actually, the cleaner Greenwald formulation:
  //   Earnings Power = EBITDA - Maintenance Capex - Taxes
  //   EBITDA = CoreOI + Depreciation
  //   EP = (CoreOI + Depreciation - MaintenanceCapex) × (1 - tax)
  //
  // When maintenance = depreciation: EP = CoreOI × (1 - tax) [standard case]
  // When maintenance < depreciation: EP > CoreOI × (1 - tax) [under-investing]

  const ebitda = normalizedCoreOI + avgDepreciation;
  const earningsBeforeTax = ebitda - maintenanceCapex;
  const normalizedNOPAT = normalizedCoreOI * (1 - taxRate);
  const adjustedEarningsPower = earningsBeforeTax * (1 - taxRate);

  // ── Cost of Equity ─────────────────────────────────────────────────────────
  const ke = (config.risk_free_rate ?? 0.07) + (config.equity_risk_premium ?? 0.055);

  if (ke <= 0.01) return null; // nonsensical ke

  // ── EPV Calculation ────────────────────────────────────────────────────────
  const epvOperations = adjustedEarningsPower / ke;

  // Latest period's NFO and NOA
  const latest = data[data.length - 1];
  const nfo = latest.bs.NFO;
  const epvEquity = epvOperations - nfo;

  // ── Shares ─────────────────────────────────────────────────────────────────
  const shares = config.shares_outstanding ?? null;
  const epvPerShare = shares != null && shares > 0 ? epvEquity / shares : null;

  // ── Reproduction Value (Moat Test) ─────────────────────────────────────────
  // Book NOA as proxy. In India, land/property is often understated on books,
  // so this is conservative (biases toward finding a moat).
  const reproductionValue = latest.bs.NOA;
  const franchiseValue = epvOperations - reproductionValue;
  const moatSignal: EPVResult["moatSignal"] =
    franchiseValue > reproductionValue * 0.1
      ? "moat"
      : franchiseValue < -reproductionValue * 0.05
        ? "no-moat"
        : "inconclusive";

  // ── Margin of Safety vs Market ─────────────────────────────────────────────
  const marketPrice = config.market_price ?? null;
  const marginOfSafety =
    marketPrice != null && epvPerShare != null && marketPrice > 0
      ? (epvPerShare - marketPrice) / marketPrice
      : null;

  // ── Explanation ────────────────────────────────────────────────────────────
  const explanation: string[] = [
    `Graham-Dodd EPV (no-growth floor) using ${coreOIs.length} periods of CoreOI.`,
    `Normalized CoreOI (median): ₹${normalizedCoreOI.toFixed(0)} Cr`,
    `EBITDA (normalized): ₹${ebitda.toFixed(0)} Cr (CoreOI + avg depreciation ₹${avgDepreciation.toFixed(0)} Cr)`,
    `Maintenance capex: ₹${maintenanceCapex.toFixed(0)} Cr (min of avg capex ₹${avgCapex.toFixed(0)}, avg depreciation ₹${avgDepreciation.toFixed(0)})`,
    `Growth capex excluded: ₹${growthCapex.toFixed(0)} Cr`,
    `Adjusted earnings power (after-tax): ₹${adjustedEarningsPower.toFixed(0)} Cr at ${(taxRate * 100).toFixed(1)}% tax`,
    `EPV of operations: ₹${epvOperations.toFixed(0)} Cr (÷ ke=${(ke * 100).toFixed(1)}%)`,
    `Less NFO: ₹${nfo.toFixed(0)} Cr`,
    `EPV of equity: ₹${epvEquity.toFixed(0)} Cr`,
    ...(epvPerShare != null ? [`EPV per share: ₹${epvPerShare.toFixed(1)}`] : []),
    `Reproduction value (book NOA): ₹${reproductionValue.toFixed(0)} Cr`,
    `Franchise value: ₹${franchiseValue.toFixed(0)} Cr → ${moatSignal}`,
    ...(marginOfSafety != null
      ? [`Margin of safety vs market (₹${marketPrice?.toFixed(1)}): ${(marginOfSafety * 100).toFixed(1)}%`]
      : []),
  ];

  return {
    normalizedCoreOI,
    taxRate,
    normalizedNOPAT,
    avgDepreciation,
    avgCapex,
    maintenanceCapex,
    growthCapex,
    adjustedEarningsPower,
    ke,
    epvOperations,
    nfo,
    epvEquity,
    sharesOutstanding: shares,
    epvPerShare,
    reproductionValue,
    franchiseValue,
    moatSignal,
    marginOfSafety,
    explanation,
    periodsUsed: coreOIs.length,
  };
}
