import { RawPeriodData } from "./types";

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
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const rows = lines.map((l) => l.split(/\t+/));
  const header = rows[0] ?? [];
  const years = header.slice(1).map(toIsoYear);
  const validCols = years
    .map((p, i) => ({ p, i: i + 1 }))
    .filter((x): x is { p: string; i: number } => Boolean(x.p));
  const periods = validCols.map(({ p }) => ({
    company_id: opts.companyId ?? "SCREENER",
    period_end: p,
    raw_metric_values: {} as Record<string, number | null>,
  }));
  for (let r = 1; r < rows.length; r++) {
    const metric = (rows[r]?.[0] ?? "").trim();
    if (!metric) continue;
    for (let c = 0; c < validCols.length; c++) {
      const { i } = validCols[c];
      periods[c].raw_metric_values[metric] = parseNumber(rows[r]?.[i] ?? "");
    }
  }
  return periods;
}
