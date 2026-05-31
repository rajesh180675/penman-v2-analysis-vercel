/* ================================================================
   PenmanNissimEngine decomposition — post-recast analytical computations
   (financial ratios, residual income, AR(1) persistence + reversion).

   Lifted verbatim from src/engine/PenmanNissimEngine.ts. Operates purely
   on already-recast RecastPeriod data — no parsing / pick-helper coupling.
   Imports DOWN from leaf type modules (../types/recast, ../types/config),
   NOT the ./types barrel. (Those leaves became acyclic once PR #209 cut the
   types-barrel <-> analysisTraceability edge, so this extraction no longer
   re-forms a cycle — the blocker that reverted the first attempt.)
   PenmanNissimEngine.ts re-exports the public surface, leaving external
   import paths unchanged. Behaviour byte-for-byte identical.
================================================================ */

import type { Ratios, ResidualIncome, RecastPeriod } from "../types/recast";
import { deriveKwFromConfig, type EngineConfig } from "../types/config";

export function computeRatios(cur: RecastPeriod, prev: RecastPeriod, cfg: EngineConfig): Ratios {
  const avg = (a: number, b: number) => (a + b) / 2;
  const avgCSE = avg(cur.bs.CSE, prev.bs.CSE);
  const avgNOA = avg(cur.bs.NOA, prev.bs.NOA);
  const avgNFO = avg(cur.bs.NFO, prev.bs.NFO);
  const avgOA = avg(cur.bs.OA, prev.bs.OA);
  const avgTA = avg(cur.bs.TA, prev.bs.TA);
  const noaSmall = Math.abs(avgNOA) < Math.max(cfg.noa_epsilon_ratio_of_ta * Math.max(cur.bs.TA, 1), 1);

	// CSE epsilon: same approach as NOA — protect against near-zero denominators.
	// Use 1 Cr absolute floor + 0.5% of TA relative floor.
	const cseSmall = Math.abs(avgCSE) < Math.max(0.005 * Math.max(cur.bs.TA, 1), 1);
	const ROCE = !cseSmall && avgCSE > 0 ? cur.is.CNI / avgCSE : null;
	const RNOA = !noaSmall ? cur.is.OI / avgNOA : null;
	const NBC = Math.abs(avgNFO) > 1 ? cur.is.NFE / avgNFO : null;
	const SPREAD = RNOA != null && NBC != null ? RNOA - NBC : null;
	const FLEV = !cseSmall && cur.bs.CSE > 0 ? cur.bs.NFO / cur.bs.CSE : null;
	const FLEV_bridge = !cseSmall ? avgNFO / avgCSE : null;

  const PM = cur.is.Sales > 0 ? cur.is.OI / cur.is.Sales : null;
  const ATO = !noaSmall ? cur.is.Sales / avgNOA : null;
  const ATO_star = avgOA > 0 ? cur.is.Sales / avgOA : null;
  const SalesPM = cur.is.Sales > 0 ? cur.is.OI_from_sales / cur.is.Sales : null;
  const OtherItemsRatio = !noaSmall ? cur.is.OtherItems / avgNOA : null;
  const ROCE_bridge_residual =
    ROCE != null && SalesPM != null && ATO != null && OtherItemsRatio != null && FLEV_bridge != null && SPREAD != null
      ? ROCE - (SalesPM * ATO + OtherItemsRatio + FLEV_bridge * SPREAD)
      : null;

  // S-17.1: OLLEV decomposition — split OL into free vs. interest-bearing
  // Free OL (trade payables, provisions, deferred revenue) has ~0 implicit cost
  // Interest-bearing OL (pensions, lease payables) carries financing cost like debt
  const explicitOL = cur.bs.OL_TradePayables
    + cur.bs.OL_OtherCurrentLiabilities
    + cur.bs.OL_ProvisionsCurrent
    + cur.bs.OL_ProvisionsLongTerm
    + cur.bs.OL_CurrentTaxLiabilities
    + cur.bs.OL_NonCurrentTaxLiabilities
    + cur.bs.OL_DeferredTaxLiabilitiesNet
    + cur.bs.OL_OtherNonCurrentLiabilities;

 // Interest-bearing OL: Pensions. Lease liabilities are classified as FO
 // (financial obligations) per the BS reformulation — they are NOT in OL,
 // so they must NOT be double-counted here. The financing cost of leases
 // is already captured via NFE/NBC.
 const leaseLiab = 0; // intentionally 0: leases are in FO, not OL
 const pensionObl = cur.bs.PensionObl ?? 0;
 const prevLeaseLiab = 0;
  const prevPensionObl = prev.bs.PensionObl ?? 0;
  const avgInterestBearingOL = (leaseLiab + pensionObl + prevLeaseLiab + prevPensionObl) / 2;
  const avgExplicitOL = explicitOL > 0 ? explicitOL : cur.bs.OL;
  const prevExplicitOL = (() => {
    const ex = prev.bs.OL_TradePayables + prev.bs.OL_OtherCurrentLiabilities
      + prev.bs.OL_ProvisionsCurrent + prev.bs.OL_ProvisionsLongTerm
      + prev.bs.OL_CurrentTaxLiabilities + prev.bs.OL_NonCurrentTaxLiabilities
      + prev.bs.OL_DeferredTaxLiabilitiesNet + prev.bs.OL_OtherNonCurrentLiabilities;
    return ex > 0 ? ex : prev.bs.OL;
  })();
  const avgFreeOL = (avgExplicitOL + prevExplicitOL) / 2 - avgInterestBearingOL;
  const freeOL_val = Math.max(0, avgFreeOL);
  const interestBearingOL_val = Math.max(0, avgInterestBearingOL);

  // S-17.1: OLLEV decomposition closure identity
  // Pure ROOA without imputed interest add-back — this is the OI/avgOA baseline
  // that closes with OLLEV when combined with the free-OL leverage effect.
  const ROOA_pure = avgOA > 0 ? cur.is.OI / avgOA : null;
  const avgOL_total = (cur.bs.OL + prev.bs.OL) / 2;
  const OLLEV = !noaSmall && avgNOA !== 0 ? avgOL_total / avgNOA : null;

  // Leverage decomposition: free OL as a source of operating leverage
  const OLLEV_OA = avgNOA !== 0 ? freeOL_val / avgNOA : null;
  const OLSPREAD = ROOA_pure != null ? ROOA_pure - 0 : null; // free OL implicit rate ≈ 0
  const OLLEV_check = ROOA_pure != null && OLLEV_OA != null && OLSPREAD != null
    ? ROOA_pure + OLLEV_OA * OLSPREAD
    : null;
  const RNOA_check = OLLEV_check;

  // Diagnostic: imputed interest on OL (for reporting, not used in closure)
  const avgOLexDTL = avg(cur.bs.OL_ex_DTL, prev.bs.OL_ex_DTL);
  const io = cfg.risk_free_rate * avgOLexDTL;
  const ROOA_spec = ROOA_pure;
  const imputed_io_spec = io;

  // S-17.1: Report residual when interestBearingOL > 0 (identity won't close exactly)
  // When interestBearingOL = 0, this residual should be ~0 (within 0.1%)
  const RNOA_vs_OLLEV_residual = RNOA != null && RNOA_check != null
    ? RNOA - RNOA_check
    : null;

  const avgTCE = avg(cur.bs.NOA + cur.bs.MI, prev.bs.NOA + prev.bs.MI);
  const ROTCE = avgTCE > 0 ? cur.is.OI / avgTCE : null;
  const MSR = cur.bs.CSE > 0 && (cur.is.CNI + cur.is.MII) !== 0
    ? (cur.is.CNI / (cur.is.CNI + cur.is.MII)) / (cur.bs.CSE / (cur.bs.CSE + cur.bs.MI))
    : null;

  const coreOIFromSales = cur.cu.CoreOI - cur.is.OtherItems;
  const CoreSalesPM = cur.is.Sales > 0 ? coreOIFromSales / cur.is.Sales : null;
  // Use NOA denominator for Eq.16 bridge consistency (field name retained for backward compatibility)
  const CoreOtherItems_OA = !noaSmall ? cur.is.OtherItems / avgNOA : null;
  const UOI_OA = !noaSmall ? cur.cu.UOI / avgNOA : null;
	const CoreNBC = Math.abs(avgNFO) > 1 ? cur.cu.CoreNFE / avgNFO : null;
	const UFE_NFO = Math.abs(avgNFO) > 1 ? cur.cu.UFE / avgNFO : null;
  const CoreRNOA = !noaSmall ? cur.cu.CoreOI / avgNOA : null;
  const CoreSPREAD = CoreRNOA != null && CoreNBC != null ? CoreRNOA - CoreNBC : null;
  let ROCE_eq16_reconstructed: number | null = null;
  if (CoreSalesPM != null && ATO != null && CoreOtherItems_OA != null && UOI_OA != null && FLEV_bridge != null && CoreSPREAD != null && UFE_NFO != null) {
    const msrBridge = MSR ?? 1;
    // Eq.16 (NOA-based decomposition):
    // RNOA = CoreSalesPM*ATO + CoreOtherItems/NOA + UOI/NOA
    // ROCE = RNOA + FLEV*(SPREAD) = RNOA + FLEV*(CoreSPREAD + UOI/NOA - UFE/NFO)
    // NOTE: OLLEV×OLSPREAD is an *alternative* decomposition of RNOA (OA-based), not additive here.
    ROCE_eq16_reconstructed = msrBridge * (
      (CoreSalesPM * ATO)
      + CoreOtherItems_OA
      + UOI_OA
      + (FLEV_bridge * (CoreSPREAD + UOI_OA - UFE_NFO))
    );
  }
  const ROCE_eq16_error = ROCE != null && ROCE_eq16_reconstructed != null ? ROCE - ROCE_eq16_reconstructed : null;

  // §5.7 Stepped Eq.16 residual diagnosis
  const eq16ResidualThresholdWarn = cfg.eq16_residual_warning ?? 0.05;
  const eq16ResidualThresholdCrit = cfg.eq16_residual_critical ?? 0.15;
	const eq16_flag: "OK" | "WARNING" | "CRITICAL" =
		ROCE_eq16_error == null ? "OK"
		: Math.abs(ROCE_eq16_error) <= eq16ResidualThresholdWarn ? "OK"
		: Math.abs(ROCE_eq16_error) <= eq16ResidualThresholdCrit ? "WARNING"
		: "CRITICAL";

  // step1: RNOA − PM×ATO (DuPont closure)
  const eq16_step1 = RNOA != null && PM != null && ATO != null ? RNOA - (PM * ATO) : null;
  // step2: ROCE − (RNOA + FLEV×SPREAD) (leverage closure)
  const eq16_step2 = ROCE != null && RNOA != null && FLEV_bridge != null && SPREAD != null
    ? ROCE - (RNOA + FLEV_bridge * SPREAD) : null;
  // step3: (RNOA + FLEV×SPREAD) − ROCE_eq16 (full decomposition residual)
  const eq16_step3 = ROCE_eq16_reconstructed != null && RNOA != null && FLEV_bridge != null && SPREAD != null
    ? (RNOA + FLEV_bridge * SPREAD) - ROCE_eq16_reconstructed : null;

  let eq16_diagnosis: string | null = null;
  if (eq16_flag === "CRITICAL" && eq16_step1 != null && eq16_step2 != null && eq16_step3 != null) {
    const steps = [Math.abs(eq16_step1), Math.abs(eq16_step2), Math.abs(eq16_step3)];
    const maxIdx = steps.indexOf(Math.max(...steps));
    eq16_diagnosis = [
      "PM × ATO does not reproduce RNOA — likely averaging mismatch between Sales/NOA and OI/NOA",
      "RNOA + FLEV × SPREAD does not reproduce ROCE — cross-product terms from within-period balance sheet changes",
      "Full Eq.16 decomposition introduces additional error — unusual items or OL leverage interaction terms",
    ][maxIdx]!;
  }

  // S-9.4C: prefer the period's structural kw (stamped by the pipeline)
  // over the config-derived 80/20 fallback. The structural value reflects
  // the period's actual capital weights; deriveKwFromConfig only uses it
  // as a last-resort when the pipeline hasn't stamped a value yet (e.g.
  // single-period datasets where deriveKwFromStructure is undefined).
  const kwForRequiredReturn = (cur.kwStructural != null && Number.isFinite(cur.kwStructural) && cur.kwStructural > 0)
    ? cur.kwStructural
    : deriveKwFromConfig(cfg);
  const required_return_per_sales = ATO != null && ATO !== 0 ? kwForRequiredReturn / ATO : null;
  const value_creating_margin = PM != null && required_return_per_sales != null ? PM - required_return_per_sales : null;

  const CSE_eq8_check = cur.is.Sales > 0 && ATO != null && FLEV != null ? cur.is.Sales / ATO / (1 + FLEV) : null;
  const CSE_eq8_error_pct = CSE_eq8_check != null && cur.bs.CSE > 0 ? Math.abs(cur.bs.CSE - CSE_eq8_check) / cur.bs.CSE : null;

  const current_ratio = cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : null;
  const quick_ratio = cur.bs.CurrentLiabilities > 0 ? (cur.bs.CurrentAssets - cur.bs.Inventory) / cur.bs.CurrentLiabilities : null;
  const days_receivable = cur.is.Sales > 0 ? avg(cur.bs.TradeReceivables, prev.bs.TradeReceivables) / cur.is.Sales * 365 : null;
  const cogsDenom = Math.abs(cur.is.COGS) > 1 ? Math.abs(cur.is.COGS) : cur.is.Sales;
  const days_payable = cogsDenom > 0 ? avg(cur.bs.TradePayables, prev.bs.TradePayables) / cogsDenom * 365 : null;
  const days_inventory = cogsDenom > 0 ? avg(cur.bs.Inventory, prev.bs.Inventory) / cogsDenom * 365 : null;
  const cash_conversion_cycle = days_receivable != null && days_payable != null && days_inventory != null ? days_receivable + days_inventory - days_payable : null;

  const accrual_ratio_bs = Math.abs(avgNOA) > 1 ? (cur.bs.NOA - prev.bs.NOA) / Math.abs(avgNOA) : null;
  const accrual_ratio_cf = avgTA > 0 ? (cur.is.CNI - cur.cf.CFO) / avgTA : null;
  const cash_conversion_ratio = cur.is.OI !== 0 ? cur.cf.CFO / cur.is.OI : null;
  const interest_coverage = Math.abs(cur.is.NFE) > 0.1 ? cur.is.OI / Math.abs(cur.is.NFE) : null;

  const NOA_growth = prev.bs.NOA !== 0 ? (cur.bs.NOA - prev.bs.NOA) / Math.abs(prev.bs.NOA) : null;
  const CNI_growth = prev.is.CNI !== 0 ? (cur.is.CNI - prev.is.CNI) / Math.abs(prev.is.CNI) : null;
  const OI_growth = prev.is.OI !== 0 ? (cur.is.OI - prev.is.OI) / Math.abs(prev.is.OI) : null;
  const Sales_growth = prev.is.Sales !== 0 ? (cur.is.Sales - prev.is.Sales) / Math.abs(prev.is.Sales) : null;

  // S-5.1: Dirty surplus for this period (requires prev CSE).
  // Clean-surplus identity: ΔCSE = CNI − (Div + Buy − Iss), so the dirty-surplus
  // residual (the ΔCSE NOT explained by income + owner transactions) is
  //   ΔCSE − CNI + Div + Buy − Iss.
  // Dividends and buybacks both return cash to owners (add back); share issuance
  // raises equity without transiting the P&L (subtract). Omitting Iss/Buy — as
  // the prior dividends-only form did — misclassifies issuance and buybacks as
  // dirty surplus; on ITC this overstated the FY23/FY24 residual by 2–4% of CSE.
  // Fields are positive magnitudes: DividendPaid/ShareBuybacks via Math.abs,
  // EquityIssued = positive issue proceeds.
  const ΔCSE_t = cur.bs.CSE - prev.bs.CSE;
  const dirty_surplus = ΔCSE_t - cur.is.CNI + cur.cf.DividendPaid + cur.cf.ShareBuybacks - cur.cf.EquityIssued;
  const dirty_surplus_pct_cse = Math.abs(prev.bs.CSE) > 1
    ? Math.abs(dirty_surplus) / Math.abs(prev.bs.CSE)
    : null;

  // S-6.3: Accrual regime classification
  let accrual_regime: Ratios["accrual_regime"] = null;
  if (accrual_ratio_bs != null) {
    const ΔNOA_pct = Math.abs(prev.bs.NOA) > 1 ? (cur.bs.NOA - prev.bs.NOA) / Math.abs(prev.bs.NOA) : 0;
    const ΔFA_pct  = prev.bs.FA > 1 ? (cur.bs.FA - prev.bs.FA) / prev.bs.FA : 0;
    if (Math.abs(accrual_ratio_bs) <= 0.10) {
      accrual_regime = "NORMAL";
    } else if (accrual_ratio_bs > 0.10) {
      accrual_regime = ΔNOA_pct > 0.10 ? "GROWTH_ACCRUAL" : "QUALITY_ACCRUAL";
    } else {
      if (ΔFA_pct > 0.10) accrual_regime = "CASH_ACCUMULATION";
      else if (ΔNOA_pct < -0.10) accrual_regime = "ASSET_DISPOSAL";
      else accrual_regime = "CASH_GENERATION";
    }
  }

  return {
    ROCE, RNOA, NBC, SPREAD, FLEV,
    PM, ATO, ATO_star, SalesPM, OtherItemsRatio, ROCE_bridge_residual,
    io, ROOA: ROOA_pure, OLLEV, OLSPREAD, RNOA_check,
    ROOA_spec,
    imputed_io_spec,
    freeOL: freeOL_val,
    interestBearingOL: interestBearingOL_val,
    OLLEV_check,
    RNOA_vs_OLLEV_residual,
    ROTCE, MSR,
    CoreSalesPM, CoreOtherItems_OA, UOI_OA, CoreNBC, UFE_NFO, CoreSPREAD,
    ROCE_eq16_reconstructed, ROCE_eq16_error,
    eq16_step1_residual: eq16_step1,
    eq16_step2_residual: eq16_step2,
    eq16_step3_residual: eq16_step3,
    eq16_flag,
    eq16_diagnosis,
    required_return_per_sales, value_creating_margin,
    CSE_eq8_check, CSE_eq8_error_pct,
    current_ratio, quick_ratio,
    days_receivable, days_payable, days_inventory, cash_conversion_cycle,
    accrual_ratio_bs, accrual_ratio_cf, cash_conversion_ratio,
    interest_coverage,
    NOA_growth, CNI_growth, OI_growth, Sales_growth,
    noaSmall,
    separationScore: cur.bs.separationScore,
    accrual_regime,
    dirty_surplus,
    dirty_surplus_pct_cse,
    // Phase E2 — IT-services overlay
    employeeCostRatio: (cur.is.operatingCostBridge?.employeeCost != null && cur.is.Sales > 0)
      ? cur.is.operatingCostBridge.employeeCost / cur.is.Sales
      : null,
  };
}

export function computeResidualIncome(cur: RecastPeriod, prev: RecastPeriod, ke: number, kw: number): ResidualIncome {
  return {
    RE: cur.is.CNI - ke * prev.bs.CSE,
    ReOI: cur.is.OI - kw * prev.bs.NOA,
  };
}

/** Estimate AR(1) persistence coefficient on a numeric series.
 *  Uses OLS: y_t = alpha + phi * y_{t-1} + eps
 *  Returns { phi, r_squared, n }. Falls back to { phi: 0.8, r_squared: 0, n } for short series.
 */
export function estimateArPhi(series: number[]): { phi: number; alpha: number; r_squared: number; n: number } {
  if (series.length < 3) return { phi: 0.8, alpha: 0, r_squared: 0, n: series.length };
  const X = series.slice(0, -1);
  const Y = series.slice(1);
  const n = X.length;
  const meanX = X.reduce((s, v) => s + v, 0) / n;
  const meanY = Y.reduce((s, v) => s + v, 0) / n;
  const cov = X.reduce((s, v, i) => s + (v - meanX) * (Y[i]! - meanY), 0) / n;
  const varX = X.reduce((s, v) => s + (v - meanX) ** 2, 0) / n;
  const phi = varX > 0 ? Math.max(0, Math.min(0.98, cov / varX)) : 0.8;
  const alpha = meanY - phi * meanX;
  const ss_res = Y.reduce((s, y, i) => s + (y - (alpha + phi * X[i]!)) ** 2, 0);
  const ss_tot = Y.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const r2 = ss_tot > 0 ? Math.max(0, 1 - ss_res / ss_tot) : 0;
  return { phi, alpha, r_squared: r2, n };
}

/** S-11.1: AR(1) Ohlson reversion-based continuing value.
 *  CV_reversion = RE_T * phi / (1 + ke - phi)
 *  More defensible than Gordon growth when growth rate g is uncertain.
 */
export function cvReversion(RE_T: number, phi: number, ke: number): number {
  const denom = 1 + ke - phi;
  if (denom <= 0.01 || RE_T === 0) return 0;
  return RE_T * phi / denom;
}
