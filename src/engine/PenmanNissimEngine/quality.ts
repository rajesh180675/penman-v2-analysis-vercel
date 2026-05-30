/* ================================================================
   PenmanNissimEngine decomposition — quality / distress metrics
   (Piotroski F-Score, Beneish M-Score, Altman Z', Zmijewski, Ohlson O,
   Sloan/Richardson accruals, earnings-quality flags).

   Lifted verbatim from src/engine/PenmanNissimEngine.ts. Imports DOWN
   from ./picking (valBS/valPL/stdNormCdf), ../types, and ../mappingSpec.
   The parent re-exports computeQuality so external import paths are
   unchanged. Behaviour byte-for-byte identical.
================================================================ */

import {
  RawPeriodData,
  QualityMetrics,
  RecastPeriod,
} from "../types";
import { CapitalineMappingSpec as M } from "../mappingSpec";
import { stdNormCdf, valBS, valPL } from "./picking";

export function computeQuality(cur: RecastPeriod, prev: RecastPeriod, data: RawPeriodData, prevData: RawPeriodData): QualityMetrics {
  const TL_cur = cur.bs.TA - cur.bs.CSE - cur.bs.MI;
  const TL_prev = prev.bs.TA - prev.bs.CSE - prev.bs.MI;
  const safe = (n: number, d: number, fb = 1) => (d !== 0 && Number.isFinite(n / d) ? n / d : fb);

  const cogs = (d: RawPeriodData) => {
    const direct = valPL(d, M.profitLoss.cogsMaterial) + valPL(d, M.profitLoss.cogsPurchases) - valPL(d, M.profitLoss.cogsInventoryChange);
    if (direct !== 0) return direct;
    return valPL(d, M.profitLoss.totalExpenses) - valPL(d, M.profitLoss.employeeExpense) - valPL(d, M.profitLoss.otherExpenses) - valPL(d, M.profitLoss.depreciationAmortization);
  };
  const sga = (d: RawPeriodData) => {
    const detailed = valPL(d, M.profitLoss.employeeExpense)
      + valPL(d, M.profitLoss.sgaAds)
      + valPL(d, M.profitLoss.sgaLegal)
      + valPL(d, M.profitLoss.sgaRent)
      + valPL(d, M.profitLoss.sgaFreight)
      + valPL(d, M.profitLoss.sgaRepairs)
      + valPL(d, M.profitLoss.sgaPower);
    return detailed > 0 ? detailed : valPL(d, M.profitLoss.employeeExpense) + valPL(d, M.profitLoss.otherExpenses);
  };

  const cogsCur = cur.is.operatingCostBridge?.materialCost ?? (cur.is.COGS !== 0 ? cur.is.COGS : cogs(data));
  const cogsPrev = prev.is.operatingCostBridge?.materialCost ?? (prev.is.COGS !== 0 ? prev.is.COGS : cogs(prevData));
  const gmCur = cur.is.Sales > 0 ? (cur.is.Sales - cogsCur) / cur.is.Sales : 0;
  const gmPrev = prev.is.Sales > 0 ? (prev.is.Sales - cogsPrev) / prev.is.Sales : 0;

  const roaCur = cur.bs.TA > 0 ? cur.is.PAT / cur.bs.TA : 0;
  const roaPrev = prev.bs.TA > 0 ? prev.is.PAT / prev.bs.TA : 0;
  const p_roa = roaCur > 0 ? 1 : 0;
  const p_delta_roa = roaCur > roaPrev ? 1 : 0;
  const p_cfo = cur.cf.CFO > 0 ? 1 : 0;
  const niCur = cur.is.PAT - cur.cu.ExceptionalItemsAfterTax;
  const roaCurLag = prev.bs.TA > 0 ? niCur / prev.bs.TA : 0;
  const p_accrual = prev.bs.TA > 0 && cur.cf.CFO / prev.bs.TA > roaCurLag ? 1 : 0;
  const ltDebtCur = valBS(data, ["Long Term Borrowings"]);
  const ltDebtPrev = valBS(prevData, ["Long Term Borrowings"]);
  const p_leverage = (cur.bs.TA > 0 ? ltDebtCur / cur.bs.TA : 0) < (prev.bs.TA > 0 ? ltDebtPrev / prev.bs.TA : 0) ? 1 : 0;
  const p_liquidity = (cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : 0) > (prev.bs.CurrentLiabilities > 0 ? prev.bs.CurrentAssets / prev.bs.CurrentLiabilities : 0) ? 1 : 0;
  const p_dilution = cur.cf.EquityIssued <= 0 ? 1 : 0;
  const p_margin = gmCur > gmPrev ? 1 : 0;
  const p_turnover = (cur.bs.TA > 0 ? cur.is.Sales / cur.bs.TA : 0) > (prev.bs.TA > 0 ? prev.is.Sales / prev.bs.TA : 0) ? 1 : 0;
  const piotroski_total = p_roa + p_delta_roa + p_cfo + p_accrual + p_leverage + p_liquidity + p_dilution + p_margin + p_turnover;

  const dsri = safe(safe(cur.bs.TradeReceivables, cur.is.Sales), safe(prev.bs.TradeReceivables, prev.is.Sales));
  const gmi = safe(gmPrev, gmCur);
  const hardAssetsCur = cur.bs.PPE + cur.bs.Goodwill + cur.bs.CurrentAssets;
  const hardAssetsPrev = prev.bs.PPE + prev.bs.Goodwill + prev.bs.CurrentAssets;
  const aqiNum = cur.bs.TA > 0 ? 1 - hardAssetsCur / cur.bs.TA : 0;
  const aqiDen = prev.bs.TA > 0 ? 1 - hardAssetsPrev / prev.bs.TA : 0;
  const aqi = aqiDen !== 0 ? aqiNum / aqiDen : 0;
  const sgi = safe(cur.is.Sales, prev.is.Sales);
  const depi = safe(
    prev.bs.PPE > 0 ? valPL(prevData, M.profitLoss.depreciationAmortization) / prev.bs.PPE : 0,
    cur.bs.PPE > 0 ? valPL(data, M.profitLoss.depreciationAmortization) / cur.bs.PPE : 0
  );
  // SGAI: SGA intensity ratio. Default to 1.0 (neutral) when SGA not measurable to avoid biasing M-Score.
  const sgaCur = cur.is.operatingCostBridge?.sgaTotal ?? sga(data);
  const sgaPrev = prev.is.operatingCostBridge?.sgaTotal ?? sga(prevData);
  const sgaRatioCur = sgaCur > 0 && cur.is.Sales > 0 ? sgaCur / cur.is.Sales : null;
  const sgaRatioPrev = sgaPrev > 0 && prev.is.Sales > 0 ? sgaPrev / prev.is.Sales : null;
  const sgai = sgaRatioCur != null && sgaRatioPrev != null && sgaRatioPrev > 0
    ? sgaRatioCur / sgaRatioPrev
    : 1.0; // neutral when data unavailable
  const lvgi = safe(TL_cur / Math.max(cur.bs.TA, 1), TL_prev / Math.max(prev.bs.TA, 1));
  const tata = prev.bs.TA > 0 ? ((cur.is.PAT - cur.cu.ExceptionalItemsAfterTax) - cur.cf.CFO) / prev.bs.TA : 0;
  // Beneish M-Score (1999) — eight-variable model for earnings manipulation detection.
  // Coefficients from: Beneish, M.D. (1999). "The Detection of Earnings Manipulation."
  // Financial Analysts Journal, 55(5), 24–36. Table 4, Model 1 (probit).
  const beneish_mscore = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;

  const wc = cur.bs.CurrentAssets - cur.bs.CurrentLiabilities;
  const re1 = valBS(data, ["Unappropriated Profits Carried Forward"]);
  const re2 = valBS(data, ["Unappropriated Profits Brought Forward"]);
  const re3 = valBS(data, ["Other Equity"]);
  const reProxy = re1 || re2 || re3;
  const reProxyLowConfidence = reProxy !== 0 && re1 === 0 && re2 === 0;
  const pbt = valPL(data, M.profitLoss.pbt);
  const exceptionalPretax = valPL(data, M.profitLoss.exceptionalItems) + valPL(data, M.profitLoss.extraordinaryItems);
  const ebit = pbt > 0
    ? pbt + cur.is.FinanceCost - exceptionalPretax
    : (cur.is.taxRate < 0.99 ? cur.is.OI / (1 - cur.is.taxRate) : cur.is.OI);
  const bve = cur.bs.CSE + cur.bs.MI;
  const z_wc_ta = cur.bs.TA > 0 ? wc / cur.bs.TA : 0;
  const z_re_ta = cur.bs.TA > 0 ? reProxy / cur.bs.TA : 0;
  const z_ebit_ta = cur.bs.TA > 0 ? ebit / cur.bs.TA : 0;
  const z_bve_tl = TL_cur > 0 ? bve / TL_cur : 0;
  const z_s_ta = cur.bs.TA > 0 ? cur.is.Sales / cur.bs.TA : 0;
  // Altman Z'-Score (1993) — revised model for private/non-manufacturing firms.
  // Coefficients from: Altman, E.I. (1993). Corporate Financial Distress and
  // Bankruptcy. 2nd ed., Wiley. Chapter 8 (Z'-Score replaces market cap/TL
  // with BVE/TL for non-public applicability).
  const altman_zprime = 0.717 * z_wc_ta + 0.847 * z_re_ta + 3.107 * z_ebit_ta + 0.420 * z_bve_tl + 0.998 * z_s_ta;

  // Zmijewski (1984)
  const zm_roa = cur.bs.TA > 0 ? cur.is.PAT / cur.bs.TA : 0;
  const zm_lev = cur.bs.TA > 0 ? TL_cur / cur.bs.TA : 0;
  const zm_liq = cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : 0;
  // Zmijewski (1984) — probit bankruptcy prediction model.
  // Coefficients from: Zmijewski, M.E. (1984). "Methodological Issues Related
  // to the Estimation of Financial Distress Prediction Models."
  // Journal of Accounting Research, 22(Supplement), 59–82. Table 2.
  const zm_x = -4.336 - 4.513 * zm_roa + 5.679 * zm_lev + 0.004 * zm_liq;
  const zm_prob = stdNormCdf(zm_x);

  // Ohlson (1980) adapted for India scale
  const wcTa = cur.bs.TA > 0 ? wc / cur.bs.TA : 0;
  const niTa = cur.bs.TA > 0 ? niCur / cur.bs.TA : 0;
  const clCa = cur.bs.CurrentAssets > 0 ? cur.bs.CurrentLiabilities / cur.bs.CurrentAssets : 0;
  const cfoTl = TL_cur > 0 ? cur.cf.CFO / TL_cur : 0;
  const intwo = niCur < 0 && (prev.is.PAT - prev.cu.ExceptionalItemsAfterTax) < 0 ? 1 : 0;
  const oeneg = TL_cur > cur.bs.TA ? 1 : 0;
  const chinDen = Math.abs(niCur) + Math.abs(prev.is.PAT - prev.cu.ExceptionalItemsAfterTax);
  const chin = chinDen > 0 ? (niCur - (prev.is.PAT - prev.cu.ExceptionalItemsAfterTax)) / chinDen : 0;
  const size = Math.log(Math.max(cur.bs.TA, 1));
  // Ohlson O-Score (1980) — logit bankruptcy prediction model, adapted for India.
  // Coefficients from: Ohlson, J.A. (1980). "Financial Ratios and the
  // Probabilistic Prediction of Bankruptcy." Journal of Accounting Research,
  // 18(1), 109–131. Table 4, Model 1.
  const oScore =
    -1.32
    - 0.407 * size
    + 6.03 * (cur.bs.TA > 0 ? TL_cur / cur.bs.TA : 0)
    - 1.43 * wcTa
    + 0.0757 * clCa
    - 2.37 * niTa
    - 1.83 * cfoTl
    + 0.285 * intwo
    - 1.72 * oeneg
    - 0.521 * chin;
  const oProb = 1 / (1 + Math.exp(-oScore));

  // Sloan / Richardson decomposition (approximate with available fields)
  const cashCur = valBS(data, ["Cash and Cash Equivalents", "Bank Balances Other Than Cash and Cash Equivalents"]);
  const cashPrev = valBS(prevData, ["Cash and Cash Equivalents", "Bank Balances Other Than Cash and Cash Equivalents"]);
  const dCA = cur.bs.CurrentAssets - prev.bs.CurrentAssets;
  const dCash = cashCur - cashPrev;
  const dCL = cur.bs.CurrentLiabilities - prev.bs.CurrentLiabilities;
  const stDebtCur = valBS(data, ["Short Term Borrowings"]);
  const stDebtPrev = valBS(prevData, ["Short Term Borrowings"]);
  const dSTDebt = stDebtCur - stDebtPrev;
  const taxPayCur = valBS(data, ["Current Tax Liabilities - Short-term"]);
  const taxPayPrev = valBS(prevData, ["Current Tax Liabilities - Short-term"]);
  const dTaxPay = taxPayCur - taxPayPrev;
  const wcAccr = dCA - dCash - dCL + dSTDebt + dTaxPay;
  const totalAccr = cur.bs.NOA - prev.bs.NOA;
  const ltAccr = totalAccr - wcAccr;
  const reliability = 1 - Math.min(1, Math.abs(ltAccr) / Math.max(Math.abs(totalAccr), 1));

  const ceqiVals = [cur.cf.CFO / Math.max(cur.is.PAT, 1e-6), prev.cf.CFO / Math.max(prev.is.PAT, 1e-6)].filter((v) => Number.isFinite(v));
  const ceqi = ceqiVals.length ? ceqiVals.reduce((s, v) => s + v, 0) / ceqiVals.length : null;
  const salesDelta = prev.is.Sales !== 0 ? (cur.is.Sales - prev.is.Sales) / Math.abs(prev.is.Sales) : null;
  const oiDelta = prev.is.OI !== 0 ? (cur.is.OI - prev.is.OI) / Math.abs(prev.is.OI) : null;
  const dol = salesDelta && salesDelta !== 0 && oiDelta != null ? oiDelta / salesDelta : null;

  // Conservative accounting proxy (India adaptation): lower Net/Gross PPE may indicate more conservative depreciation
  const grossPpeCur = valBS(data, ["Gross Property, plant and equipment"]);
  const netPpeCur = cur.bs.PPE;
  const ppeAgeRatio = grossPpeCur > 0 ? netPpeCur / grossPpeCur : null;
  const conservativeScore = ppeAgeRatio == null ? null : Math.max(0, Math.min(100, (1 - ppeAgeRatio) * 100));

  // Revenue-recognition quality flags
  const dsoCur = cur.ratios?.days_receivable ?? null;
  const dsoPrev = prev.ratios?.days_receivable ?? null;
  const dsoDelta = dsoCur != null && dsoPrev != null ? dsoCur - dsoPrev : null;
  const flags: string[] = [];
  if (dsoDelta != null && dsoDelta > 8 && salesDelta != null && salesDelta < 0.1) {
    flags.push("WARN: DSO rising faster than sales growth; potential revenue-quality/credit-risk signal.");
  }
  if ((cur.ratios?.accrual_ratio_bs ?? 0) > 0.1) {
    flags.push("WARN: BS accrual ratio above 10%; cash conversion risk elevated.");
  }
  if (ceqi != null && ceqi < 0.7) {
    flags.push("WARN: CEQI below 0.7; earnings less cash-confirmable.");
  }

  return {
    piotroski_roa: p_roa,
    piotroski_delta_roa: p_delta_roa,
    piotroski_cfo: p_cfo,
    piotroski_accrual: p_accrual,
    piotroski_leverage: p_leverage,
    piotroski_liquidity: p_liquidity,
    piotroski_dilution: p_dilution,
    piotroski_margin: p_margin,
    piotroski_turnover: p_turnover,
    piotroski_total,
    beneish_dsri: dsri,
    beneish_gmi: gmi,
    beneish_aqi: aqi,
    beneish_sgi: sgi,
    beneish_depi: depi,
    beneish_sgai: sgai,
    beneish_lvgi: lvgi,
    beneish_tata: tata,
    beneish_mscore,
    altman_wc_ta: z_wc_ta,
    altman_re_ta: z_re_ta,
    altman_ebit_ta: z_ebit_ta,
    altman_bve_tl: z_bve_tl,
    altman_s_ta: z_s_ta,
    altman_zprime,
    altman_re_proxy_low_confidence: reProxyLowConfidence,
    zmijewski_roa: zm_roa,
    zmijewski_leverage: zm_lev,
    zmijewski_liquidity: zm_liq,
    zmijewski_xscore: zm_x,
    zmijewski_prob_distress: zm_prob,
    ohlson_size: size,
    ohlson_leverage: cur.bs.TA > 0 ? TL_cur / cur.bs.TA : 0,
    ohlson_liquidity: clCa,
    ohlson_roe_neg: intwo === 1,
    ohlson_chin: chin,
    ohlson_oscore: oScore,
    ohlson_prob_distress: oProb,
    sloan_wc_accruals: wcAccr,
    sloan_lt_accruals: ltAccr,
    sloan_total_accruals: totalAccr,
    accrual_reliability_score: reliability,
    operating_leverage: dol,
    cash_earnings_quality_index: ceqi,
    conservative_accounting_score: conservativeScore,
    revenue_quality_flags: flags,
  };
}
