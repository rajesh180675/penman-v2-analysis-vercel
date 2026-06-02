import type { ReverseDcfDiagnostics, ValuationScenarioCard } from "../valuationCommandCenter";
import type {
  DefensibleRange,
  EvidenceIndependenceGroup,
  EvidenceSourceType,
  ValuationAssumptionEvidence,
  ValuationAssumptionKey,
  ValuationEvidenceLedger,
} from "./types";

const RANGE_BAND = 0.2;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rangeAround(value: number | null, basis: string, band = RANGE_BAND): DefensibleRange {
  if (value == null) return { low: null, high: null, basis };
  const width = Math.max(Math.abs(value) * band, 0.005);
  return { low: value - width, high: value + width, basis };
}

function confidenceFor(sourceType: EvidenceSourceType, value: number | null): ValuationAssumptionEvidence["confidence"] {
  if (value == null || sourceType === "source-unavailable") return "unavailable";
  if (sourceType === "clean-window-history" || sourceType === "reported-history") return "high";
  if (sourceType === "price-derived") return "low";
  return "medium";
}

function makeRow(args: {
  key: ValuationAssumptionKey;
  label: string;
  value: number | null | undefined;
  unit: ValuationAssumptionEvidence["unit"];
  scenarioKey?: ValuationScenarioCard["key"] | undefined;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  independenceGroup: EvidenceIndependenceGroup;
  rangeBasis: string;
  priceDerived?: boolean | undefined;
  eligibleForIntrinsicConfidence?: boolean | undefined;
  warnings?: string[] | undefined;
}): ValuationAssumptionEvidence {
  const value = finiteOrNull(args.value);
  const sourceType = value == null && args.sourceType !== "price-derived" ? "source-unavailable" : args.sourceType;
  const priceDerived = args.priceDerived ?? sourceType === "price-derived";
  return {
    key: args.key,
    label: args.label,
    value,
    unit: args.unit,
    scenarioKey: args.scenarioKey,
    sourceType,
    sourceLabel: sourceType === "source-unavailable" ? "Source unavailable" : args.sourceLabel,
    sourceRef: null,
    sourcePeriodWindow: null,
    independenceGroup: args.independenceGroup,
    priceDerived,
    eligibleForIntrinsicConfidence: args.eligibleForIntrinsicConfidence ?? (!priceDerived && sourceType !== "source-unavailable"),
    confidence: confidenceFor(sourceType, value),
    defensibleRange: rangeAround(value, args.rangeBasis),
    warnings: [
      ...(value == null ? ["No finite value was available; no assumption was fabricated."] : []),
      ...(priceDerived ? ["Price-derived diagnostic only; excluded from intrinsic confidence."] : []),
      ...(args.warnings ?? []),
    ],
  };
}

function rowsForScenario(card: ValuationScenarioCard): ValuationAssumptionEvidence[] {
  const policy = card.forecastPolicy;
  const terminalSource = policy?.terminalAnchorSource === "template" ? "sector-prior" : "clean-window-history";
  const terminalLabel = policy?.terminalAnchorSource === "template"
    ? "Sector terminal-growth prior"
    : policy?.terminalAnchorSource === "blended"
      ? "Blended company history and sector guardrail"
      : "Clean-window company history";

  return [
    makeRow({
      key: "revenue_growth",
      label: "Year-1 revenue growth",
      value: card.assumptions.salesGrowthYear1,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: "clean-window-history",
      sourceLabel: "Scenario driver calibrated from clean historical window",
      independenceGroup: "accrual-history",
      rangeBasis: "±20% around scenario driver until holdout evidence is attached",
    }),
    makeRow({
      key: "core_margin",
      label: "Year-1 core sales margin",
      value: card.assumptions.corePmYear1,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: "clean-window-history",
      sourceLabel: "Scenario margin driver calibrated from clean historical window",
      independenceGroup: "accrual-history",
      rangeBasis: "±20% around scenario driver until margin holdout is attached",
    }),
    makeRow({
      key: "reinvestment_rate",
      label: "Year-1 reinvestment rate",
      value: card.assumptions.reinvestmentRateYear1,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: card.assumptions.reinvestmentRateYear1 == null ? "source-unavailable" : "reported-history",
      sourceLabel: "Owner-earnings reinvestment diagnostics",
      independenceGroup: "cash-statement",
      rangeBasis: "±20% around cash-flow reinvestment diagnostic",
    }),
    makeRow({
      key: "rnoa",
      label: "Year-1 incremental return on net operating assets",
      value: card.assumptions.incrementalRoicYear1,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: card.assumptions.incrementalRoicYear1 == null ? "source-unavailable" : "reported-history",
      sourceLabel: "Incremental operating-profit vs NOA diagnostic",
      independenceGroup: "accrual-history",
      rangeBasis: "±20% around incremental operating return diagnostic",
    }),
    makeRow({
      key: "terminal_growth",
      label: "Terminal growth",
      value: card.assumptions.g,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: terminalSource,
      sourceLabel: terminalLabel,
      independenceGroup: terminalSource === "sector-prior" ? "sector-static" : "accrual-history",
      rangeBasis: "Terminal growth bounded by sector template and company-evidence policy",
    }),
    makeRow({
      key: "ke",
      label: "Cost of equity",
      value: card.assumptions.ke,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: "user-override",
      sourceLabel: "Engine risk input / user override",
      independenceGroup: "user-input",
      rangeBasis: "Risk input subject to CAPM cross-check where available",
    }),
    makeRow({
      key: "kw",
      label: "Operating capital charge",
      value: card.assumptions.kw,
      unit: "fraction",
      scenarioKey: card.key,
      sourceType: "reported-history",
      sourceLabel: "Structurally derived kw from financing mix and risk inputs",
      independenceGroup: "accrual-history",
      rangeBasis: "Structural kw is read-only in valuation scenarios",
    }),
  ];
}

function reverseDcfRows(reverseDcf: ReverseDcfDiagnostics | null | undefined): ValuationAssumptionEvidence[] {
  if (!reverseDcf) return [];
  return [
    makeRow({
      key: "revenue_growth",
      label: "Market-implied owner-earnings growth",
      value: reverseDcf.impliedOwnerEarningsGrowth,
      unit: "fraction",
      sourceType: "price-derived",
      sourceLabel: "Reverse DCF from current market price",
      independenceGroup: "market-price",
      rangeBasis: "Bounded solver output; diagnostic only",
      priceDerived: true,
      eligibleForIntrinsicConfidence: false,
    }),
    makeRow({
      key: "rnoa",
      label: "Market-implied terminal operating return",
      value: reverseDcf.impliedTerminalROIC,
      unit: "fraction",
      sourceType: "price-derived",
      sourceLabel: "Reverse DCF from current market price",
      independenceGroup: "market-price",
      rangeBasis: "Bounded solver output; diagnostic only",
      priceDerived: true,
      eligibleForIntrinsicConfidence: false,
    }),
    makeRow({
      key: "ke",
      label: "Market-implied cost of equity",
      value: reverseDcf.impliedKE,
      unit: "fraction",
      sourceType: "price-derived",
      sourceLabel: "Reverse DCF from current market price",
      independenceGroup: "market-price",
      rangeBasis: "Solver inversion; diagnostic only",
      priceDerived: true,
      eligibleForIntrinsicConfidence: false,
    }),
  ];
}

export function buildAssumptionEvidenceLedger(args: {
  scenarios: ValuationScenarioCard[];
  reverseDcf?: ReverseDcfDiagnostics | null | undefined;
  periodEnd?: string | null | undefined;
  companyId?: string | null | undefined;
}): ValuationEvidenceLedger {
  const rows = [
    ...args.scenarios.flatMap(rowsForScenario),
    ...reverseDcfRows(args.reverseDcf),
  ];
  const unsupportedCount = rows.filter((row) => !row.eligibleForIntrinsicConfidence || row.confidence === "unavailable").length;
  const priceDerivedCount = rows.filter((row) => row.priceDerived).length;
  const sourceUnavailableCount = rows.filter((row) => row.sourceType === "source-unavailable").length;
  const confidenceEligibleRows = rows.filter((row) => row.eligibleForIntrinsicConfidence);

  return {
    schemaVersion: "2026-06-valuation-evidence-v1",
    periodEnd: args.periodEnd ?? null,
    companyId: args.companyId ?? null,
    rows,
    summary: {
      total: rows.length,
      unsupportedCount,
      priceDerivedCount,
      confidenceEligibleCount: confidenceEligibleRows.length,
      highConfidenceCount: confidenceEligibleRows.filter((row) => row.confidence === "high").length,
      sourceUnavailableCount,
    },
  };
}
