import { LiveMarketDataFreshness } from "../marketData";
import { AnalysisStatusSummary } from "../analysisStatus";
import { ForecastScenario, ForecastPolicySurface, RecastPeriod, ValuationResult, BusinessModelProfile } from "../types";
import { resolveShareBasis } from "../shareCountTools";
import { ValuationReadiness } from "../valuationPolicy";
import { SOTPResult } from "../sotpValuation";
import { EvEbitdaCrossCheck } from "../evEbitdaCrossCheck";
import { IndiaQualitySignals } from "../indiaQualitySignals";
import { EarningsQualityCard } from "../earningsQuality";
import { EPVResult } from "../grahamDoddEPV";
import { WorkingCapitalGateResult } from "../valuation/workingCapitalGate";
import { CleanSurplusResult } from "../valuation/cleanSurplus";
import { CapmResult } from "../valuation/damodaranCapm";
import { ReverseDcfMonteCarloResult } from "../valuation/reverseDcfMonteCarlo";
import type { CashFlowDcfResult } from "../cashFlowDcf";
import type { ValuationTriangulationEvidence } from "../reconciliationResiduals";
import type {
  EvidenceWeightedValuationSynthesis,
  ForecastHoldoutSummary,
  MarketImpliedExpectationLedger,
  ValuationEvidenceLedger,
} from "../valuationEvidence/types";
import type { CostOfCapitalResult } from "../costOfCapital";

export type ValuationSignalState =
  | "blocked"
  | "guarded"
  | "watchlist"
  | "interesting"
  | "high-conviction"
  | "screaming-buy";

export interface ValuationScenarioCard {
  key: "stress" | "base" | "bull" | "historical-panic";
  label: string;
  scenario: ForecastScenario;
  intrinsicPerShare: number | null;
  /** Independent owner-earnings DCF value retained before scenario synthesis. */
  ownerEarningsDcfPerShare?: number | null | undefined;
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  expectedCagr: number | null;
  valuation: ValuationResult;
  forecastPolicy?: ForecastPolicySurface | undefined;
  assumptions: {
    ke: number;
    kw: number;
    g: number;
    salesGrowthYear1: number;
    corePmYear1: number;
    reinvestmentRateYear1: number | null;
    incrementalRoicYear1: number | null;
  };
}

export interface DcfCashFlowDiagnostics {
  ownerEarningsPerShare: number | null;
  ownerEarningsTotal: number | null;
  nopat: number | null;
  maintenanceCapex: number;
  growthCapex: number;
  workingCapitalInvestment: number;
  totalReinvestment: number;
  reinvestmentRate: number | null;
  incrementalRoic: number | null;
  cashConversionRatio: number | null;
  maintenanceCapexShareOfCapex: number | null;
  maintenanceCapexShareAssumption: number;
}

export interface NarrativeBandEntry {
  terminalROIC: number;
  impliedGrowth: number;
  intrinsicValue: number;
}

export interface ReverseDcfDiagnostics {
  impliedOwnerEarningsGrowth: number | null;
  impliedTerminalROIC: number | null;
  impliedKE: number | null;
  normalizedGrowthAnchor: number;
  expectationLabel: string;
  narrativeSpace: NarrativeBandEntry[];
  spreadVsNormalizedGrowth: number | null;
  marketExpectationLabel: string;
}

export interface ValuationOpportunityAssessment {
  qualityScore: number;
  requiredMarginOfSafetyPct: number;
  baseMarginOfSafetyPct: number | null;
  stressMarginOfSafetyPct: number | null;
  expectedCagrBase: number | null;
  expectedCagrStress: number | null;
  historicalCheapnessScore: number | null;
  reverseDcfPessimismScore: number | null;
  opportunityScore: number;
  convictionBucket: "research-only" | "starter" | "accumulate" | "high-conviction" | "truck-load zone";
  thesis: string;
  persistenceNarrative: string;
}

export interface ValuationChecklist {
  whatMustGoRight: string[];
  thesisBreakers: string[];
  forecastDiscipline: string[];
}

export interface ValuationMarketContext {
  expectedReturnSpreadVsRf: number | null;
  marketCapFromPrice: number | null;
  enterpriseValueFromPrice: number | null;
  priceToStressValueRatio: number | null;
  freshness: LiveMarketDataFreshness;
  sourceSummary: string;
  livePriceAsOf: string | null;
  liveRateAsOf: string | null;
  warningCount: number;
  valuationAnchorPeriod: string | null;
  latestReportedPeriod: string | null;
}

export interface ValuationBacktestPoint {
  periodEnd: string;
  state: ValuationSignalState;
  convictionBucket: ValuationOpportunityAssessment["convictionBucket"];
  marketPrice: number | null;
  baseIntrinsicPerShare: number | null;
  stressIntrinsicPerShare: number | null;
  expectedCagrStress: number | null;
  realized1Y: number | null;
  realized3Y: number | null;
  realized5Y: number | null;
}

export interface ValuationBacktestSummary {
  available: boolean;
  points: ValuationBacktestPoint[];
  countsByState: Record<ValuationSignalState, number>;
  investableCount: number;
  highConvictionCount: number;
  screamingBuyCount: number;
  forwardWinRate1Y: number | null;
  forwardWinRate3Y: number | null;
  median1Y: number | null;
  median3Y: number | null;
  latestComparedToHistory: string;
}

export interface ValuationSignal {
  state: ValuationSignalState;
  label: string;
  summary: string;
  confidenceState: AnalysisStatusSummary["status"] | "unknown";
  stressUpsidePct: number | null;
  baseUpsidePct: number | null;
  historicalPercentile: number | null;
  reverseDcfImpliedGrowth: number | null;
  requiredMarginOfSafetyPct: number;
  qualityScore: number;
  opportunityScore: number;
  convictionBucket: ValuationOpportunityAssessment["convictionBucket"];
  expectedCagrStress: number | null;
  supportingFlags: string[];
  killSwitches: string[];
}

export interface ValuationCommandCenterOutput {
  shareBasis: ReturnType<typeof resolveShareBasis>;
  valuationReadiness: ValuationReadiness;
  /**
   * The period every figure on this output was built from.
   *
   * NOT necessarily the newest reported period: `resolveValuationReadiness`
   * moves the anchor earlier when the terminal period is contaminated
   * (`valuationPolicy.ts:145-166`, `valuationReadiness.fallbackUsed`). Exposed
   * as a record rather than left to the surfaces to re-derive, because a
   * surface that reads `data[data.length - 1]` silently pairs newest-period
   * drivers with anchor-period scenarios. The `Math.max(2, anchorIndex + 1)`
   * window is duplicated at `ValuationReport.tsx:152` and
   * `AcademicReport.tsx:225`, so any change to `core.ts:106` has to be mirrored
   * in both — one more reason for surfaces to read this instead.
   *
   * This is the period `core.ts:107` actually valued, which is *usually* but not
   * always `valuationReadiness.anchorPeriod` (and hence
   * `marketContext.valuationAnchorPeriod`). With exactly two periods and a
   * GUARDED/COMPROMISED terminal one, `valuationPolicy.ts:166` reports index 0
   * and sets `fallbackUsed`, while the `Math.max(2, …)` floor keeps the window at
   * two — so `latest` is still index 1, the contaminated period. Prefer this
   * field over the date string wherever the two have to agree.
   */
  anchorPeriod: RecastPeriod;
  marketPrice: number | null;
  riskFreeRate: number;
  /** One pinned capital-cost result consumed by all command-center models. */
  costOfCapital: CostOfCapitalResult;
  asOf: string | null;
  sectorTemplate: {
    id: string;
    label: string;
    description: string;
    source: "user" | "company-type" | "auto";
  };
  businessModel: BusinessModelProfile;
  scenarios: ValuationScenarioCard[];
  diagnostics: DcfCashFlowDiagnostics;
  reverseDcf: ReverseDcfDiagnostics;
  sotp: SOTPResult | null;
  /**
   * SOTP value per share, bridged to common equity (−NFO −MI) at the anchor
   * period. Reported here rather than derived by the surfaces:
   * `sotp.discountedSum` is a whole-entity figure, and the NFO and MI it must
   * pair with belong to the anchor period, which the surfaces do not resolve
   * (`valuationPolicy.ts:145-166`).
   * Null when there is no SOTP or no usable share basis.
   */
  sotpPerShare: number | null;
  /** Phase C5 — conglomerate assessment from segment data or presets. */
  conglomerate: ConglomerateAssessment | null;
  evEbitda: EvEbitdaCrossCheck;
  indiaQuality: IndiaQualitySignals;
  opportunity: ValuationOpportunityAssessment;
  checklist: ValuationChecklist;
  marketContext: ValuationMarketContext;
  backtest: ValuationBacktestSummary;
  signal: ValuationSignal;
  earningsQuality: EarningsQualityCard;
  /** Graham-Dodd EPV — no-growth floor anchor (Greenwald). */
  epv: EPVResult | null;
  /** Working capital CCC gate — flags stretched/distressed working capital. */
  workingCapitalGate: WorkingCapitalGateResult | null;
  /** Clean surplus check — detects dirty-surplus accounting. */
  cleanSurplus: CleanSurplusResult | null;
  /** Damodaran CAPM ke — independent cost-of-equity cross-check. */
  damodaranCapm: CapmResult | null;
  /** Reverse DCF Monte Carlo — implied terminal growth distribution. */
  reverseDcfMonteCarlo: ReverseDcfMonteCarloResult | null;
  /** Independent cash-statement FCFF DCF lens (does not read NOA/OI accrual recast). */
  cashFlowDcf: CashFlowDcfResult | null;
  /** Anti-tautology assumption ledger: every material scenario assumption gets source/confidence metadata. */
  evidenceLedger: ValuationEvidenceLedger;
  /** Forecast holdout skill: can historical driver forecasts predict known future periods? */
  forecastHoldout: ForecastHoldoutSummary;
  /** Reverse DCF quarantine ledger: market-implied expectations are diagnostic-only. */
  marketImpliedExpectations: MarketImpliedExpectationLedger;
  /** Evidence-weighted synthesis that weights independent lenses, not Penman model count. */
  evidenceWeightedSynthesis: EvidenceWeightedValuationSynthesis;
  /** Lightweight evidence used by the traceability gate to adjudicate paradigm disagreement. */
  valuationTriangulation: ValuationTriangulationEvidence;
  range: {
    floorPerShare: number | null;
    ceilingPerShare: number | null;
  };
}

/** Phase C5 — Conglomerate assessment derived from segment data or SOTP presets. */
export interface ConglomerateAssessment {
  isConglomerate: boolean;
  segmentCount: number;
  distinctSectorTemplates: number;
  dominantSegmentPct: number;
  dominantSegmentName: string;
  dataSource: "parsed" | "preset" | "none";
  /** Advisory: for diversified conglomerates, SOTP is preferred over single-entity V_RE. */
  sotpPreferred: boolean;
}
