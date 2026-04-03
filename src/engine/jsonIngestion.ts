import { RawPeriodData } from "./types";
import { SourceParserDiagnostics } from "./parserDiagnostics";

export function parseRawPeriodsJson(input: string): RawPeriodData[] {
  return parseRawPeriodsJsonDetailed(input).periods;
}

export function parseRawPeriodsJsonDetailed(input: string): {
  periods: RawPeriodData[];
  diagnostics: SourceParserDiagnostics;
} {
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("JSON must be an array of RawPeriodData objects");
  const companyIds = new Set<string>();
  const periodEnds = new Set<string>();
  let duplicatePeriods = 0;
  let invalidMetricValueCount = 0;
  let emptyMetricPeriods = 0;
  const periods = parsed.map((p) => {
    if (!p || typeof p !== "object") throw new Error("Invalid period object");
    if (!p.company_id || !p.period_end || !p.raw_metric_values) {
      throw new Error("Each period must include company_id, period_end, raw_metric_values");
    }
    const companyId = String(p.company_id);
    const periodEnd = String(p.period_end);
    const rawMetricValues = { ...p.raw_metric_values } as Record<string, number | null>;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      throw new Error(`Invalid period_end: ${periodEnd}`);
    }
    companyIds.add(companyId);
    if (periodEnds.has(periodEnd)) duplicatePeriods += 1;
    periodEnds.add(periodEnd);
    const metricEntries = Object.entries(rawMetricValues);
    if (metricEntries.length === 0) emptyMetricPeriods += 1;
    for (const [, value] of metricEntries) {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        invalidMetricValueCount += 1;
      }
    }
    if (invalidMetricValueCount > 0) {
      throw new Error("JSON raw_metric_values must contain only finite numbers or null.");
    }
    return {
      company_id: String(p.company_id),
      period_end: periodEnd,
      raw_metric_values: rawMetricValues,
    };
  });
  return {
    periods,
    diagnostics: {
      sourceMode: "json",
      warningCount: [companyIds.size > 1, duplicatePeriods > 0, emptyMetricPeriods > 0].filter(Boolean).length,
      errorCount: 0,
      checks: [
        {
          id: "json-period-array",
          label: "Period array present",
          passed: periods.length > 0,
          detail: periods.length > 0
            ? `Parsed ${periods.length} JSON periods.`
            : "The JSON array contained no periods.",
        },
        {
          id: "json-company-consistency",
          label: "Company consistency",
          passed: companyIds.size <= 1,
          detail: companyIds.size <= 1
            ? "All JSON periods share the same company id."
            : `Observed ${companyIds.size} different company ids in one JSON payload.`,
        },
        {
          id: "json-duplicate-periods",
          label: "Duplicate periods",
          passed: duplicatePeriods === 0,
          detail: duplicatePeriods === 0
            ? "No duplicate JSON period_end values were found."
            : `${duplicatePeriods} duplicate JSON period_end values were found.`,
        },
        {
          id: "json-metric-types",
          label: "Metric value types",
          passed: invalidMetricValueCount === 0,
          detail: invalidMetricValueCount === 0
            ? "All JSON metric values are finite numbers or null."
            : `${invalidMetricValueCount} JSON metric values were not finite numbers or null.`,
        },
        {
          id: "json-empty-periods",
          label: "Empty metric objects",
          passed: emptyMetricPeriods === 0,
          detail: emptyMetricPeriods === 0
            ? "Every JSON period included at least one metric."
            : `${emptyMetricPeriods} JSON periods contained no raw metrics.`,
        },
      ],
    },
  };
}
