import { CapitalineParseDebug } from "./capitalineParser";
import { RawPeriodData } from "./types";

export type ParserFidelityStatus = "confirmed" | "degraded" | "failed";

export interface ParserFidelityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ParserFidelitySummary {
  status: ParserFidelityStatus;
  score: number;
  summary: string;
  warningCount: number;
  errorCount: number;
  checks: ParserFidelityCheck[];
}

function unionMetricKeyCount(rawData: RawPeriodData[] | null | undefined) {
  if (!rawData?.length) return 0;
  const keys = new Set<string>();
  for (const period of rawData) {
    for (const key of Object.keys(period.raw_metric_values ?? {})) keys.add(key);
  }
  return keys.size;
}

function numericValueCount(rawData: RawPeriodData[] | null | undefined) {
  if (!rawData?.length) return 0;
  let count = 0;
  for (const period of rawData) {
    for (const value of Object.values(period.raw_metric_values ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) count += 1;
    }
  }
  return count;
}

function metricDensity(rawData: RawPeriodData[] | null | undefined) {
  if (!rawData?.length) return 0;
  return numericValueCount(rawData) / rawData.length;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildSummary(status: ParserFidelityStatus, score: number, checks: ParserFidelityCheck[]) {
  const failedChecks = checks.filter((check) => !check.passed);
  if (status === "confirmed") {
    return `Parser fidelity confirmed (${score}/100). All currently wired parser checks passed.`;
  }
  if (status === "degraded") {
    return `Parser fidelity degraded (${score}/100). ${failedChecks[0]?.detail ?? "One or more parser checks need review."}`;
  }
  return `Parser fidelity failed (${score}/100). ${failedChecks[0]?.detail ?? "No trustworthy parsed dataset is available."}`;
}

export function evaluateParserFidelity(params: {
  sourceMode?: string | null;
  rawData?: RawPeriodData[] | null;
  debugInfo?: CapitalineParseDebug | null;
  periodCount?: number;
  rawMetricKeyCount?: number;
}): ParserFidelitySummary {
  const sourceMode = params.sourceMode ?? null;
  const rawData = params.rawData ?? null;
  const debugInfo = params.debugInfo ?? null;
  const periodCount = rawData?.length ?? params.periodCount ?? 0;
  const metricKeyCount = unionMetricKeyCount(rawData) || params.rawMetricKeyCount || 0;
  const perPeriodMetricDensity = metricDensity(rawData);
  const checks: ParserFidelityCheck[] = [];

  if (sourceMode === "capitaline") {
    const fileCount = debugInfo?.files.length ?? 0;
    const detectedPeriods = debugInfo?.detectedPeriods.length ?? periodCount;
    const headerDetectedCount = debugInfo?.rawGrids.filter((grid) => grid.headerDetected).length ?? 0;
    const parserErrorCount = debugInfo?.rawGrids.reduce((sum, grid) => sum + grid.errors.length, 0) ?? 0;
    const warningCount = debugInfo?.warnings.length ?? 0;

    checks.push(
      {
        id: "files-present",
        label: "Statement files present",
        passed: fileCount >= 3,
        detail: fileCount >= 3
          ? `Parsed ${fileCount} Capitaline statement files.`
          : `Expected 3 statement files, but parsed ${fileCount}.`,
      },
      {
        id: "headers-detected",
        label: "Headers detected",
        passed: fileCount > 0 && headerDetectedCount === fileCount,
        detail: fileCount > 0
          ? `Detected headers in ${headerDetectedCount}/${fileCount} files.`
          : "No Capitaline grids were available for header detection.",
      },
      {
        id: "period-consistency",
        label: "Periods reconciled",
        passed: periodCount > 0 && detectedPeriods === periodCount,
        detail: periodCount > 0
          ? `Detected ${detectedPeriods} periods and persisted ${periodCount}.`
          : "No parsed periods were persisted from the Capitaline archive.",
      },
      {
        id: "metric-density",
        label: "Metric density",
        passed: metricKeyCount >= 5 && perPeriodMetricDensity >= 5,
        detail: `Observed ${metricKeyCount} unique metrics at ${perPeriodMetricDensity.toFixed(1)} numeric values per period.`,
      },
      {
        id: "parser-noise",
        label: "Parser noise",
        passed: warningCount === 0 && parserErrorCount === 0,
        detail: `Warnings ${warningCount}; grid parse errors ${parserErrorCount}.`,
      },
    );

    const passRate = checks.filter((check) => check.passed).length / checks.length;
    const score = clampScore((passRate * 100) - (warningCount * 5) - (parserErrorCount * 8));
    const status: ParserFidelityStatus = periodCount === 0 || fileCount === 0 || score < 60
      ? "failed"
      : score < 85 || warningCount > 0 || parserErrorCount > 0
        ? "degraded"
        : "confirmed";
    return {
      status,
      score,
      summary: buildSummary(status, score, checks),
      warningCount,
      errorCount: parserErrorCount,
      checks,
    };
  }

  const warningCount = 0;
  const errorCount = 0;
  const hasPeriods = periodCount > 0;
  const denseEnough = perPeriodMetricDensity >= (sourceMode === "manual" ? 2 : sourceMode === "json" ? 3 : 4);

  checks.push(
    {
      id: "periods-present",
      label: "Periods present",
      passed: hasPeriods,
      detail: hasPeriods
        ? `Parsed ${periodCount} periods.`
        : "No parsed periods were produced.",
    },
    {
      id: "metrics-present",
      label: "Metrics present",
      passed: metricKeyCount > 0,
      detail: metricKeyCount > 0
        ? `Observed ${metricKeyCount} unique raw metrics.`
        : "No raw metrics were persisted.",
    },
    {
      id: "metric-density",
      label: "Metric density",
      passed: denseEnough,
      detail: `Observed ${perPeriodMetricDensity.toFixed(1)} numeric values per period.`,
    },
  );

  if (sourceMode === "xbrl") {
    checks.push({
      id: "xbrl-fact-coverage",
      label: "Mapped XBRL facts",
      passed: metricKeyCount >= 4,
      detail: `Mapped ${metricKeyCount} canonical facts from XBRL contexts.`,
    });
  }

  if (sourceMode === "json") {
    checks.push({
      id: "json-schema-density",
      label: "JSON payload density",
      passed: periodCount > 0 && perPeriodMetricDensity >= 3,
      detail: `JSON ingestion produced ${perPeriodMetricDensity.toFixed(1)} numeric values per period.`,
    });
  }

  const passRate = checks.filter((check) => check.passed).length / checks.length;
  const score = clampScore(passRate * 100);
  const status: ParserFidelityStatus = !hasPeriods || score < 60
    ? "failed"
    : score < 85
      ? "degraded"
      : "confirmed";

  return {
    status,
    score,
    summary: buildSummary(status, score, checks),
    warningCount,
    errorCount,
    checks,
  };
}
