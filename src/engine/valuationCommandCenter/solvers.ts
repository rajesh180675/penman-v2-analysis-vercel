/* ================================================================
   valuationCommandCenter — pure numerical solver/DCF cluster.

   Owner-earnings DCF, growth-fade construction, and three bisection
   solvers (implied ke, implied terminal ROIC, implied growth). All are
   pure number-in/number-out functions — zero type, config, or domain
   coupling, hence zero circular-dependency risk. Extracted from
   valuationCommandCenter.ts so the bug-prone bisection math is unit-
   testable in isolation rather than reachable only through the 646-LOC
   buildCoreCommandCenter orchestrator. Behaviour byte-for-byte identical.
================================================================ */

export function makeFadeArray(base: number, alpha: number, target: number, horizon: number) {
  const values: number[] = [];
  let previous = base;
  for (let i = 0; i < horizon; i += 1) {
    const next = alpha * previous + (1 - alpha) * target;
    values.push(next);
    previous = next;
  }
  return values;
}

export function computeOwnerEarningsDcf(baseOwnerEarnings: number | null, growthPath: number[], ke: number, terminalGrowth: number) {
  if (baseOwnerEarnings == null) return null;
  let current = baseOwnerEarnings;
  const projected = growthPath.map((growth) => {
    current *= 1 + growth;
    return current;
  });
  const pv = projected.reduce((total, value, index) => total + value / Math.pow(1 + ke, index + 1), 0);
  const terminal = projected.length && ke - terminalGrowth > 0.005
    ? (projected[projected.length - 1]! * (1 + terminalGrowth)) / (ke - terminalGrowth)
    : 0;
  return pv + terminal / Math.pow(1 + ke, projected.length);
}

export function solveImpliedKeFromOwnerEarnings(params: {
  targetPrice: number | null;
  ownerEarningsPerShare: number | null;
  growthPath: number[];
  terminalGrowth: number;
  low?: number | undefined;
  high?: number | undefined;
}) {
  const { targetPrice, ownerEarningsPerShare, growthPath, terminalGrowth } = params;
  if (targetPrice == null || targetPrice <= 0 || ownerEarningsPerShare == null || ownerEarningsPerShare <= 0) return null;
  let low = params.low ?? Math.max(terminalGrowth + 0.01, 0.04);
  let high = params.high ?? 0.40;
  let lowValue = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, low, terminalGrowth);
  let highValue = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, high, terminalGrowth);
  if (lowValue == null || highValue == null) return null;
  if (lowValue < targetPrice || highValue > targetPrice) return null;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const value = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, mid, terminalGrowth);
    if (value == null) return null;
    if (value > targetPrice) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function solveImpliedTerminalRoicFromValue(params: {
  targetPrice: number | null;
  shares: number | null;
  cse0: number;
  noaT: number;
  kw: number;
}) {
  const { targetPrice, shares, cse0, noaT, kw } = params;
  if (targetPrice == null || targetPrice <= 0 || shares == null || shares <= 0 || noaT <= 0) return null;
  const equityValue = targetPrice * shares;
  const impliedRoic = kw + ((equityValue - cse0) * kw) / noaT;
  if (!Number.isFinite(impliedRoic) || impliedRoic < -0.1 || impliedRoic > 2.0) return null;
  return impliedRoic;
}

export function solveImpliedGrowthForTarget(params: {
  ownerEarningsPerShare: number | null;
  targetPrice: number | null;
  ke: number;
  terminalGrowth: number;
  normalizedGrowth: number;
  horizon: number;
  growthFadeAlpha: number;
}) {
  const { ownerEarningsPerShare, targetPrice, ke, terminalGrowth, normalizedGrowth, horizon, growthFadeAlpha } = params;
  if (ownerEarningsPerShare == null || targetPrice == null || targetPrice <= 0) return null;

  let low = -0.25;
  let high = 0.45;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const growthPath = makeFadeArray(mid, growthFadeAlpha, normalizedGrowth, horizon);
    const value = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, ke, terminalGrowth);
    if (value == null) return null;
    if (value > targetPrice) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return (low + high) / 2;
}
