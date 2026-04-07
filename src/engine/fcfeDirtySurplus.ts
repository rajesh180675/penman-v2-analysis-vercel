/** FCFE definition under dirty surplus — Phase 1.4
 *
 * FCFE = CNI - dCSE is correct only under clean surplus.
 * When dirty surplus exists (OCI flows through equity but not income),
 * the accrual-based FCFE diverges from the cash-based FCFE.
 */

import { RecastPeriod } from "./types";

export interface FCFEAnalysis {
  /** FCFE_accrual = CNI - dCSE */
  fcfeAccrual: number | null;
  /** FCFE_cash = CFO - Capex + netBorrowing */
  fcfeCash: number | null;
  /** |fcfeCash - fcfeAccrual| / |fcfeCash| */
  divergenceRatio: number | null;
  /** Dirty surplus amount (OCI recognized but not in P&L) */
  dirtySurplus: number | null;
  /** Flag when divergence exceeds 5% of CFO */
  exceedsThreshold: boolean;
  warning: string | null;
}

export function computeFCFEDirtySurplus(
  current: RecastPeriod,
  prev: RecastPeriod | null,
  threshold = 0.05,
): FCFEAnalysis {
  const { CFO } = current.cf;
  const capex = current.cf.Capex ?? 0;
  const { CNI, OCI } = current.is;

  const bridgeDebtProceeds = current.cf.BridgeDebtProceeds ?? 0;
  const bridgeDebtRepayment = current.cf.BridgeDebtRepayment ?? 0;
  const netBorrowing = bridgeDebtProceeds + bridgeDebtRepayment; // Repayments are negative

  // FCFE_cash = CFO - Capex + netBorrowing
  // Capex is typically negative, so CFO - Capex = CFO - (negative) = CFO + |Capex|
  const fcfeCash = CFO - capex + netBorrowing;

  // FCFE_accrual = CNI - dCSE
  // dCSE = change in common shareholders' equity
  const dCSE = prev != null ? current.bs.CSE - prev.bs.CSE : null;
  const fcfeAccrual = dCSE != null ? CNI - dCSE : null;

  // Dirty surplus = OCI that flowed through equity but not P&L
  const dirtySurplus = OCI;

  // Divergence ratio
  const divergence =
    fcfeAccrual != null && Math.abs(fcfeCash) > 1e-9
      ? Math.abs(fcfeCash - fcfeAccrual) / Math.abs(fcfeCash)
      : null;

  const exceedsThreshold = divergence != null && divergence > threshold;

  let warning: string | null = null;
  if (exceedsThreshold) {
    const pct = (divergence * 100).toFixed(1);
    warning = `FCFE divergence of ${pct}% between accrual-based (CNI - dCSE) and cash-based (CFO - Capex + net borrowing). Dirty surplus of ${dirtySurplus?.toFixed(0)} suggests cash-based FCFE is more reliable.`;
  }

  return {
    fcfeAccrual,
    fcfeCash,
    divergenceRatio: divergence,
    dirtySurplus,
    exceedsThreshold,
    warning,
  };
}
