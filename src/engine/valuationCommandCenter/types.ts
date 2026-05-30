import { LiveMarketDataFreshness } from "../marketData";
import { AnalysisStatusSummary } from "../analysisStatus";
import { ForecastScenario, ForecastPolicySurface, ValuationResult, BusinessModelProfile } from "../types";
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
  marketPrice: number | null;
  riskFreeRate: number;
  asOf: string | null;
  sectorTemplate: {
    id: string;
    label: string;
    description: string;
    source: "user" | "auto";
  };
  businessModel: BusinessModelProfile;
  scenarios: ValuationScenarioCard[];
  diagnostics: DcfCashFlowDiagnostics;
  reverseDcf: ReverseDcfDiagnostics;
  sotp: SOTPResult | null;
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
