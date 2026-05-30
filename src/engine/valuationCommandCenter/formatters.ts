export function formatPct(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatPerShare(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${value.toFixed(2)}`;
}

export function formatHistoricalPercentile(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}th percentile`;
}
