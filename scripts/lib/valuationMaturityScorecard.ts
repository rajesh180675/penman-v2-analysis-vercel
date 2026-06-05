import {
  AUDIT_OUTCOMES,
  isActionableAuditOutcome,
  isExpectedSkipOutcome,
  type AuditOutcome,
  type AuditStatusClass,
} from "./auditTypes";

export const SCORECARD_SCHEMA_VERSION = "2026-06-valuation-maturity-v1" as const;

export const SCORECARD_FAMILIES = [
  { id: "industrial-core", label: "Industrial core valuation", weight: 15 },
  { id: "financial-institution-coverage", label: "Bank/NBFC/insurance coverage", weight: 15 },
  { id: "sector-native-coverage", label: "Sector-native coverage", weight: 12 },
  { id: "cross-paradigm-independence", label: "Cross-paradigm independence", weight: 12 },
  { id: "traceability-reconciliation-fail-closed", label: "Traceability/reconciliation/fail-closed gates", weight: 16 },
  { id: "data-freshness-source-tieout", label: "Data freshness/source tieout", weight: 10 },
  { id: "workbook-reviewer-defensibility", label: "Workbook/reviewer defensibility", weight: 10 },
  { id: "engineering-release-quality", label: "Engineering/release quality", weight: 10 },
] as const;

export type ScorecardFamilyId = typeof SCORECARD_FAMILIES[number]["id"];
export type ScorecardFamilyStatus = "strong" | "guarded" | "gap" | "blocked";
export type ValuationMaturityRating = "institutional" | "reviewer-ready" | "guarded" | "developing";

export interface ValuationScorecardAuditRow {
  folder: string;
  ticker: string;
  companyType: string;
  analysisFamily: "industrial" | "financial-institution" | "unknown";
  pipelineStrategyId: string | null;
  periods: number;
  latestPeriod: string | null;
  models: string[];
  valuationEvidence: {
    readinessStatus: string | null;
    readinessAnchorPeriod: string | null;
    defensibilityStatus: string | null;
    triangulationMethods: Array<{
      key: string;
      label: string;
      perShare: number | null;
    }>;
    independentLensGroups: string[];
  };
  outcome: AuditOutcome;
  statusClass: AuditStatusClass;
  flags: string[];
  rigor: {
    currentLevel: string | null;
    parserFidelityStatus: string | null;
    parserFidelityScore: number | null;
    reconciliationStatus: string | null;
    reconciliationMaxRatio: number | null;
    confidenceStatus: string | null;
  };
}

export interface ValuationMaturityFamilyScore {
  id: ScorecardFamilyId;
  label: string;
  weight: number;
  score: number;
  status: ScorecardFamilyStatus;
  sampleSize: number;
  evidence: string[];
  blockers: string[];
}

export interface ValuationMaturityScorecard {
  schemaVersion: typeof SCORECARD_SCHEMA_VERSION;
  generatedAt: string;
  totalWeight: number;
  overallScore: number;
  rating: ValuationMaturityRating;
  corpus: {
    companies: number;
    companyTypes: Record<string, number>;
    outcomes: Record<AuditOutcome, number>;
    calcErrors: number;
    actionable: number;
    expectedSkips: number;
  };
  families: ValuationMaturityFamilyScore[];
}

export interface BuildValuationMaturityScorecardOptions {
  generatedAt?: string;
}

const CORE_INDUSTRIAL_TYPES = new Set(["consumer", "industrial", "it-services"]);
const FINANCIAL_TYPES = new Set(["bank", "nbfc", "insurance"]);
const SECTOR_NATIVE_TYPES = new Set(["utility", "telecom", "cyclical", "loss-maker", "conglomerate"]);

const OUTCOME_POINTS: Record<AuditOutcome, number> = {
  PRODUCTION_READY: 10,
  VALUATION_ELIGIBLE_GUARDED: 8.5,
  ECONOMICALLY_PLAUSIBLE_CAPPED: 6.5,
  EXPECTED_SKIP_MISSING_SIDECAR: 6,
  EXPECTED_SKIP_INSUFFICIENT_HISTORY: 6,
  EXPECTED_SKIP_UNSUPPORTED_SOURCE: 5.5,
  MODEL_GAP: 3,
  POLICY_WARNING: 7,
  CALC_ERROR: 0,
};

const RIGOR_POINTS: Record<string, number> = {
  "production-ready": 10,
  "valuation-eligible": 9,
  "economically-plausible": 7.5,
  "structurally-reconciled": 7,
  "syntactically-valid": 4,
};

function roundScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

function average(values: number[], fallback = 0): number {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function compactList(values: string[], limit = 4): string {
  const unique = dedupe(values).filter(Boolean);
  if (unique.length <= limit) return unique.join(", ");
  return `${unique.slice(0, limit).join(", ")} +${unique.length - limit} more`;
}

function familyStatus(score: number): ScorecardFamilyStatus {
  if (score >= 8.5) return "strong";
  if (score >= 7) return "guarded";
  if (score >= 5) return "gap";
  return "blocked";
}

function ratingForScore(score: number): ValuationMaturityRating {
  if (score >= 9.5) return "institutional";
  if (score >= 8) return "reviewer-ready";
  if (score >= 6.5) return "guarded";
  return "developing";
}

function makeFamily(
  id: ScorecardFamilyId,
  score: number,
  sampleSize: number,
  evidence: string[],
  blockers: string[],
): ValuationMaturityFamilyScore {
  const spec = SCORECARD_FAMILIES.find((family) => family.id === id);
  if (!spec) throw new Error(`Unknown scorecard family: ${id}`);
  const rounded = roundScore(score);
  return {
    ...spec,
    score: rounded,
    status: familyStatus(rounded),
    sampleSize,
    evidence: dedupe(evidence).filter(Boolean),
    blockers: dedupe(blockers).filter(Boolean),
  };
}

function outcomeScore(row: ValuationScorecardAuditRow): number {
  return OUTCOME_POINTS[row.outcome];
}

function rowsForTypes(rows: ValuationScorecardAuditRow[], types: Set<string>): ValuationScorecardAuditRow[] {
  return rows.filter((row) => types.has(row.companyType));
}

function countOutcomes(rows: ValuationScorecardAuditRow[], predicate: (outcome: AuditOutcome) => boolean): number {
  return rows.filter((row) => predicate(row.outcome)).length;
}

function scoreIndustrialCore(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  const scoped = rowsForTypes(rows, CORE_INDUSTRIAL_TYPES);
  const actionable = scoped.filter((row) => row.outcome === "POLICY_WARNING" || row.outcome === "MODEL_GAP" || row.outcome === "CALC_ERROR");
  return makeFamily(
    "industrial-core",
    average(scoped.map(outcomeScore)),
    scoped.length,
    [
      `${scoped.length}/${rows.length} audited rows are core industrial/consumer/IT-services`,
      scoped.length ? `Outcomes: ${compactList(scoped.map((row) => row.outcome))}` : "No core industrial rows in this audit sample",
    ],
    actionable.length ? [`${plural(actionable.length, "core row")} still carry policy/model/calculation blockers`] : [],
  );
}

function scoreFinancialCoverage(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  const scoped = rowsForTypes(rows, FINANCIAL_TYPES);
  const expectedSkips = scoped.filter((row) => isExpectedSkipOutcome(row.outcome)).length;
  const modelGaps = scoped.filter((row) => row.outcome === "MODEL_GAP" || row.outcome === "CALC_ERROR").length;
  const contributingModels = scoped.map((row) => row.models.length).filter((count) => count > 0);
  return makeFamily(
    "financial-institution-coverage",
    average(scoped.map(outcomeScore)),
    scoped.length,
    [
      `${scoped.length}/${rows.length} audited rows are banks, NBFCs, or insurers`,
      contributingModels.length ? `Contributing model counts: ${compactList(contributingModels.map(String))}` : "No contributing FI valuation models in sample",
    ],
    [
      expectedSkips ? `${expectedSkips} expected financial-institution skip requires source sidecar/freshness follow-up` : "",
      modelGaps ? `${plural(modelGaps, "financial row")} still have model/calculation gaps` : "",
    ],
  );
}

function isSectorNativeStrategy(row: ValuationScorecardAuditRow): boolean {
  const strategy = row.pipelineStrategyId ?? "";
  if (!SECTOR_NATIVE_TYPES.has(row.companyType)) return false;
  if (row.companyType === "conglomerate") return row.models.some((model) => model.toUpperCase().includes("SOTP"));
  return strategy !== "industrial-v1" && strategy.toLowerCase().includes(row.companyType);
}

function scoreSectorNativeCoverage(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  const scoped = rowsForTypes(rows, SECTOR_NATIVE_TYPES);
  const rowScores = scoped.map((row) => {
    if (isSectorNativeStrategy(row)) return Math.max(7, outcomeScore(row));
    return Math.min(4, outcomeScore(row));
  });
  const nonNative = scoped.filter((row) => !isSectorNativeStrategy(row));
  return makeFamily(
    "sector-native-coverage",
    average(rowScores),
    scoped.length,
    [
      `${scoped.length}/${rows.length} audited rows need sector-native economics`,
      scoped.length ? `Sector types: ${compactList(scoped.map((row) => row.companyType))}` : "No sector-native rows in this audit sample",
    ],
    nonNative.map((row) => `${row.companyType} remains routed through ${row.pipelineStrategyId ?? "unknown"} instead of a sector-native model`),
  );
}

function scoreLensIndependence(row: ValuationScorecardAuditRow): number {
  if (row.outcome === "CALC_ERROR") return 0;

  const independentGroups = row.valuationEvidence.independentLensGroups.length;
  const triangulationMethods = row.valuationEvidence.triangulationMethods.length;
  if (independentGroups >= 2 && triangulationMethods >= 2 && row.models.length >= 2) return 9.5;
  if (independentGroups >= 2 && row.models.length >= 2) return 8.5;
  if (triangulationMethods >= 2 && row.models.length >= 2) return 8;
  if (row.models.length >= 4) return 8.5;
  if (row.models.length === 3) return 7;
  if (row.models.length === 2) return 5.5;
  if (row.models.length === 1) return 4;
  return isExpectedSkipOutcome(row.outcome) ? 4 : 3;
}

function scoreCrossParadigmIndependence(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  const singleLens = rows.filter((row) => row.models.length <= 1 && row.outcome !== "CALC_ERROR").length;
  const missingEvidence = rows.filter((row) =>
    row.outcome !== "CALC_ERROR"
    && row.valuationEvidence.triangulationMethods.length === 0
    && row.valuationEvidence.independentLensGroups.length === 0,
  ).length;
  const triangulationMethods = rows.flatMap((row) => row.valuationEvidence.triangulationMethods.map((method) => method.key));
  const independentGroups = rows.flatMap((row) => row.valuationEvidence.independentLensGroups);

  return makeFamily(
    "cross-paradigm-independence",
    average(rows.map(scoreLensIndependence)),
    rows.length,
    [
      `${rows.length} audited rows assessed for contributing valuation lenses`,
      `Model sets: ${compactList(rows.map((row) => row.models.length ? row.models.join("+") : "none"))}`,
      triangulationMethods.length ? `Triangulation methods: ${compactList(triangulationMethods)}` : "No explicit triangulation methods captured in audit rows",
      independentGroups.length ? `Independent lens groups: ${compactList(independentGroups)}` : "No independent lens groups captured in audit rows",
    ],
    [
      singleLens ? `${singleLens}/${rows.length} audited rows still rely on a single valuation spine` : "",
      missingEvidence ? `${missingEvidence}/${rows.length} audited rows lack triangulation/independence evidence` : "",
    ],
  );
}

function rigorScore(row: ValuationScorecardAuditRow): number {
  if (row.outcome === "CALC_ERROR") return 0;
  let score = RIGOR_POINTS[row.rigor.currentLevel ?? ""] ?? 3;
  if (row.rigor.parserFidelityStatus === "pass") score += 0.4;
  if (row.rigor.reconciliationStatus === "pass") score += 0.4;
  if (row.outcome === "POLICY_WARNING") score = Math.min(score, 7);
  if (isExpectedSkipOutcome(row.outcome)) score = Math.min(score, 6.5);
  return Math.min(10, score);
}

function scoreTraceability(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  const levels = rows.map((row) => row.rigor.currentLevel ?? "unknown");
  const readinessStatuses = rows.map((row) => row.valuationEvidence.readinessStatus ?? "unknown");
  const unknownReadiness = readinessStatuses.filter((status) => status === "unknown").length;
  const calcErrors = rows.filter((row) => row.outcome === "CALC_ERROR").length;
  const syntacticOnly = rows.filter((row) => row.rigor.currentLevel === "syntactically-valid").length;
  const productionReady = rows.filter((row) => row.rigor.currentLevel === "production-ready").length;
  return makeFamily(
    "traceability-reconciliation-fail-closed",
    average(rows.map(rigorScore)),
    rows.length,
    [
      `Rigor levels: ${compactList(levels)}`,
      `Valuation readiness statuses: ${compactList(readinessStatuses)}`,
      `${productionReady}/${rows.length} audited rows reached production-ready rigor`,
    ],
    [
      calcErrors ? `${plural(calcErrors, "row")} have calculation errors and fail closed` : "",
      syntacticOnly ? `${plural(syntacticOnly, "row")} remain at syntactically-valid rigor` : "",
      unknownReadiness ? `${plural(unknownReadiness, "row")} lack valuation readiness evidence` : "",
      productionReady === 0 && rows.length > 0 ? "No audited row currently clears the production-ready gate" : "",
    ],
  );
}

function scoreDataFreshness(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  const withPeriods = rows.filter((row) => row.periods > 0).length;
  const withLatest = rows.filter((row) => row.latestPeriod).length;
  const base = rows.length === 0 ? 0 : 4.5 + (withPeriods / rows.length) + (withLatest / rows.length);
  return makeFamily(
    "data-freshness-source-tieout",
    Math.min(6, base),
    rows.length,
    [
      `${withPeriods}/${rows.length} audited rows have parsed periods`,
      `${withLatest}/${rows.length} audited rows expose latest period labels`,
    ],
    ["source hashes, source-cell tieout, and market freshness are not yet first-class scorecard inputs"],
  );
}

function scoreWorkbookDefensibility(rows: ValuationScorecardAuditRow[]): ValuationMaturityFamilyScore {
  return makeFamily(
    "workbook-reviewer-defensibility",
    rows.length > 0 ? 6.5 : 0,
    rows.length,
    [
      "Shared trust envelope is surfaced across core UI/report tabs",
      "Audit CLI now emits family, strategy, status class, and taxonomy outcome for each row",
    ],
    ["workbook parity, reviewer pack, and print/export evidence are not yet part of the release gate"],
  );
}

function scoreEngineeringQuality(rows: ValuationScorecardAuditRow[], calcErrors: number): ValuationMaturityFamilyScore {
  const score = calcErrors > 0 ? 6.5 : 8.5;
  return makeFamily(
    "engineering-release-quality",
    score,
    rows.length,
    [
      `Audit harness completed ${rows.length} rows with ${calcErrors} CALC_ERROR outcomes`,
      "Repository exposes validate, release validation, golden tests, and all-company audit scripts",
    ],
    calcErrors > 0 ? [`${plural(calcErrors, "calculation error")} must be fixed before release confidence improves`] : [],
  );
}

function emptyOutcomeCounts(): Record<AuditOutcome, number> {
  return Object.fromEntries(AUDIT_OUTCOMES.map((outcome) => [outcome, 0])) as Record<AuditOutcome, number>;
}

function companyTypeCounts(rows: ValuationScorecardAuditRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.companyType] = (counts[row.companyType] ?? 0) + 1;
  return counts;
}

function outcomeCounts(rows: ValuationScorecardAuditRow[]): Record<AuditOutcome, number> {
  const counts = emptyOutcomeCounts();
  for (const row of rows) counts[row.outcome] += 1;
  return counts;
}

export function buildValuationMaturityScorecard(
  rows: ValuationScorecardAuditRow[],
  options: BuildValuationMaturityScorecardOptions = {},
): ValuationMaturityScorecard {
  const outcomes = outcomeCounts(rows);
  const calcErrors = outcomes.CALC_ERROR;
  const families = [
    scoreIndustrialCore(rows),
    scoreFinancialCoverage(rows),
    scoreSectorNativeCoverage(rows),
    scoreCrossParadigmIndependence(rows),
    scoreTraceability(rows),
    scoreDataFreshness(rows),
    scoreWorkbookDefensibility(rows),
    scoreEngineeringQuality(rows, calcErrors),
  ];
  const totalWeight = SCORECARD_FAMILIES.reduce((sum, family) => sum + family.weight, 0);
  const overallScore = roundScore(families.reduce((sum, family) => sum + family.score * family.weight, 0) / totalWeight);

  return {
    schemaVersion: SCORECARD_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    totalWeight,
    overallScore,
    rating: ratingForScore(overallScore),
    corpus: {
      companies: rows.length,
      companyTypes: companyTypeCounts(rows),
      outcomes,
      calcErrors,
      actionable: countOutcomes(rows, isActionableAuditOutcome),
      expectedSkips: countOutcomes(rows, isExpectedSkipOutcome),
    },
    families,
  };
}

function markdownCell(values: string[]): string {
  if (!values.length) return "—";
  return values.join("; ").replace(/\|/g, "/");
}

export function renderScorecardMarkdown(scorecard: ValuationMaturityScorecard): string {
  const lines: string[] = [];
  lines.push("# Valuation Maturity Scorecard");
  lines.push("");
  lines.push(`Generated: ${scorecard.generatedAt}`);
  lines.push(`Schema: \`${scorecard.schemaVersion}\``);
  lines.push(`Overall score: **${scorecard.overallScore.toFixed(1)}/10** (${scorecard.rating})`);
  lines.push(`Audited corpus: ${scorecard.corpus.companies} companies; total weight ${scorecard.totalWeight}`);
  lines.push("");
  lines.push("## Current Baseline and Target");
  lines.push("");
  lines.push(`- Current score: **${scorecard.overallScore.toFixed(1)}/10**.`);
  lines.push(`- Current rating: \`${scorecard.rating}\`.`);
  lines.push("- Target score: **10.0/10**.");
  lines.push("- Target state: no supported company type is silently routed through the wrong valuation family; unsupported source or sidecar gaps are explicit expected skips, not crashes or green badges.");
  lines.push("- Baseline artifact source: `npx tsx scripts/valuation-scorecard.ts --format md` over the audited company registry.");
  lines.push("- Machine-readable source: `npx tsx scripts/valuation-scorecard.ts --format json`.");
  lines.push("");
  lines.push("This score is intentionally conservative. It measures the current end-to-end corpus after the company-type-aware audit harness and skip/error taxonomy landed, not the aspirational 10/10 roadmap. A low family score is a work queue, not a reason to route companies through weaker generic models.");
  lines.push("");
  lines.push("## Expected skips are not bugs");
  lines.push("");
  lines.push("Expected skips are not bugs. They are deliberate fail-closed outcomes for cases where the model needs a source, sidecar, or support contract that is not present yet:");
  lines.push("");
  lines.push("- `EXPECTED_SKIP_MISSING_SIDECAR` — a required sidecar such as insurance EV/VNB, source tieout, or another sector-specific source pack is absent.");
  lines.push("- `EXPECTED_SKIP_INSUFFICIENT_HISTORY` — the company has too few usable periods for the requested valuation or maturity gate.");
  lines.push("- `EXPECTED_SKIP_UNSUPPORTED_SOURCE` — the current source mode or source artifact is not yet covered by the required parser/diagnostic contract.");
  lines.push("");
  lines.push("These rows should count against maturity until the missing contract is implemented, but they must not be reported as `CALC_ERROR`. A calculation error means the code failed or emitted invalid numeric output; an expected skip means the system refused to overstate confidence.");
  lines.push("");
  lines.push("## Family Scores");
  lines.push("");
  lines.push("| Family | Weight | Score | Status | Evidence | Blockers |");
  lines.push("|---|---:|---:|---|---|---|");
  for (const family of scorecard.families) {
    lines.push(
      `| ${family.label} | ${family.weight} | ${family.score.toFixed(1)} | ${family.status} | ` +
      `${markdownCell(family.evidence)} | ${markdownCell(family.blockers)} |`,
    );
  }
  lines.push("");
  lines.push("## Audit Outcomes");
  lines.push("");
  for (const outcome of AUDIT_OUTCOMES) {
    lines.push(`- ${outcome}: ${scorecard.corpus.outcomes[outcome]}`);
  }
  lines.push("");
  lines.push(`Calculation errors: ${scorecard.corpus.calcErrors}`);
  lines.push(`Expected skips: ${scorecard.corpus.expectedSkips}`);
  lines.push(`Actionable rows: ${scorecard.corpus.actionable}`);
  lines.push("");
  lines.push("## Company-Type Mix");
  lines.push("");
  for (const [companyType, count] of Object.entries(scorecard.corpus.companyTypes).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${companyType}: ${count}`);
  }
  lines.push("");
  return lines.join("\n");
}
