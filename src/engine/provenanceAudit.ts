import { RecastPeriod } from "./types";

export interface ProvenanceAuditRow {
  line: string;
  statement: string;
  key: string;
  matchType: string;
  occurrences: number;
  avgValue: number;
  minValue: number;
  maxValue: number;
}

export interface MappingDiscrepancyRow {
  line: string;
  issueType: "duplicate_source_ignored" | "unmatched" | "fuzzy_match";
  key: string;
  occurrences: number;
}

export function buildProvenanceAuditRows(periods: RecastPeriod[]): ProvenanceAuditRow[] {
  const grouped = new Map<
    string,
    {
      line: string;
      statement: string;
      key: string;
      matchType: string;
      n: number;
      sum: number;
      min: number;
      max: number;
    }
  >();

  for (const p of periods) {
    if (!p.trace) continue;
    for (const [line, entries] of Object.entries(p.trace)) {
      for (const e of entries) {
        const k = `${line}||${e.statement}||${e.key}||${e.matchType}`;
        const g = grouped.get(k);
        if (!g) {
          grouped.set(k, {
            line,
            statement: e.statement,
            key: e.key,
            matchType: e.matchType,
            n: 1,
            sum: e.value,
            min: e.value,
            max: e.value,
          });
        } else {
          g.n += 1;
          g.sum += e.value;
          g.min = Math.min(g.min, e.value);
          g.max = Math.max(g.max, e.value);
        }
      }
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.line.localeCompare(b.line) || a.statement.localeCompare(b.statement))
    .map((g) => ({
      line: g.line,
      statement: g.statement,
      key: g.key,
      matchType: g.matchType,
      occurrences: g.n,
      avgValue: g.sum / g.n,
      minValue: g.min,
      maxValue: g.max,
    }));
}

export function buildMappingDiscrepancyRows(periods: RecastPeriod[]): MappingDiscrepancyRow[] {
  const grouped = new Map<string, MappingDiscrepancyRow>();

  const upsert = (line: string, issueType: MappingDiscrepancyRow["issueType"], key: string) => {
    const id = `${line}||${issueType}||${key}`;
    const row = grouped.get(id);
    if (!row) {
      grouped.set(id, { line, issueType, key, occurrences: 1 });
      return;
    }
    row.occurrences += 1;
  };

  for (const p of periods) {
    if (!p.trace) continue;
    for (const [line, entries] of Object.entries(p.trace)) {
      const hasResolvedSource = entries.some(
        (entry) =>
          entry.statement !== "Derived"
          && entry.note !== "unmatched"
          && !entry.note?.startsWith("duplicate_source_ignored:")
      );

      for (const e of entries) {
        if (e.note?.startsWith("duplicate_source_ignored:")) {
          upsert(line, "duplicate_source_ignored", e.key);
        }
        if (e.note === "unmatched" && !hasResolvedSource) {
          upsert(line, "unmatched", e.key);
        }
        if (e.matchType === "fuzzy") {
          upsert(line, "fuzzy_match", e.key);
        }
      }
    }
  }

  return Array.from(grouped.values()).sort(
    (a, b) =>
      a.line.localeCompare(b.line)
      || a.issueType.localeCompare(b.issueType)
      || b.occurrences - a.occurrences
      || a.key.localeCompare(b.key),
  );
}
