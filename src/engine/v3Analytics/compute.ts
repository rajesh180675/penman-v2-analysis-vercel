/* ══════════════════════════════════════════════════════════════════
   computeV3Analytics — full V3 analytics orchestrator
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from sibling v3Analytics/* modules + external engine modules — no
   back-edge to the v3Analytics.ts barrel.
══════════════════════════════════════════════════════════════════ */
import { RecastPeriod, EngineConfig, ke_from_config } from "../types";
import { CroreShares } from "../types/units";
import { trace } from "../../lib/traceLogger";
import { deriveKwFromStructure } from "../PenmanNissimEngine";
import { computeMoatScore, MoatScoreResult } from "../moatScoring";
import { scoreCapitalAllocation, CapAllocScoreResult } from "../capitalAllocationScoring";
import { assessCyclicality, CyclicalityAssessment } from "../cyclicalityDetector";
import { detectStructuralBreaks, StructuralBreakAssessment } from "../structuralBreakDetector";
import { computeLossMakerValuation, LossMakerValuationResult } from "../lossMakerValuation";
import { computeEPV, EPVResult } from "../grahamDoddEPV";
import { computeIndustrialMultiples, RelativeValuationResult } from "../relativeValuation";
import { CanonicalOutputRegistry } from "./shared";
import { runDataValidation, type DataValidationResult } from "./dataValidation";
import {
  computeDirtySurplus,
  computeDirtySurplusFramework,
  detectPeriodEventFlags,
} from "./eventFraming";
import type {
  DirtySurplusSummary,
  DirtySurplusFramework,
  TriggerCalibrationResult,
  PeriodEventFlags,
} from "./eventFraming";
import { selectTerminalAnchor, type TerminalAnchorResult } from "./terminalValue";
import { computeConfidenceScore, type ConfidenceResult } from "./confidence";
import { estimateFadeParams, type FadeParamEstimate } from "./fadeParams";
import {
  calibrateMonitoringTriggers,
  generateMonitoringTriggers,
  type MonitoringTrigger,
} from "./triggers";
import {
  selectOADecompositionPeriods,
  renderOADecomposition,
  buildAccrualTable,
  type OADecompositionResult,
  type AccrualTableRow,
} from "./reporting";
import { deriveShareCount, type ShareCountResult } from "./shareCount";
import { computeMarketImplied, type MarketImpliedResult } from "./marketImplied";
import { buildSection6B, type Section6BResult } from "./section6B";
import { decomposeReReOIGap, type ReReOIGapDecomposition } from "./reReoiGap";
import { compareWithPriorRegistry, renderVersionChangeLog, type VersionChangeEntry } from "./versionChange";
import { runCrossSectionAssertions } from "./crossSection";

/** Full V3 analytics bundle — call once per analysis */
export interface V3AnalyticsBundle {
  validation: DataValidationResult;
  dirtySurplus: DirtySurplusSummary;
  dirtySurplusFramework: DirtySurplusFramework;
  periodFlags: PeriodEventFlags[];
  anchorResult: TerminalAnchorResult;
  confidence: ConfidenceResult;
  fadeParams: FadeParamEstimate[];
  triggers: MonitoringTrigger[];
  triggerCalibration: TriggerCalibrationResult;
  reReoiGapDecomposition: ReReOIGapDecomposition;
  oaDecomposition: OADecompositionResult[];
  accrualTable: AccrualTableRow[];
  shareCount: ShareCountResult;
  marketImplied: MarketImpliedResult;
  section6B: Section6BResult;
  versionChangeLog: VersionChangeEntry[];
  versionChangeLogMarkdown: string;
  crossSectionIssues: string[];
  registry: CanonicalOutputRegistry;
  /** Economic moat score (null if < 3 periods) */
  moatScore: MoatScoreResult | null;
  /** Capital allocation quality score */
  capitalAllocation: CapAllocScoreResult | null;
  /**
   * Phase I — cyclicality assessment. Flags whether the company's margin
   * series is structurally cyclical and where the latest period sits in
   * the cycle. UI uses this to surface peak/trough warnings on cyclical
   * businesses (Tata Steel, JSPL, Hindalco) and skip them on non-cyclicals.
   */
  cyclicality: CyclicalityAssessment;
  /**
   * Phase I — structural break detection. Flags demerger / M&A / capital
   * raise / IFRS-16 transitions where YoY changes in equity, revenue, or
   * NOA are too large to be organic. UI surfaces affected periods so users
   * can interpret persistence calculations with appropriate context.
   */
  structuralBreaks: StructuralBreakAssessment;
  /**
   * Phase I3 — loss-maker valuation alternative. Non-null only when the
   * company has CNI ≤ 0 in at least half its periods. Provides revenue-
   * multiple anchor, reverse-DCF, runway, and path-to-profitability flags
   * for cases where standard earnings-based models all skip with reason.
   */
  lossMakerValuation: LossMakerValuationResult | null;
  /** Graham-Dodd EPV (null if < 3 periods or no market data) */
  epv: EPVResult | null;
  /** Relative valuation multiples (null if no market cap in config) */
  relativeValuation: RelativeValuationResult | null;
  /**
   * Ohlson (1995) reversion CV alternative to Gordon Growth (review C11).
   * V_RE_ohlson_reversion = CSE0 + PV(RE explicit) + CV_ohlson / (1+ke)^T
   * where CV_ohlson = phi * RE_T / (1 + ke - phi).
   * Null when phi or RE_T is unavailable.
   */
  V_RE_ohlson_reversion: number | null;
  /** AR(1) phi used in the Ohlson CV after clamping/fallback. */
  phi_effective: number;
  /** Source of phi: COMPANY_SPECIFIC (OLS fit succeeded) or NP_DEFAULT (Nissim-Penman 2001 default 0.87). */
  phi_source: string;
}
export function computeV3Analytics(
  periods: RecastPeriod[],
  cfg: EngineConfig,
  V_RE_CV3: number,
  V_ReOI_CV03: number,
  gTerminalOverride?: number | null | undefined,
  kwDerived?: number | undefined,
  itServices?: import("../itServicesDetector").ITServicesSignal | null | undefined,
): V3AnalyticsBundle {
  const ke = ke_from_config(cfg);
  const kw = (() => {
    if (kwDerived != null && Number.isFinite(kwDerived) && kwDerived > 0) return kwDerived;
    if (periods.length >= 2) {
      const cur = periods[periods.length - 1]!;
      const prev = periods[periods.length - 2]!;
      return deriveKwFromStructure(cur, prev, ke, cfg.risk_free_rate, cfg);
    }
    return ke * 0.75;
  })();
  const registry = new CanonicalOutputRegistry();
  registry.register("period_count", periods.length, "S-13.3");
  registry.register("company_id", cfg.ticker ?? "Company", "S-13.3");
  registry.register("kw_derived_latest", kw, "S-13.4");
  registry.register("kw_derived_median", kw, "S-13.4");
  const validation = runDataValidation(periods);
  const dirtySurplus = computeDirtySurplus(periods, ke);
  // NOTE: DS_cumulative_all is registered by computeDirtySurplusFramework (S-15.4 single source of truth)
  // Do NOT register it here to avoid double-registration ConsistencyViolation (S-13.1)
  const periodFlags = detectPeriodEventFlags(periods, dirtySurplus);
  const anchorResult = selectTerminalAnchor(periods, periodFlags, ke, kw, gTerminalOverride);
  const pvREExplicit = periods.slice(1).reduce((acc, p, idx) => acc + (p.ri?.RE ?? 0) / Math.pow(1 + ke, idx + 1), 0);
  const cse0 = periods[0]?.bs.CSE ?? 0;
  const explicitPeriods = Math.max(1, periods.length - 1);
  const conservativeV = (() => {
    if (anchorResult.RE_anchor_3 == null || ke <= anchorResult.g_applied) return anchorResult.V_total;
    const cv = (anchorResult.RE_anchor_3 * (1 + anchorResult.g_applied)) / (ke - anchorResult.g_applied);
    return cse0 + pvREExplicit + cv / Math.pow(1 + ke, explicitPeriods);
  })();
  registry.register("V_primary", anchorResult.V_total, "S-14.1");
  registry.register("V_RE_CV3_guarded", anchorResult.V_total, "S-14.1");
  registry.register("V_RE_CV3_conservative", conservativeV, "S-14.1");
  registry.register("V_RE_CV3_reported", anchorResult.reference_V, "S-14.1");
  registry.register("primary_anchor_label", anchorResult.label, "S-14.1");
  registry.register("primary_anchor_source", anchorResult.anchor_method, "S-14.1");
  registry.register("tv_share_primary", anchorResult.TV_share ?? 0, "S-14.1");
  registry.register("tv_grade", anchorResult.TV_grade, "S-14.1");
  registry.register("g_effective", anchorResult.g_applied, "S-14.1");
  registry.register("g_input", gTerminalOverride ?? anchorResult.g_applied, "S-14.1");
  registry.register("g_cap_binding", anchorResult.g_source, "S-14.1");
  registry.register("tv_share_reported", anchorResult.TV_share_raw ?? 0, "S-14.1");
  registry.register("n_terminal_flags", anchorResult.terminal_event_flags.length, "S-14.1");
  const dirtySurplusFramework = computeDirtySurplusFramework(periods, periodFlags, registry);
  // Get eq16 residual from latest period with ratios
  const eq16_residual_latest = (() => {
    for (let i = periods.length - 1; i >= 0; i--) {
      const r = periods[i]!.ratios;
      if (r?.ROCE_eq16_error != null) return r.ROCE_eq16_error;
    }
    return null;
  })();
  const confidence = computeConfidenceScore(
    periods, dirtySurplus, anchorResult, V_RE_CV3, V_ReOI_CV03, eq16_residual_latest, registry
  );
  const reReoiGapDecomposition = decomposeReReOIGap(
    periods,
    { V_RE_CV3, V_ReOI_CV03, CSE0: periods[0]?.bs.CSE ?? 0, pvRE: 0, CV_RE: 0, CV_ReOI: 0, ke, kw },
    anchorResult.g_applied,
    registry,
  );
  const selectedOaPeriods = selectOADecompositionPeriods(periods, periodFlags);
  const oaDecomposition = selectedOaPeriods
    .map((periodEnd) => {
      const idx = periods.findIndex((p) => p.period_end === periodEnd);
      if (idx <= 0) return null;
      return renderOADecomposition(periods[idx]!, periods[idx - 1]!);
    })
    .filter((x): x is OADecompositionResult => x != null);
  const fadeParams = estimateFadeParams(periods);

  // §9.1b: Wire phi into terminal value — Ohlson (1995) reversion CV
  //   CV_ohlson = (phi * RE_T) / (1 + ke - phi)
  //
  // Phi is the AR(1) persistence of the *abnormal earnings (RE)* series, not PM.
  // Prior implementation used PM phi as a proxy (review C9). PM persistence and
  // RE persistence are not interchangeable — a stable margin coexists with
  // declining RE when CSE grows. Estimate phi directly on the RE series when we
  // have N≥10 observations, fall back to PM phi (clamped) when RE coverage is
  // thin, and finally to the Nissim-Penman 2001 PM default (0.87) as a last
  // resort with an explicit source label so reviewers can audit the path.
  //
  // All paths clamp phi to [0, 0.95] (review C7).
  // §9.1b: Phi (persistence parameter) for Ohlson (1995) terminal value reversion.
  // Default φ = 0.87 from: Nissim, D. & Penman, S.H. (2001). "Ratio Analysis and
  // Equity Valuation: From Research to Practice." Review of Accounting Studies,
  // 6(1), 109–154. Table 6 — median PM persistence across US industrials.
  // Clamp [0, 0.95]: φ > 0.95 implies near-permanent supernormal returns,
  // violating competitive equilibrium (Penman 2013, Ch. 15 caveat).
  const NP_2001_PHI_PM_DEFAULT = 0.87;
  const reSeriesForPhi = periods
    .map(p => p.ri?.RE)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const phiClamp = (v: number | null): number | null => {
    if (v == null || !Number.isFinite(v)) return null;
    return Math.max(0, Math.min(0.95, v));
  };
  const phiFromRE = reSeriesForPhi.length >= 10
    ? phiClamp(estimatePhiInline(reSeriesForPhi))
    : null;
  const pmFade = fadeParams.find(f => f.driver === "PM");
  const phiFromPM = pmFade?.source === "COMPANY_SPECIFIC"
    ? phiClamp(pmFade.phi)
    : null;
  let phi_effective: number;
  let phi_source: "RE_OLS_FIT" | "PM_OLS_PROXY" | "NP_DEFAULT";
  if (phiFromRE != null) {
    phi_effective = phiFromRE;
    phi_source    = "RE_OLS_FIT";
  } else if (phiFromPM != null) {
    phi_effective = phiFromPM;
    phi_source    = "PM_OLS_PROXY";
  } else {
    phi_effective = NP_2001_PHI_PM_DEFAULT;
    phi_source    = "NP_DEFAULT";
  }
  const RE_T = anchorResult.selected_RE_anchor;
  const denominator_ohlson = 1 + ke - phi_effective;
  const CV_ohlson = (denominator_ohlson > 0.01 && RE_T != null && Number.isFinite(RE_T))
    ? (phi_effective * RE_T) / denominator_ohlson
    : null;
  const V_ohlson = CV_ohlson != null
    ? cse0 + pvREExplicit + CV_ohlson / Math.pow(1 + ke, explicitPeriods)
    : null;
  registry.register("V_RE_ohlson_reversion", V_ohlson ?? 0, "S-9.1b");
  registry.register("phi_effective", phi_effective, "S-9.1b");
  registry.register("phi_source", phi_source, "S-9.1b");
  registry.register("CV_ohlson", CV_ohlson ?? 0, "S-9.1b");

  const companyId = periods[0]?.period_end ? (cfg.ticker ?? "Company") : "Company";
  const triggerCalibration = calibrateMonitoringTriggers(periods, periodFlags, registry, cfg);
  const triggers = generateMonitoringTriggers(periods, companyId, ke, periodFlags, registry, cfg);
  const shareCount = deriveShareCount(periods, registry, anchorResult.V_total);
  const sharesForPerShare = cfg.shares_outstanding ?? shareCount.sharesForPerShare ?? shareCount.shares ?? undefined;
  const sharesForMarketCap = cfg.shares_outstanding ?? shareCount.sharesForMarketCap ?? shareCount.shares ?? undefined;
  const marketImplied = computeMarketImplied(
    registry,
    {
      V_primary: anchorResult.V_total,
      ke,
      g_effective: anchorResult.g_applied,
      CSE0: cse0,
      pvRE: pvREExplicit,
      explicit_periods: explicitPeriods,
      RE_anchor: anchorResult.selected_RE_anchor,
      periods,
    },
    cfg.market_price,
    sharesForPerShare,
    sharesForMarketCap,
  );
  const accrualTable = buildAccrualTable(periods);
  const section6B = buildSection6B(shareCount, marketImplied, registry);
  const priorKey = `${companyId}_${periods[0]?.period_end}_${periods[periods.length - 1]?.period_end}`;
  let priorSnapshot: Record<string, unknown> | undefined;
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      const raw = globalThis.localStorage.getItem(`v3_registry_${priorKey}`);
      priorSnapshot = raw ? JSON.parse(raw) : undefined;
      // M3 fix: guard against localStorage quota exceeded for companies with
      // large metric sets (e.g. Sun Pharma's 1312 raw keys). Serialize first,
      // check size, and skip if > 2MB to avoid silent quota errors.
      const snapshotJson = JSON.stringify(registry.snapshot());
      if (snapshotJson.length < 2_000_000) {
        globalThis.localStorage.setItem(`v3_registry_${priorKey}`, snapshotJson);
      } else {
        trace("pipeline", "v3:registrySnapshot:tooLarge", { key: priorKey, bytes: snapshotJson.length }, null, { level: "warn" });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace("pipeline", "v3:registrySnapshot:skipped", { error: msg }, null, { level: "warn" });
    priorSnapshot = undefined;
  }
  const versionChangeLog = compareWithPriorRegistry(registry, priorSnapshot);
  const versionChangeLogMarkdown = renderVersionChangeLog(versionChangeLog);
  const crossSectionIssues = runCrossSectionAssertions(registry, {
    header: `${companyId}`,
    section1: `Terminal anchor: ${anchorResult.label}; g = ${(anchorResult.g_applied * 100).toFixed(1)}%; TV ${anchorResult.TV_grade}`,
    section7: triggers.map((t) => t.title + t.body).join("\n"),
    section6A1RowCount: periods.length - 1,
  });
  const moatScore = computeMoatScore(periods, cfg, kw, itServices);
  const capitalAllocation = periods.length >= 3 ? scoreCapitalAllocation(periods, cfg, kw) : null;
  const cyclicality = assessCyclicality(periods);
  const structuralBreaks = detectStructuralBreaks(periods);
  const lossMakerValuation = computeLossMakerValuation(periods, cfg);
  const epv = computeEPV(periods, sharesForPerShare != null ? { ...cfg, shares_outstanding: CroreShares(sharesForPerShare) } : cfg);
  const relativeValuation = cfg.market_price != null && sharesForMarketCap != null
    ? computeIndustrialMultiples(periods, {
        marketCap: cfg.market_price * sharesForMarketCap,
        sharePrice: cfg.market_price,
      })
    : null;

  return { validation, dirtySurplus, dirtySurplusFramework, periodFlags, anchorResult, confidence, fadeParams, triggers, triggerCalibration, reReoiGapDecomposition, oaDecomposition, accrualTable, shareCount, marketImplied, section6B, versionChangeLog, versionChangeLogMarkdown, crossSectionIssues, registry, moatScore, capitalAllocation, cyclicality, structuralBreaks, lossMakerValuation, epv, relativeValuation, V_RE_ohlson_reversion: V_ohlson, phi_effective, phi_source };
}

/**
 * AR(1) phi via OLS, mirrors moatScoring.estimatePhi but kept inline to avoid
 * a circular import. Returns null on insufficient data or zero variance.
 */
function estimatePhiInline(series: number[]): number | null {
  if (series.length < 4) return null;
  const x = series.slice(0, -1);
  const y = series.slice(1);
  const n = x.length;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  const cov = x.reduce((s, v, i) => s + (v - meanX) * (y[i]! - meanY), 0);
  const varX = x.reduce((s, v) => s + (v - meanX) ** 2, 0);
  if (varX < 1e-10) return null;
  return cov / varX;
}
