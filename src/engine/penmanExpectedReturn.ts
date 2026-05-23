/**
 * Penman Expected Return Calculator
 *
 * The single most useful output for an investor: given what you observe
 * (profitability, moat, growth) and what you pay (P/B), what annual
 * return should you expect?
 *
 * Academic basis:
 *   - Penman (2021): "What you pay vs what you get"
 *   - Greenwald-Penman synthesis: EPV → growth premium → verdict
 *
 * Formula:
 *   E[R] = (1/P_B) × [RNOA + (RNOA - r_F) × ω/(1+r_F-ω)] + g × (1 - 1/P_B)
 */

import type { RecastPeriod } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PenmanExpectedReturn {
  // Core output
  expectedReturn: number;           // annualized expected return
  verdict: "attractive" | "fair" | "expensive";

  // Components
  rnoaComponent: number;            // return from current profitability
  persistenceComponent: number;     // return from moat (ω effect)
  growthComponent: number;          // return from growth
  pricePaid: number;                // P/B ratio (what you pay)

  // Inputs used
  rnoa: number;
  omega: number;
  growth: number;                   // NOA growth rate
  costOfCapital: number;
  bookValuePerShare: number;
  pricePerShare: number;

  // Decision support
  requiredForHurdle: {
    maxPB: number;                  // max P/B for 15% return at current RNOA/ω/g
    minRNOA: number;                // min RNOA for 15% return at current P/B
  };

  // Valuation layers (Greenwald-Penman)
  valuationLayers: {
    epvPerShare: number;            // earnings power value (no growth)
    growthPremium: number;          // market price - EPV
    growthPremiumPct: number;       // growth premium as % of EPV
    growthJustified: boolean;       // is the premium justified?
  };

  // Narrative
  narrative: string;
}

// ─── Core Implementation ───────────────────────────────────────────────────

/**
 * Compute Penman Expected Return from recast data + market price + fade rate.
 */
export function computePenmanExpectedReturn(
  data: RecastPeriod[],
  costOfCapital: number,
  omega: number,
  marketPricePerShare: number,
  sharesOutstanding: number,  // in crores
): PenmanExpectedReturn | null {
  if (data.length < 3 || marketPricePerShare <= 0 || sharesOutstanding <= 0) return null;

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];

  // Extract RNOA
  const rnoa = latest.ratios?.RNOA;
  if (rnoa == null) return null;

  // Book value per share (CSE / shares)
  const cse = latest.bs?.CSE;
  if (cse == null || cse <= 0) return null;
  const bookValuePerShare = cse / sharesOutstanding;

  // P/B ratio
  const pb = marketPricePerShare / bookValuePerShare;
  if (pb <= 0) return null;

  // NOA growth rate (from latest two periods)
  const noaCurrent = latest.bs?.NOA ?? 0;
  const noaPrev = prev.bs?.NOA ?? 0;
  const noaGrowth = noaPrev > 0 ? (noaCurrent - noaPrev) / noaPrev : 0;
  // Use median of available growth rates for stability
  const growthRates: number[] = [];
  for (let i = data.length - 1; i >= Math.max(1, data.length - 5); i--) {
    const cur = data[i].bs?.NOA ?? 0;
    const prv = data[i - 1].bs?.NOA ?? 0;
    if (prv > 0 && cur > 0) growthRates.push((cur - prv) / prv);
  }
  growthRates.sort((a, b) => a - b);
  const g = growthRates.length > 0 ? growthRates[Math.floor(growthRates.length / 2)] : noaGrowth;

  // Clamp growth to reasonable range
  const gClamped = Math.max(-0.05, Math.min(0.25, g));

  // ── Penman Expected Return Formula ──
  // E[R] = (1/PB) × [RNOA + (RNOA - r) × ω/(1+r-ω)] + g × (1 - 1/PB)
  const r = costOfCapital;
  const persistenceMultiplier = (1 + r - omega) > 0 ? omega / (1 + r - omega) : 0;
  const rnoaPlusPersis = rnoa + (rnoa - r) * persistenceMultiplier;

  const rnoaComponent = (1 / pb) * rnoa;
  const persistenceComponent = (1 / pb) * (rnoa - r) * persistenceMultiplier;
  const growthComponent = gClamped * (1 - 1 / pb);

  const expectedReturn = (1 / pb) * rnoaPlusPersis + gClamped * (1 - 1 / pb);

  // Verdict
  const hurdle = 0.15; // 15% return threshold
  let verdict: PenmanExpectedReturn["verdict"];
  if (expectedReturn > hurdle + 0.02) verdict = "attractive";
  else if (expectedReturn < hurdle - 0.03) verdict = "expensive";
  else verdict = "fair";

  // Required for 15% hurdle
  // Solve: 0.15 = (1/PB_max) × rnoaPlusPersis + g × (1 - 1/PB_max)
  // 0.15 = rnoaPlusPersis/PB - g/PB + g
  // 0.15 - g = (rnoaPlusPersis - g) / PB
  // PB_max = (rnoaPlusPersis - g) / (0.15 - g)
  const maxPB = (hurdle - gClamped) !== 0
    ? (rnoaPlusPersis - gClamped) / (hurdle - gClamped)
    : pb;

  // Solve for min RNOA at current PB:
  // 0.15 = (1/PB) × [RNOA_min + (RNOA_min - r) × ω/(1+r-ω)] + g × (1-1/PB)
  // Let M = 1 + persistenceMultiplier, then rnoaPlusPersis = RNOA × M - r × persistenceMultiplier
  // 0.15 = (1/PB) × (RNOA_min × M - r×pm) + g×(1-1/PB)
  // RNOA_min × M / PB = 0.15 - g×(1-1/PB) + r×pm/PB
  // RNOA_min = [0.15 - g×(1-1/PB) + r×pm/PB] × PB / M
  const M = 1 + persistenceMultiplier;
  const pm = persistenceMultiplier;
  const minRNOA = M > 0
    ? (hurdle - gClamped * (1 - 1 / pb) + r * pm / pb) * pb / M
    : rnoa;

  // Valuation layers (Greenwald-Penman)
  const normalizedNOPAT = rnoa * noaCurrent;
  const epv = costOfCapital > 0 ? normalizedNOPAT / costOfCapital : 0;
  const nfo = latest.bs?.NFO ?? 0;
  const epvEquity = epv - nfo;
  const epvPerShare = sharesOutstanding > 0 ? epvEquity / sharesOutstanding : 0;

  const growthPremium = marketPricePerShare - epvPerShare;
  const growthPremiumPct = epvPerShare > 0 ? growthPremium / epvPerShare : 0;

  // Growth premium is justified if: RNOA > cost of capital AND ω > 0.5
  const growthJustified = rnoa > costOfCapital && omega > 0.5 && gClamped > 0;

  // Narrative
  const narrative = buildNarrative(expectedReturn, verdict, rnoa, omega, gClamped, pb, costOfCapital, growthPremiumPct, growthJustified);

  return {
    expectedReturn,
    verdict,
    rnoaComponent,
    persistenceComponent,
    growthComponent,
    pricePaid: pb,
    rnoa,
    omega,
    growth: gClamped,
    costOfCapital,
    bookValuePerShare,
    pricePerShare: marketPricePerShare,
    requiredForHurdle: {
      maxPB: Math.max(0, maxPB),
      minRNOA: Math.max(0, minRNOA),
    },
    valuationLayers: {
      epvPerShare,
      growthPremium,
      growthPremiumPct,
      growthJustified,
    },
    narrative,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildNarrative(
  er: number, verdict: string, rnoa: number, omega: number,
  g: number, pb: number, r: number, gpPct: number, gpJustified: boolean,
): string {
  const erPct = (er * 100).toFixed(1);
  const rnoaPct = (rnoa * 100).toFixed(1);
  const gPct = (g * 100).toFixed(1);

  let line1: string;
  if (verdict === "attractive") {
    line1 = `Expected return of ${erPct}% exceeds 15% hurdle — price compensates for risk.`;
  } else if (verdict === "expensive") {
    line1 = `Expected return of ${erPct}% falls short of 15% hurdle — market prices in optimistic assumptions.`;
  } else {
    line1 = `Expected return of ${erPct}% is near the 15% hurdle — fairly valued at current levels.`;
  }

  const line2 = `Profitability: RNOA ${rnoaPct}% ${rnoa > r ? "exceeds" : "below"} cost of capital (${(r * 100).toFixed(1)}%). ` +
    `Moat persistence: ω=${omega.toFixed(2)} (${omega > 0.65 ? "strong" : omega > 0.5 ? "moderate" : "weak"}). ` +
    `Growth: ${gPct}% NOA expansion.`;

  const line3 = `At P/B of ${pb.toFixed(1)}×, market embeds ${(gpPct * 100).toFixed(0)}% growth premium over EPV. ` +
    (gpJustified ? "Premium appears justified by profitability + moat." : "Premium may be excessive given weak moat or returns below cost of capital.");

  return `${line1} ${line2} ${line3}`;
}
