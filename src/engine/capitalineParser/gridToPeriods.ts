import { AccountingStandard, buildAliasMap } from "../standardAliases";
import { trace } from "../../lib/traceLogger";
import { CapitalineStatement, HeaderInfo, PeriodMap } from "./types";
import { cleanCell, parseNum } from "./cells";

export function gridToPeriods(
  grid: string[][],
  header: HeaderInfo,
  stmt: CapitalineStatement,
  std: AccountingStandard,
  multiplier: number = 1,
  source?: { readonly fileName: string; readonly parserMethod: string } | undefined,
): PeriodMap {
  const out: PeriodMap = new Map();
  const aliasMap = buildAliasMap(std);

  // Phase rigor-1 (May 2026): per-grid drop accounting. Every silent skip
  // path increments a counter so the LIC-style "premium row exists in
  // export but never reaches mappingSpec" failure mode surfaces in trace
  // logs instead of requiring multi-step debugging.
  let rowsSeen = 0;
  let rowsKept = 0;
  let droppedNoMetric = 0;
  let droppedSectionLabel = 0;
  let cellsKeptCanonical = 0;
  let cellsKeptOriginalOnly = 0;
  const droppedLabels: string[] = [];

  for (let r = header.rowIndex + 1; r < grid.length; r++) {
    rowsSeen++;
    const row = grid[r]!;
    const metric = cleanCell(row[header.metricCol] ?? "");
    if (!metric) {
      droppedNoMetric++;
      continue;
    }

    // Skip pure section-heading rows (all value cells blank and metric has no numbers)
    const hasAnyValue = header.periodCols.some((pc) => {
      const raw = pc.col < row.length ? row[pc.col] : "";
      return parseNum(raw) !== null;
    });
    // Allow even zero-value rows — they carry real data (e.g. borrowings = 0)
    // Only skip if no values AND metric is clearly a section label
    if (!hasAnyValue) {
      // Check if it might be a section label by looking for trailing colon or all caps
      const isLabel =
        metric.endsWith(":") ||
        (metric === metric.toUpperCase() && metric.length > 3 && !/\d/.test(metric));
      if (isLabel) {
        droppedSectionLabel++;
        if (droppedLabels.length < 12) droppedLabels.push(metric);
        continue;
      }
    }

    rowsKept++;

    // Phase A: when parsing a non-Ind-AS file, emit BOTH the original label
    // (preserves traceability) AND the canonical Ind-AS label (so existing
    // mappingSpec lookups find the value transparently). The canonical key
    // is only emitted when the row has at least one non-null value AND the
    // canonical key isn't already present from a higher-precedence source.
    const canonicalLabel = aliasMap.get(metric);

    for (const pc of header.periodCols) {
      const cellText = pc.col < row.length ? row[pc.col] : "";
      const value = parseNum(cellText);

      if (!out.has(pc.period_end)) out.set(pc.period_end, new Map());
      const target = out.get(pc.period_end)!;

      // Original label — always written for traceability
      const originalKey = `${metric}__${stmt}`;
      const scaledValue = value != null && multiplier !== 1 ? value * multiplier : value;
      const origin = source ? {
        fileName: source.fileName,
        parserMethod: source.parserMethod,
        row: r + 1,
        column: pc.col + 1,
      } : undefined;
      const existing = target.get(originalKey);
      if (existing === undefined || (existing.value === null && scaledValue !== null)) {
        target.set(originalKey, { value: scaledValue, statement: stmt, standard: std, origin });
        cellsKeptOriginalOnly++;
      }

      // Aliased canonical label — only when value present
      if (canonicalLabel && canonicalLabel !== metric && scaledValue !== null) {
        const canonicalKey = `${canonicalLabel}__${stmt}`;
        const canonExisting = target.get(canonicalKey);
        // Don't overwrite if a higher-precedence standard already wrote the
        // canonical key (that comparison happens in the main merge loop;
        // here we just write if absent or null).
        if (canonExisting === undefined || canonExisting.value === null) {
          target.set(canonicalKey, { value: scaledValue, statement: stmt, standard: std, origin });
          cellsKeptCanonical++;
        }
      }
    }
  }

  // Emit per-grid summary so silent drops are auditable. This is the lever
  // that converts "why isn't <metric> showing up?" from a 30-min debug
  // exercise into a single log scan.
  trace("parse", "gridToPeriods:summary", {
    statement: stmt,
    standard: std,
    multiplier,
    periods: header.periodCols.length,
    rowsSeen,
    rowsKept,
    droppedNoMetric,
    droppedSectionLabel,
    droppedSectionLabelSample: droppedLabels,
    cellsKeptOriginalOnly,
    cellsKeptCanonical,
  });

  return out;
}
