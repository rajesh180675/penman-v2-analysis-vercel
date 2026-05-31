import {
  RawPeriodData,
  RecastPeriod,
  EngineConfig,
  TraceMap,
} from "./types";

// Recast layer (balance sheet, income, cash flow) + missing-line flagging +
// reconciliation-residual debug capture moved to ./PenmanNissimEngine/recast;
// imported DOWN. Parent re-exports the public recast surface so external import
// paths are unchanged, and computeRecastPeriod (below) orchestrates them.
import {
  recastBalanceSheet,
  recastIncome,
  recastCashFlow,
  buildMissingRequiredLineFlags,
  extractRecastDebug,
} from "./PenmanNissimEngine/recast";
export { recastBalanceSheet, recastIncome, recastCashFlow };

// Pick/extraction primitives (share-count extraction consumed below) moved to
// ./PenmanNissimEngine/picking; imported DOWN.
import { extractShareCountInput } from "./PenmanNissimEngine/picking";

// Quality / distress metrics moved to ./PenmanNissimEngine/quality; imported
// DOWN. Parent re-exports so external import paths are unchanged.
import { computeQuality } from "./PenmanNissimEngine/quality";
export { computeQuality };

export function computeRecastPeriod(data: RawPeriodData, cfg: EngineConfig, prevPeriod?: RecastPeriod): RecastPeriod {
  const trace: TraceMap = {};
  const bs = recastBalanceSheet(data, cfg, trace);
  const { is_, cu } = recastIncome(data, bs, cfg, trace);
  const cf = recastCashFlow(data, is_, bs, prevPeriod?.bs, trace);
  const spec_flags = buildMissingRequiredLineFlags(trace, data.period_end);
  const recastDebug = extractRecastDebug(data, bs);
  return {
    period_end: data.period_end,
    bs,
    is: is_,
    cu,
    cf,
    trace,
    shareCountInput: extractShareCountInput(data),
    recastDebug,
    ...(spec_flags.length > 0 ? { spec_flags } : {}),
  };
}

// Post-recast analytical computations (ratios, residual income, AR(1)
// persistence + reversion) moved to ./PenmanNissimEngine/ratiosResidual;
// imported DOWN. Parent re-exports so external import paths are unchanged,
// and computeValuation (below) consumes estimateArPhi + cvReversion as values.
import {
  computeRatios,
  computeResidualIncome,
  estimateArPhi,
  cvReversion,
} from "./PenmanNissimEngine/ratiosResidual";
export { computeRatios, computeResidualIncome, estimateArPhi, cvReversion };

export function deriveKwFromStructure(cur: RecastPeriod, prev: RecastPeriod, ke: number, riskFreeRate: number, cfg?: EngineConfig): number {
  // S-9.4: kw = ke × (CSE+MI)/NOA + kd_aftertax × NFO/NOA
  // kw is ALWAYS derived from balance-sheet weights — NEVER a config input (Invariant 5)
  const NOA_latest = Math.abs(cur.bs.NOA);
  if (NOA_latest <= 0) return ke;

  const weight_CSE_MI = (cur.bs.CSE + cur.bs.MI) / NOA_latest;
  const weight_NFO    = cur.bs.NFO / NOA_latest;

  // kd_aftertax: prefer config (S-9.4 compliance), then infer from finance cost
  let kdAfterTax: number;
  if (cfg && cfg.kd_pretax > 0) {
    kdAfterTax = cfg.kd_pretax * (1 - (cfg.tax_rate_for_kd ?? cfg.statutory_tax_rate ?? 0.2517));
  } else {
    const avgFO = (Math.abs(cur.bs.FO) + Math.abs(prev.bs.FO)) / 2;
    const kdPretax = avgFO > 1
      ? Math.max(0.03, Math.min(0.25, cur.is.FinanceCost / Math.max(avgFO, 1)))
      : Math.max(riskFreeRate * 1.3, 0.04);
    kdAfterTax = kdPretax * (1 - (cur.is.taxRate > 0.01 ? cur.is.taxRate : 0.2517));
  }

  // For net-cash firms (NFO < 0), weight_NFO < 0 => kw > ke. Correct per spec.
  const kwSpec = ke * weight_CSE_MI + kdAfterTax * weight_NFO;

  // Safety: kw must be positive; floor at risk-free rate
  return Math.max(riskFreeRate, kwSpec);
}

export function computeValuation(
  periods: RecastPeriod[], ke: number, kw: number, g: number, cfg: EngineConfig,
  /** §11 terminal RE anchor — if provided, overrides the as-reported lastRE in CV3 computation */
  terminalREAnchor?: number | null | undefined,
  /** §11 terminal ReOI anchor */
  terminalReOIAnchor?: number | null | undefined,
) {
  if (!periods.length) {
    throw new Error("computeValuation requires at least one period.");
  }

  const rhoE = 1 + ke;
  const rhoW = 1 + kw;
  const reSeries: Array<{ period: string; RE: number; ReOI: number }> = [];
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i]!;
    const prev = periods[i - 1]!;
    reSeries.push({ period: cur.period_end, RE: cur.is.CNI - ke * prev.bs.CSE, ReOI: cur.is.OI - kw * prev.bs.NOA });
  }
  const pvRE = reSeries.reduce((s, r, i) => s + r.RE / Math.pow(rhoE, i + 1), 0);
  const pvReOI = reSeries.reduce((s, r, i) => s + r.ReOI / Math.pow(rhoW, i + 1), 0);
  const T = reSeries.length;
  const lastRE = T ? reSeries[T - 1]!.RE : 0;
  const lastReOI = T ? reSeries[T - 1]!.ReOI : 0;
  const discE = Math.pow(rhoE, T);
  const discW = Math.pow(rhoW, T);

  const CV_RE_1 = 0;
  const CV_RE_2 = rhoE > 1 ? lastRE / (rhoE - 1) : 0;
  // §11: use provided terminal anchor if available, fall back to as-reported lastRE
  const RE_terminal_anchor = terminalREAnchor != null && Number.isFinite(terminalREAnchor) ? terminalREAnchor : lastRE;
  const ReOI_terminal_anchor = terminalReOIAnchor != null && Number.isFinite(terminalReOIAnchor) ? terminalReOIAnchor : lastReOI;
  const CV_RE_3 = rhoE - 1 - g > 0 ? (RE_terminal_anchor * (1 + g)) / (rhoE - 1 - g) : 0;
  const CV_W_1 = 0;
  const CV_W_2 = rhoW > 1 ? lastReOI / (rhoW - 1) : 0;
  const CV_W_3 = rhoW - 1 - g > 0 ? (ReOI_terminal_anchor * (1 + g)) / (rhoW - 1 - g) : 0;

  const CSE0 = periods[0]!.bs.CSE;
  const NOA0 = periods[0]!.bs.NOA;
  const NOA_T = periods[periods.length - 1]!.bs.NOA;
  const NFO_latest = periods[periods.length - 1]!.bs.NFO;
  const NFO0 = periods[0]!.bs.NFO;
  // Minority interest at the valuation anchor period. kw weights operating
  // value across CSE+MI+NFO (deriveKwFromStructure), so the enterprise→equity
  // bridge for the COMMON shareholder must subtract BOTH net debt (NFO) and
  // the minority claim (MI). Omitting MI overstates per-common-share value by
  // the minority interest for any firm with non-wholly-owned subsidiaries.
  const MI0 = periods[0]!.bs.MI;
  const RNOA_T = periods[periods.length - 1]!.ratios?.RNOA ?? (NOA_T !== 0 ? periods[periods.length - 1]!.is.OI / NOA_T : 0);

  // Phase J2: equity-side fail-closed gate.
  // Every equity-side intrinsic value is V = CSE0 + pvRE + CV/discE — the
  // anchor is CSE_latest (or CSE0 when working backward). When latest CSE
  // is non-positive (Vodafone Idea since FY19, distressed PSU pre-recap,
  // post-restructuring zombies), V_RE flips deeply negative and the
  // implied per-share value misleads reviewers. We refuse to publish
  // equity-side values in that case but keep enterprise-side V_ReOI
  // (anchored on NOA/NFO, no CSE dependency) so reformulation work,
  // segment SOTP, and EV-based comparables stay usable.
  const latestCSE = periods[periods.length - 1]!.bs.CSE;
  const equityModelsBlocked = !(Number.isFinite(latestCSE) && latestCSE > 0);
  const equityBlockedReason = equityModelsBlocked
    ? `Latest common shareholders' equity is ${
        Number.isFinite(latestCSE) ? latestCSE.toFixed(0) : "?"
      } Cr (≤ 0). Equity-side residual income, AEG, DDM, and per-share intrinsic values cannot be published — anchor on enterprise-side V_ReOI, FCFF, or loss-maker valuation instead.`
    : null;

  // §1.2: AR(1) phi-based reversion continuing value
  // Estimate phi on the RE and ReOI series separately for more defensible terminal value
  const RE_phi = estimateArPhi(reSeries.map((r) => r.RE));
  const ReOI_phi = estimateArPhi(reSeries.map((r) => r.ReOI));
  const CV_RE_reversion = cvReversion(
    RE_terminal_anchor,
    RE_phi.phi,
    ke,
  );
  const CV_ReOI_reversion = cvReversion(
    ReOI_terminal_anchor,
    ReOI_phi.phi,
    kw,
  );
  // Compute both Gordon and reversion CV side-by-side, flag when they diverge > 20%
  const gordonVsReversionFlag = (gordon: number, reversion: number) => {
    const base = Math.max(Math.abs(gordon), 1);
    return Math.abs(gordon - reversion) / base;
  };
  const RE_CV_divergence = gordonVsReversionFlag(CV_RE_3, CV_RE_reversion);
  const ReOI_CV_divergence = gordonVsReversionFlag(CV_W_3, CV_ReOI_reversion);

  // §1.3: Growth accounting decomposition (Penman's preferred anchor)
  // No-growth value: value from existing assets at current profitability
  // V_no_growth = CSE0 + (RNOA_T - kw) * NOA_T / kw
  // Phase J2: gated on equity-side health since CSE0 is the anchor.
  const V_no_growth = equityModelsBlocked ? null : CSE0 + (RNOA_T - kw) * NOA_T / kw;
  // Use primary valuation (RE CV3) as total value
  const V_total = equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_3 / discE;
  const growthValue =
    equityModelsBlocked || V_total == null || V_no_growth == null
      ? null
      : V_total - V_no_growth;
  const growthFraction =
    equityModelsBlocked || V_total == null || V_total === 0 || growthValue == null
      ? null
      : growthValue / V_total;

  // FCFF / FCFE triangulation
  const fcff_series: Array<{ period: string; NOPAT: number; dNOA: number; FCFF: number; PV_FCFF: number }> = [];
  const fcfe_series: Array<{ period: string; CNI: number; dCSE: number; FCFE: number; PV_FCFE: number }> = [];
  let pvFCFF = 0;
  let pvFCFE = 0;
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i]!;
    const prev = periods[i - 1]!;
    const dNOA = cur.bs.NOA - prev.bs.NOA;
    const dCSE = cur.bs.CSE - prev.bs.CSE;
    const NOPAT = cur.is.OI;
    const FCFF = NOPAT - dNOA;
    const FCFE = cur.is.CNI - dCSE;
    const pvFf = FCFF / Math.pow(rhoW, i);
    const pvFe = FCFE / Math.pow(rhoE, i);
    pvFCFF += pvFf;
    pvFCFE += pvFe;
    fcff_series.push({ period: cur.period_end, NOPAT, dNOA, FCFF, PV_FCFF: pvFf });
    fcfe_series.push({ period: cur.period_end, CNI: cur.is.CNI, dCSE, FCFE, PV_FCFE: pvFe });
  }
  const lastFCFF = fcff_series.length ? fcff_series[fcff_series.length - 1]!.FCFF : 0;
  const lastFCFE = fcfe_series.length ? fcfe_series[fcfe_series.length - 1]!.FCFE : 0;
  const CV_FCFF = rhoW - 1 - g > 0 ? (lastFCFF * (1 + g)) / (rhoW - 1 - g) : 0;
  const CV_FCFE = rhoE - 1 - g > 0 ? (lastFCFE * (1 + g)) / (rhoE - 1 - g) : 0;
  const EV_FCFF = pvFCFF + (CV_FCFF / discW);
  const V_FCFE = pvFCFE + (CV_FCFE / discE);

  // AEG valuation (Ohlson-Juettner style short-form proxy)
  const aeg_series: Array<{ period: string; CNI: number; AEG: number; PV_AEG: number }> = [];
  let pvAEG = 0;
  for (let i = 2; i < periods.length; i++) {
    const cur = periods[i]!;
    const prev = periods[i - 1]!;
    const aeg = cur.is.CNI - rhoE * prev.is.CNI;
    const pv = aeg / Math.pow(rhoE, i - 1);
    pvAEG += pv;
    aeg_series.push({ period: cur.period_end, CNI: cur.is.CNI, AEG: aeg, PV_AEG: pv });
  }
  const cni1 = periods.length > 1 ? periods[1]!.is.CNI : periods[0]!.is.CNI;
  const V_AEG = cni1 / Math.max(rhoE, 1e-6) + pvAEG;

  // Reverse DCF / implied growth for RE CV3
  let impliedGrowthRE: number | undefined;
  // Phase J2: implied-growth bisection compares V(g) = CSE0 + pvRE + cv/discE
  // against marketCap. With CSE0 < 0 the sign relationship inverts and the
  // bisection no longer converges on an economic answer — skip outright.
  if (
    !equityModelsBlocked &&
    cfg.market_price != null &&
    cfg.shares_outstanding &&
    cfg.shares_outstanding > 0
  ) {
    const marketCap = cfg.market_price * cfg.shares_outstanding;
    let lo = 0;
    let hi = Math.max(0.0001, Math.min(ke - 1e-3, 0.15));
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const cvMid = rhoE - 1 - mid > 0 ? (lastRE * (1 + mid)) / (rhoE - 1 - mid) : 0;
      const vMid = CSE0 + pvRE + cvMid / discE;
      if (vMid > marketCap) hi = mid;
      else lo = mid;
    }
    impliedGrowthRE = (lo + hi) / 2;
  }

  const perShare = (() => {
    if (!cfg.shares_outstanding || cfg.shares_outstanding <= 0) return undefined;
    const sh = cfg.shares_outstanding;
    // Phase J2: RE / DDM / AEG / implied-PB / implied-PE / MOS / impliedGrowth
    // all anchor on CSE — null them out when equity-side is blocked.
    // FCFF and FCFE remain meaningful: FCFF is enterprise (NOPAT - dNOA),
    // and FCFE uses dCSE only as the change between periods (the level
    // CSE_T can still be read meaningfully even if it's negative — the
    // distress signal is the user's cue).
    const rePer = equityModelsBlocked
      ? null
      : ((CSE0 + pvRE + CV_RE_3 / discE) / sh);
    const reoiPer = ((NOA0 + pvReOI + CV_W_3 / discW) - NFO0 - MI0) / sh;
    const fcffPer = (EV_FCFF - NFO0 - MI0) / sh;
    const fcfePer = equityModelsBlocked ? null : V_FCFE / sh;
    const ddmPer = equityModelsBlocked
      ? null
      : rhoE - 1 - g > 0
        ? ((periods[periods.length - 1]!.cf.DividendPaid * (1 + g)) / (rhoE - 1 - g)) / sh
        : null;
    const aegPer = equityModelsBlocked ? null : V_AEG / sh;
    const latestCSE_T = periods[periods.length - 1]!.bs.CSE;
    return {
      intrinsic_re_per_share: rePer,
      intrinsic_reoi_per_share: reoiPer,
      intrinsic_fcff_per_share: fcffPer,
      intrinsic_fcfe_per_share: fcfePer,
      intrinsic_ddm_per_share: ddmPer,
      intrinsic_aeg_per_share: aegPer,
      implied_pb_re: !equityModelsBlocked && rePer != null && latestCSE_T > 0
        ? (rePer * sh) / latestCSE_T
        : null,
      implied_pe_re: !equityModelsBlocked && rePer != null && periods[periods.length - 1]!.is.CNI !== 0
        ? (rePer * sh) / periods[periods.length - 1]!.is.CNI
        : null,
      margin_of_safety_re: !equityModelsBlocked && rePer != null && cfg.market_price
        ? (rePer - cfg.market_price) / cfg.market_price
        : null,
      implied_growth_rate: impliedGrowthRE ?? null,
    };
  })();

  // Per-share growth accounting
  const growthAccountingPerShare = (() => {
    if (!cfg.shares_outstanding || cfg.shares_outstanding <= 0) return undefined;
    const sh = cfg.shares_outstanding;
    if (equityModelsBlocked || V_no_growth == null || growthValue == null || growthFraction == null) {
      return {
        vNoGrowthPerShare: null,
        growthValuePerShare: null,
        growthFraction: null,
        noGrowthFraction: null,
      };
    }
    return {
      vNoGrowthPerShare: V_no_growth / sh,
      growthValuePerShare: growthValue / sh,
      growthFraction,
      noGrowthFraction: V_total !== 0 && V_total != null ? 1 - growthFraction : 0,
    };
  })();

  return {
    reSeries,
    pvRE,
    pvReOI,
    CV_RE: CV_RE_3,
    CV_ReOI: CV_W_3,
    EV_ReOI: NOA0 + pvReOI + CV_W_3 / discW,
    // Phase J2: equity-side values nulled when latest CSE ≤ 0.
    V_RE_CV1: equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_1 / discE,
    V_RE_CV2: equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_2 / discE,
    V_RE_CV3: equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_3 / discE,
    // Enterprise→common-equity bridge: subtract net debt (NFO) AND minority
    // interest (MI0). Keeps V_ReOI_CV03/sh === intrinsic_reoi_per_share and
    // makes the RE-vs-ReOI identity a common-vs-common comparison (V_RE_* is
    // CSE-anchored common equity). EV_ReOI above stays operating-entity value.
    V_ReOI_CV01: (NOA0 + pvReOI + CV_W_1 / discW) - NFO0 - MI0,
    V_ReOI_CV02: (NOA0 + pvReOI + CV_W_2 / discW) - NFO0 - MI0,
    V_ReOI_CV03: (NOA0 + pvReOI + CV_W_3 / discW) - NFO0 - MI0,
    CSE0,
    NOA0,
    NFO_latest,
    ke,
    kw,
    g,
    separationScore: periods[periods.length - 1]!.bs.separationScore,
    lowConfidence: periods[periods.length - 1]!.bs.separationScore < (cfg.separation_confidence_threshold ?? 70),
    equityModelsBlocked,
    equityBlockedReason,
    impliedGrowthRE,
    // S-11.1: AR(1) reversion continuing values
    CV_RE_reversion,
    CV_ReOI_reversion,
    RE_phi: RE_phi.phi,
    ReOI_phi: ReOI_phi.phi,
    RE_phi_r_squared: RE_phi.r_squared,
    ReOI_phi_r_squared: ReOI_phi.r_squared,
    RE_CV_divergence,
    ReOI_CV_divergence,
    // S-17.2: Growth accounting decomposition
    V_no_growth,
    growthValue,
    growthFraction,
    growthAccountingPerShare,
    fcf: {
      fcff_series,
      fcfe_series,
      EV_FCFF,
      V_FCFE,
      CV_FCFF,
      CV_FCFE,
    },
    aeg: {
      aeg_series,
      V_AEG,
      implied_pe: periods[periods.length - 1]!.is.CNI !== 0 ? V_AEG / periods[periods.length - 1]!.is.CNI : null,
      normalised_pe: cni1 !== 0 ? V_AEG / cni1 : null,
    },
    perShare,
  };
}
