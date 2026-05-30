import type { SOTPResult } from "../sotpValuation";

/** Lightweight three-scenario bundle for bank/NBFC valuation.
 *
 * Unlike ValuationScenarioCard (which requires a full ValuationResult
 * from the Penman-Nissim reformulation), this uses simplified bank-specific
 * metrics: ROE, P/B, and intrinsic value per share.
 * The UI can render these alongside the full VCC scenario cards.
 */
export interface BankScenarioCard {
  key: "stress" | "base" | "bull";
  label: string;
  probability: number;
  roe: number;
  ke: number;
  g: number;
  fairPB: number;
  intrinsicValue: number | null;
  intrinsicPerShare: number | null;
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  reason: string;
}

export interface ScenarioBundle {
  cards: BankScenarioCard[];
  /** Which scenario is the "lead" (shown first in UI). */
  primary: "stress" | "base" | "bull";
}

export type BankValuationStatus = "computed" | "skipped";

export interface BankValuationModelResult {
  status: BankValuationStatus;
  /** Per-share or total intrinsic equity value (Cr). null when skipped. */
  intrinsicValue: number | null;
  /** Implied premium/discount vs market cap when supplied. null otherwise. */
  premiumOverMarket: number | null;
  /** Why the model produced the value or skipped. */
  reason: string;
  /** Diagnostic intermediates for traceability. */
  diagnostics: Record<string, number | null>;
}

/** Diagnostic for through-cycle credit-cost band check (NBFC-only). */
export interface CreditCostCycleCheck {
  status: "computed" | "skipped";
  /** Trailing 7y median credit cost (decimal, e.g. 0.015 = 1.5%). */
  medianCreditCost: number | null;
  /** Latest period credit cost. */
  latestCreditCost: number | null;
  /** Latest / median ratio. */
  ratio: number | null;
  /** Severity tag: "under-provisioning" | "normal" | "stress-peak". */
  severity: "under-provisioning" | "normal" | "stress-peak" | "unknown";
  /** Human-readable explanation. */
  message: string;
}

// ── Phase D3b — Spread Compression / Cost-of-Funds Sensitivity ──────────────
//
// Indian NBFCs fund themselves through wholesale borrowings (NCDs, bank loans,
// institutional debt) — NOT deposits. This makes them acutely vulnerable to
// funding cost spikes during liquidity crises:
//   - FY18 IL&FS: wholesale rates spiked ~150bps in 3 months
//   - FY20 COVID: CP/NCD markets froze, rollover risk materialized
//   - FY22 Adani-Hindenburg: contagion fears widened NBFC spreads ~100bps
//
// Unlike banks (which have sticky CASA deposits as a buffer), NBFCs must
// reprice their entire liability book within 1-3 years. A 150bps CoB spike
// directly compresses spread → ROA → ROE → justified P/B.
//
// This diagnostic:
//   1. Tracks the cost-of-borrowings trend (rising = risk)
//   2. Stress-tests ROA under +150bps (moderate) and +250bps (severe) CoB shocks
//   3. Flags when current spread is already thin vs trailing median
//
// It is INFORMATIONAL (like creditCostCycle) — does not modify valuation.
// The analyst uses it to judge whether the base-case ROE assumption is fragile.
// ────────────────────────────────────────────────────────────────────────────

export interface SpreadCompressionCheck {
  status: "computed" | "skipped";
  /** Latest cost of borrowings (decimal, e.g. 0.08 = 8%). */
  latestCostOfBorrowings: number | null;
  /** Latest yield on advances (decimal). */
  latestYieldOnAdvances: number | null;
  /** Latest spread = yield - cost (decimal). */
  latestSpread: number | null;
  /** Trailing 5y median spread (decimal). */
  medianSpread: number | null;
  /** Latest spread / median spread ratio. < 1 means compression. */
  spreadRatio: number | null;
  /** Cost-of-borrowings trend: YoY change in bps (positive = rising). */
  cobTrendBps: number | null;
  /** Stress scenario: ROA if CoB rises +150bps (IL&FS-level shock). */
  stressedROA_150bps: number | null;
  /** Stress scenario: ROA if CoB rises +250bps (severe liquidity crisis). */
  stressedROA_250bps: number | null;
  /** Current ROA for comparison. */
  currentROA: number | null;
  /** Severity: "compressed" | "normal" | "expanding" | "unknown". */
  severity: "compressed" | "normal" | "expanding" | "unknown";
  /** Human-readable explanation with stress scenario impact. */
  message: string;
}

/** Diagnostic for CRAR-buffer growth governor (NBFC-only). */
export interface CrarGovernorResult {
  status: "computed" | "skipped";
  /** Latest CRAR % from quality sidecar. */
  latestCrarPct: number | null;
  /** Required CRAR + buffer (e.g. 18% = 15% norm + 300bps buffer). */
  requiredCrarPct: number;
  /** Headroom in basis points. Negative when below required. */
  headroomBps: number | null;
  /** Original g (before governor) and effective g (after governor) — both
   *  expressed as decimals (e.g. 0.05 = 5%). */
  originalG: number;
  effectiveG: number;
  /** Reason for adjustment (or "no adjustment needed" when headroom OK). */
  message: string;
}


// ── Phase D3 — ECL Stress Governor ─────────────────────────────────────────
//
// Indian NBFCs report under IndAS 109 Expected Credit Loss (ECL) framework:
//   Stage 1: performing (12-month ECL provision)
//   Stage 2: significant credit deterioration (lifetime ECL)
//   Stage 3: credit-impaired (lifetime ECL, ≈ GNPA equivalent)
//
// The justified P/B from Gordon model uses 5-year median ROE which smooths
// through stress periods. This is normally a feature (avoids one-year noise)
// but becomes a bug when the loan book is structurally deteriorating.
//
// The ECL stress governor compensates by fading the justified P/B when the
// UNCOVERED portion of Stage 3 (= Stage 3 × (1 − ECL coverage)) plus
// restructured book exceeds healthy thresholds.
//
// Key insight: raw Stage 3 alone is misleading. A lender with Stage 3 = 5%
// and 80% ECL coverage has only 1% of the book genuinely at risk. Same
// Stage 3 with 30% coverage has 3.5% at risk — a 3.5x worse position.
//
// Calibration (Indian NBFC distress history):
//   < 2%  uncovered: healthy (Bajaj, Cholamandalam, Sundaram)
//   2-5%  uncovered: warning zone (vehicle-finance NBFCs in mild stress)
//   5-10% uncovered: distress (DHFL FY18, IL&FS subsidiaries pre-collapse)
//   > 10% uncovered: severe distress (microfinance crisis, pre-IBC)
//
// The governor does NOT apply to P/AUM, ROA×Leverage RI, Equity RI, or DDM
// because those lenses use latest-period inputs which already reflect stress
// through depressed earnings/ROA. Justified P/B is the outlier — it uses
// median ROE which lags structural deterioration.
// ────────────────────────────────────────────────────────────────────────────

export interface EclStressGovernorResult {
  status: "computed" | "skipped";
  /** Latest Stage 3 (credit-impaired) % from quality sidecar. */
  latestStage3Pct: number | null;
  /** Latest ECL coverage % (provision on Stage 3 / gross Stage 3). */
  latestEclCoveragePct: number | null;
  /** Latest restructured book as % of advances. */
  latestRestructuredPct: number | null;
  /** Latest Stage 2 % — advisory only, not used in fade calculation.
   *  Elevated Stage 2 is a leading indicator of future Stage 3 migration. */
  latestStage2Pct: number | null;
  /** The composite metric: Stage3 × (1 − coverage/100) + restructured × 0.5.
   *  This is the actual dollar hole in the book as % of gross loans. */
  uncoveredStressPct: number | null;
  /** Fade multiplier applied to justified P/B. 1.0 = no fade. */
  fadeFactor: number;
  /** Justified P/B before ECL fade. */
  originalPB: number;
  /** Justified P/B after ECL fade. */
  effectivePB: number;
  /** Human-readable explanation of the fade decision. */
  message: string;
}

export interface BankValuationBundle {
  /** Sustainable ROE used by Gordon and DDM. Median of last 5y, ≥0. */
  sustainableROE: number | null;
  /** Cost of equity from config. */
  ke: number;
  /** Terminal growth used (post-CRAR-governor when NBFC). */
  terminalGrowth: number;
  /** Latest book value (Cr). */
  latestBookValue: number | null;
  /** Number of years of usable history (positive earnings + book value). */
  usableHistory: number;
  /** Optional payout ratio if derivable (currently null — CF parsing TBD). */
  payoutRatio: number | null;

  justifiedPB: BankValuationModelResult;
  equityResidualIncome: BankValuationModelResult;
  sustainableDDM: BankValuationModelResult;
  /** Optional EV-based valuation for insurance subtype when embedded_value is present. */
  evBased?: BankValuationModelResult | undefined;
  /** Phase D2 — NBFC P/AUM lens. Only computed when subtype="nbfc"
   *  AND quality sidecar provides aum_cr. */
  pAum?: BankValuationModelResult | undefined;
  /** Phase D2 — NBFC ROA × Leverage three-stage residual income lens.
   *  Only computed when subtype="nbfc". */
  roaLeverageRI?: BankValuationModelResult | undefined;
  /** Phase D2 — Through-cycle credit-cost diagnostic (NBFC-only). */
  creditCostCycle?: CreditCostCycleCheck | undefined;
  /** Phase D2 — CRAR-buffer growth governor (NBFC-only). */
  crarGovernor?: CrarGovernorResult | undefined;
  /** Phase D3 — ECL stress fade on justified P/B (NBFC-only).
   *  Fades the Gordon-model P/B when uncovered Stage 3 + restructured
   *  exceeds healthy thresholds. See EclStressGovernorResult for details. */
  eclStressGovernor?: EclStressGovernorResult | undefined;
  /** Phase D3b — Spread compression / cost-of-funds sensitivity (NBFC-only).
   *  Informational diagnostic: stress-tests ROA under CoB shocks and flags
   *  when current spread is thin vs history. Does NOT modify valuation. */
  spreadCompression?: SpreadCompressionCheck | undefined;

  /** Phase E — Three-scenario framework (bear/base/bull). */
  scenarios?: ScenarioBundle | null | undefined;
  /** Phase E — Subsidiary SOTP (sum-of-parts). */
  sotp?: SOTPResult | undefined;

  /** Triangulated central value (median of computed models). */
  triangulatedValue: number | null;
  /** Models that contributed to triangulation. */
  modelsContributing: string[];
}
