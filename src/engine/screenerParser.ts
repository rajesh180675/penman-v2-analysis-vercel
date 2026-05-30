import { RawPeriodData } from "./types";
import { SourceParserDiagnostics } from "./parserDiagnostics";

type ParseOpts = { companyId?: string };

function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t || t === "-" || t === "—") return null;
  const neg = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/[(),%\s]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function toIsoYear(label: string): string | null {
  const y = label.match(/(20\d{2}|19\d{2})/);
  if (!y) return null;
  return `${y[1]}-03-31`;
}

export function parseScreenerTabDelimited(input: string, opts: ParseOpts = {}): RawPeriodData[] {
  return parseScreenerTabDelimitedDetailed(input, opts).periods;
}

export function parseScreenerTabDelimitedDetailed(input: string, opts: ParseOpts = {}): {
  periods: RawPeriodData[];
  diagnostics: SourceParserDiagnostics;
} {
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) {
    return {
      periods: [],
      diagnostics: {
        sourceMode: "screener",
        warningCount: 0,
        errorCount: 1,
        checks: [
          {
            id: "screener-lines-present",
            label: "Non-empty rows present",
            passed: false,
            detail: "No non-empty Screener rows were provided.",
          },
        ],
      },
    };
  }
  const rows = lines.map((l) => l.split(/\t+/));
  const header = rows[0] ?? [];
  const years = header.slice(1).map(toIsoYear);
  const invalidYearHeaders = header.slice(1).filter((cell, index) => cell.trim().length > 0 && !years[index]).length;
  const validCols = years
    .map((p, i) => ({ p, i: i + 1 }))
    .filter((x): x is { p: string; i: number } => Boolean(x.p));
  const periods = validCols.map(({ p }) => ({
    company_id: opts.companyId ?? "SCREENER",
    period_end: p,
    raw_metric_values: {} as Record<string, number | null>,
  }));
  const metricCounts = new Map<string, number>();
  let metricRowCount = 0;
  let invalidNumericCells = 0;
  for (let r = 1; r < rows.length; r++) {
    const metric = (rows[r]?.[0] ?? "").trim();
    if (!metric) continue;
    metricRowCount += 1;
    metricCounts.set(metric, (metricCounts.get(metric) ?? 0) + 1);
    for (let c = 0; c < validCols.length; c++) {
      const { i } = validCols[c]!;
      const rawCell = rows[r]?.[i] ?? "";
      const parsed = parseNumber(rawCell);
      if (rawCell.trim().length > 0 && rawCell.trim() !== "-" && rawCell.trim() !== "—" && parsed === null) {
        invalidNumericCells += 1;
      }
      periods[c]!.raw_metric_values[metric] = parsed;
    }
  }
  const duplicateMetricCount = Array.from(metricCounts.values()).filter((count) => count > 1).length;
  const warningCount = [invalidYearHeaders > 0, duplicateMetricCount > 0].filter(Boolean).length;
  const errorCount = [validCols.length === 0, metricRowCount === 0, invalidNumericCells > 0].filter(Boolean).length;

  return {
    periods,
    diagnostics: {
      sourceMode: "screener",
      warningCount,
      errorCount,
      checks: [
        {
          id: "screener-years-detected",
          label: "Year columns detected",
          passed: validCols.length > 0,
          detail: validCols.length > 0
            ? `Detected ${validCols.length} year columns in the Screener header.`
            : "No recognizable year columns were found in the Screener header row.",
        },
        {
          id: "screener-metric-rows",
          label: "Metric rows present",
          passed: metricRowCount > 0,
          detail: metricRowCount > 0
            ? `Parsed ${metricRowCount} labeled metric rows.`
            : "No labeled metric rows were found after the Screener header.",
        },
        {
          id: "screener-duplicate-metrics",
          label: "Duplicate row labels",
          passed: duplicateMetricCount === 0,
          detail: duplicateMetricCount === 0
            ? "No duplicate Screener row labels were detected."
            : `${duplicateMetricCount} metric labels were repeated in the pasted Screener table.`,
        },
        {
          id: "screener-numeric-cells",
          label: "Numeric cells parsed",
          passed: invalidNumericCells === 0,
          detail: invalidNumericCells === 0
            ? "Every non-blank Screener numeric cell parsed cleanly."
            : `${invalidNumericCells} non-blank Screener cells could not be parsed as numbers.`,
        },
        {
          id: "screener-header-noise",
          label: "Header noise",
          passed: invalidYearHeaders === 0,
          detail: invalidYearHeaders === 0
            ? "All non-empty Screener header columns resolved to periods."
            : `${invalidYearHeaders} non-empty Screener header columns did not resolve to fiscal years.`,
        },
      ],
    },
  };
}
