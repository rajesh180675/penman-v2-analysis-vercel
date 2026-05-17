/**
 * Graham-Dodd Earnings Power Value (EPV) Module
 *
 * Based on Bruce Greenwald's "Value Investing" framework (Columbia Business School).
 * Core insight: separate the value of current earnings power from the value of growth.
 *
 * Three-part decomposition:
 *   Asset Value (V_A)   — reproduction cost of net operating assets
 *   EPV (V_EPV)         — capitalized normalized earnings, assuming zero growth
 *   Franchise Value     — V_EPV − V_A (value attributable to competitive advantage)
 *
 * EPV = Normalized NOPAT / WACC
 *
 * If EPV > V_A  → franchise exists; company earns above its cost of capital
 * If EPV ≈ V_A  → competitive industry; no durable advantage
 * If EPV < V_A  → earnings depressed; potential turnaround or value trap
 *
 * Normalization strategy:
 *   - Use median CoreOI margin over available history (robust to outliers)
 *   - Trim top/bottom year when ≥ 7 periods available
 *   - Apply normalized margin to latest Sales for normalized CoreOI
 *   - Use median effective tax rate (clamped to [15%, 40%] for India)
 *   - NOPAT = normalized CoreOI × (1 − normalized tax rate)
 *
 * For banks: equity-based EPV = normalized PAT / ke (book-value anchor)
 */

import { RecastPeriod, EngineConfig, ke_from_config, deriveKwFromConfig } from "./types";

// ─── Output Types ────────────────────────────────────────────────────────────

export interface EPVNormalization {
  /** Periods used in normalization (after trimming) */
  periodsUsed: number;
  /** Median CoreOI margin (CoreOI / Sales) */
  medianCoreOIMargin: number;
  /** Normalized CoreOI = medianCoreOIMargin × latestSales */
  normalizedCoreOI: number;
  /** Median effective tax rate */
  medianTaxRate: number;
  /** Normalized NOPAT = normalizedCoreOI × (1 − medianTaxRate) */
  normalizedNOPAT: number;
  /** Latest Sales used as revenue base */
  latestSales: number;
  /** Margin range across history [min, max] for context */
  marginRange: [number, number];
  /** Whether normalization is high-confidence (≥ 5 clean periods) */
  highConfidence: boolean;
}

export interface EPVResult {
  /** Normalized earnings power value (enterprise) */
  V_EPV: number;
  /** Asset value proxy = latest NOA (reproduction cost approximation) */
  V_A: number;
  /** Franchise value = V_EPV − V_A */
  franchiseValue: number;
  /** Franchise value as % of EPV */
  franchisePct: number;
  /** WACC (kw) used for capitalization */
  kw: number;
  /** Normalization details */
  normalization: EPVNormalization;
  /** Per-share EPV (null if share count unavailable) */
  epvPerShare: number | null;
  /** Margin of safety vs market price (null if price unavailable) */
  marginOfSafety: number | null;
  /** Implied market price premium/discount to EPV */
  priceToEPV: number | null;
  /** Interpretation label */
  interpretation: EPVInterpretation;
  /** Confidence in this EPV estimate */
  confidence: "high" | "medium" | "low";
  /** Reasons for confidence degradation */
  confidenceNotes: string[];
}

export type EPVInterpretation =
  | "strong-franchise"    // EPV > 1.5× V_A
  | "franchise"           // EPV > 1.1× V_A
  | "competitive"         // EPV ≈ V_A (within ±10%)
  | "depressed-earnings"  // EPV < 0.9× V_A (turnaround candidate)
  | "insufficient-data";  // Cannot compute

/** Bank-specific EPV (equity-based, uses PAT / ke) */
export interface BankEPVResult {
  /** Normalized PAT / ke */
  V_EPV_equity: number;
  /** Latest book value (equity anchor) */
  bookValue: number;
  /** Franchise premium = V_EPV_equity − bookValue */
  franchisePremium: number;
  /** Price-to-book implied by EPV */
  impliedPB: number | null;
  /** ke used */
  ke: number;
  /** Normalized ROE used */
  normalizedROE: number;
  /** Confidence */
  confidence: "high" | "medium" | "low";
  confidenceNotes: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Trim top and bottom 1 value when array has ≥ 7 elements */
function trimmedValues(values: number[]): number[] {
  if (values.length < 7) return values;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.slice(1, sorted.length - 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function interpretFranchise(franchisePct: number): EPVInterpretation {
  if (franchisePct > 0.33)  return "strong-franchise";
  if (franchisePct > 0.09)  return "franchise";
  if (franchisePct > -0.11) return "competitive";
  return "depressed-earnings";
}

// ─── Industrial EPV ──────────────────────────────────────────────────────────

/**
 * Compute Graham-Dodd EPV for an industrial company.
 *
 * @param periods    Sorted (oldest→newest) recast periods
 * @param config     Engine config (provides ke, kw)
 * @param marketCap  Optional market cap in ₹ Crore for margin-of-safety
 * @param kwOverride Optional structurally-derived kw to use instead of the
 *                   80/20 fallback in `deriveKwFromConfig`. v3Analytics passes
 *                   the same kw it uses for terminal-value math so EPV stays
 *                   consistent across modules (review C8, S-9.4C).
 */
export function computeEPV(
  periods: RecastPeriod[],
  config: EngineConfig,
  marketCap?: number | null,
  kwOverride?: number | null,
): EPVResult | null {
  if (!periods || periods.length < 3) return null;

  const confidenceNotes: string[] = [];

  // ── 1. Collect CoreOI margins and tax rates ──────────────────────────────
  const margins: number[] = [];
  const taxRates: number[] = [];

  for (const p of periods) {
    const sales   = p.is?.Sales;
    const coreOI  = p.cu?.CoreOI;
    const taxRate = p.is?.taxRate;

    if (sales != null && sales > 0 && coreOI != null) {
      margins.push(coreOI / sales);
    }
    if (taxRate != null && taxRate > 0 && taxRate < 1) {
      taxRates.push(taxRate);
    }
  }

  if (margins.length < 3) {
    confidenceNotes.push("Fewer than 3 periods with CoreOI — normalization unreliable");
    return null;
  }

  // ── 2. Normalize ─────────────────────────────────────────────────────────
  const trimmedMargins  = trimmedValues(margins);
  const trimmedTaxRates = trimmedValues(taxRates);

  const medianMargin  = median(trimmedMargins)!;
  const rawTaxRate    = median(trimmedTaxRates.length ? trimmedTaxRates : taxRates) ?? 0.25;
  // India: clamp effective tax rate to [15%, 40%]
  const medianTaxRate = clamp(rawTaxRate, 0.15, 0.40);

  const latestPeriod = periods[periods.length - 1];
  const latestSales  = latestPeriod.is?.Sales;
  const latestNOA    = latestPeriod.bs?.NOA;

  if (latestSales == null || latestSales <= 0) {
    confidenceNotes.push("Latest Sales unavailable — cannot compute EPV");
    return null;
  }
  if (latestNOA == null) {
    confidenceNotes.push("Latest NOA unavailable — asset value proxy missing");
  }

  const normalizedCoreOI = medianMargin * latestSales;
  const normalizedNOPAT  = normalizedCoreOI * (1 - medianTaxRate);

  // ── 3. Capitalization ────────────────────────────────────────────────────
  // EPV is traditionally capitalized at ke (Greenwald) to isolate franchise
  // value from asset value. We use WACC (kw) here to align with the full
  // capital structure visible in recast data. Prefer the structurally-derived
  // kw passed from v3Analytics (review C8); fall back to deriveKwFromConfig
  // for direct callers (tests, ad-hoc usage).
  const kw = (kwOverride != null && Number.isFinite(kwOverride) && kwOverride > 0)
    ? kwOverride
    : deriveKwFromConfig(config);

  if (kw <= 0.01) {
    confidenceNotes.push("WACC too low — EPV unreliable");
    return null;
  }

  const V_EPV = normalizedNOPAT / kw;

  // EPV ≤ 0 means normalized NOPAT is non-positive (depressed cyclical, structural
  // loss-maker, or negative median margin). Margin-of-safety and price/EPV ratios
  // would flip sign and mislead reviewers (review C12). Refuse to publish.
  if (V_EPV <= 0) {
    confidenceNotes.push(
      `Normalized EPV is non-positive (${V_EPV.toFixed(2)} ₹Cr) — depressed earnings or structural losses; cannot publish franchise/MOS ratios`,
    );
    return null;
  }

  const V_A   = latestNOA ?? 0;

  const franchiseValue = V_EPV - V_A;
  // FranchisePct denominator is V_EPV (already verified > 0). For asset-light
  // firms (V_A ≤ 0, e.g., services with customer-funded WC), franchiseValue
  // collapses to V_EPV itself — interpret as "100% franchise" rather than the
  // old `V_A > 0 ? ... : 0` which forced franchisePct to 0 and silently
  // misclassified asset-light moats as "competitive" (review C12).
  const franchisePct   = franchiseValue / V_EPV;
  if (V_A <= 0) {
    confidenceNotes.push(
      "Latest NOA ≤ 0 (asset-light or customer-funded WC) — franchise value equals EPV; interpret with care",
    );
  }

  // ── 4. Per-share and margin of safety ────────────────────────────────────
  const shareCount = latestPeriod.shareCountInput?.endPeriodShares
    ?? latestPeriod.shareCountInput?.weightedAverageDilutedShares;

  const epvPerShare = (shareCount != null && shareCount > 0)
    ? (V_EPV * 1e7) / shareCount   // ₹Cr → ₹ (1 Cr = 1e7 ₹)
    : null;

  const marginOfSafety = (marketCap != null && marketCap > 0)
    ? (V_EPV - marketCap) / V_EPV
    : null;

  const priceToEPV = (marketCap != null && V_EPV > 0)
    ? marketCap / V_EPV
    : null;

  // ── 5. Confidence ────────────────────────────────────────────────────────
  const highConfidence = margins.length >= 5;
  if (!highConfidence) confidenceNotes.push(`Only ${margins.length} margin observations`);
  if (Math.abs(margins[margins.length - 1] - medianMargin) / (Math.abs(medianMargin) + 0.001) > 0.5) {
    confidenceNotes.push("Latest margin deviates >50% from median — possible cyclical distortion");
  }
  if (latestNOA == null) confidenceNotes.push("NOA unavailable — franchise value unreliable");

  const confidence: EPVResult["confidence"] =
    confidenceNotes.length === 0 ? "high"
    : confidenceNotes.length <= 2 ? "medium"
    : "low";

  const marginRange: [number, number] = [
    Math.min(...margins),
    Math.max(...margins),
  ];

  return {
    V_EPV,
    V_A,
    franchiseValue,
    franchisePct,
    kw,
    normalization: {
      periodsUsed:       trimmedMargins.length,
      medianCoreOIMargin: medianMargin,
      normalizedCoreOI,
      medianTaxRate,
      normalizedNOPAT,
      latestSales,
      marginRange,
      highConfidence,
    },
    epvPerShare,
    marginOfSafety,
    priceToEPV,
    interpretation: interpretFranchise(franchisePct),
    confidence,
    confidenceNotes,
  };
}

// ─── Bank EPV ────────────────────────────────────────────────────────────────

/**
 * Equity-based EPV for banks/NBFCs.
 * EPV = Normalized PAT / ke
 * Franchise premium = EPV − Book Value
 *
 * @param bankPeriods  Array of {period_end, pat, totalEquity} from bankPipeline
 * @param config       Engine config (provides ke)
 * @param marketCap    Optional market cap for P/B context
 */
export function computeBankEPV(
  bankPeriods: Array<{
    period_end: string;
    pat: number | null;
    totalEquity: number | null;
  }>,
  config: EngineConfig,
  _marketCap?: number | null,
): BankEPVResult | null {
  if (!bankPeriods || bankPeriods.length < 3) return null;

  const confidenceNotes: string[] = [];

  // Collect ROE series
  const roeValues: number[] = [];
  const patValues: number[] = [];

  for (let i = 1; i < bankPeriods.length; i++) {
    const curr = bankPeriods[i];
    const prev = bankPeriods[i - 1];
    if (
      curr.pat != null && curr.totalEquity != null && curr.totalEquity > 0 &&
      prev.totalEquity != null && prev.totalEquity > 0
    ) {
      const avgEquity = (curr.totalEquity + prev.totalEquity) / 2;
      roeValues.push(curr.pat / avgEquity);
      patValues.push(curr.pat);
    }
  }

  if (roeValues.length < 2) {
    confidenceNotes.push("Insufficient ROE observations for bank EPV");
    return null;
  }

  const trimmedROE = trimmedValues(roeValues);
  const normalizedROE = median(trimmedROE)!;

  const latestPeriod = bankPeriods[bankPeriods.length - 1];
  const bookValue = latestPeriod.totalEquity;

  if (bookValue == null || bookValue <= 0) {
    confidenceNotes.push("Latest book value unavailable");
    return null;
  }

  const ke = ke_from_config(config);
  if (ke <= 0.01) {
    confidenceNotes.push("ke too low — bank EPV unreliable");
    return null;
  }

  // Normalized PAT = normalizedROE × latest book value
  const normalizedPAT = normalizedROE * bookValue;
  const V_EPV_equity  = normalizedPAT / ke;

  const franchisePremium = V_EPV_equity - bookValue;
  const impliedPB = bookValue > 0 ? V_EPV_equity / bookValue : null;

  // Confidence
  if (roeValues.length < 5) confidenceNotes.push(`Only ${roeValues.length} ROE observations`);
  const latestROE = roeValues[roeValues.length - 1];
  if (Math.abs(latestROE - normalizedROE) / (Math.abs(normalizedROE) + 0.001) > 0.4) {
    confidenceNotes.push("Latest ROE deviates >40% from median — NPA cycle may distort EPV");
  }

  const confidence: BankEPVResult["confidence"] =
    confidenceNotes.length === 0 ? "high"
    : confidenceNotes.length <= 1 ? "medium"
    : "low";

  return {
    V_EPV_equity,
    bookValue,
    franchisePremium,
    impliedPB,
    ke,
    normalizedROE,
    confidence,
    confidenceNotes,
  };
}

// ─── Sensitivity Table ───────────────────────────────────────────────────────

/**
 * EPV sensitivity to WACC and normalized margin.
 * Returns a 3×3 grid: [margin −10%, base, +10%] × [kw −1%, base, +1%]
 */
export interface EPVSensitivityCell {
  margin: number;
  kw: number;
  V_EPV: number;
}

export function computeEPVSensitivity(
  baseResult: EPVResult,
): EPVSensitivityCell[][] {
  const { normalization, kw } = baseResult;
  const { medianCoreOIMargin, latestSales, medianTaxRate } = normalization;

  const marginDeltas = [-0.10, 0, 0.10];
  const kwDeltas     = [-0.01, 0, 0.01];

  return marginDeltas.map(dm => {
    const adjMargin = medianCoreOIMargin * (1 + dm);
    return kwDeltas.map(dk => {
      const adjKw    = Math.max(0.03, kw + dk);
      const nopat    = adjMargin * latestSales * (1 - medianTaxRate);
      return {
        margin: adjMargin,
        kw:     adjKw,
        V_EPV:  nopat / adjKw,
      };
    });
  });
}
