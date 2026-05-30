import type { BankScenarioCard, ScenarioBundle } from "./types";

// ─── Three-Scenario Framework for Banks/NBFCs ────────────────────────────

/**
 * Build a three-scenario bundle (bear/base/bull) for bank/NBFC valuation.
 *
 * Bank scenarios differ from industrial scenarios because:
 * - RNOA/ATO decomposition is meaningless; ROE/leverage are the drivers
 * - Credit cost cycle is a key swing factor (base vs stress)
 * - CRAR buffer governs sustainable growth
 * - Net interest margin (NIM) persistence matters more than PM persistence
 *
 * This creates lightweight scenario cards by adjusting the base
 * Gordon P/B model parameters: ROE, ke, and g.
 */
export function buildBankScenarioBundle(params: {
  sustainableROE: number | null;
  ke: number;
  terminalGrowth: number;
  latestBookValue: number | null;
  marketCap: number | null;
  isNbfc: boolean;
}): ScenarioBundle | null {
  const { sustainableROE, ke, terminalGrowth: baseG, latestBookValue, marketCap, isNbfc } = params;
  if (sustainableROE == null || latestBookValue == null || latestBookValue <= 0) return null;

  const cards: BankScenarioCard[] = [
    // BEAR: lower ROE, lower growth, higher ke (credit-cost stress)
    buildBankCard("stress", sustainableROE, ke, baseG, latestBookValue, marketCap, isNbfc, -0.04, -0.015, 0.02),
    // BASE: as-is
    buildBankCard("base", sustainableROE, ke, baseG, latestBookValue, marketCap, isNbfc, 0, 0, 0),
    // BULL: higher ROE, higher growth, lower ke
    buildBankCard("bull", sustainableROE, ke, baseG, latestBookValue, marketCap, isNbfc, 0.03, 0.01, -0.01),
  ];

  return { cards, primary: "base" };
}

function buildBankCard(
  key: "stress" | "base" | "bull",
  baseROE: number,
  baseKe: number,
  baseG: number,
  bv: number,
  marketCap: number | null,
  isNbfc: boolean,
  roeAdj: number,
  gAdj: number,
  keAdj: number,
): BankScenarioCard {
  const roe = Math.max(baseROE + roeAdj, 0.005);
  const ke = baseKe + keAdj;
  const g = Math.max(0, baseG + gAdj);
  const keMinusG = ke - g;
  const pbFloor = isNbfc ? 0.3 : 0.2;
  const fairPB = keMinusG > 0.001
    ? Math.max((roe - g) / keMinusG, pbFloor)
    : pbFloor;

  const intrinsicValue = fairPB * bv;
  const intrinsicPerShare = null; // Requires shares outstanding — filled by UI from market data
  const upsidePct = marketCap != null && marketCap > 0
    ? intrinsicValue / marketCap - 1
    : null;
  const marginOfSafetyPct = upsidePct;

  const label = key === "stress" ? "Bear" : key === "bull" ? "Bull" : "Base";
  const probability = key === "base" ? 0.5 : key === "stress" ? 0.2 : 0.3;

  return {
    key,
    label: `${label} (Bank)`,
    probability,
    roe,
    ke,
    g,
    fairPB,
    intrinsicValue,
    intrinsicPerShare,
    upsidePct,
    marginOfSafetyPct,
    reason: `ROE=${(roe*100).toFixed(1)}%, ke=${(ke*100).toFixed(1)}%, g=${(g*100).toFixed(1)}% → P/B=${fairPB.toFixed(2)}`,
  };
}
