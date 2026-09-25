/**
 * Number formats for the next UI. Identical to the current Statements tab's
 * (`RecastStatements.tsx` f / fp), so a figure reads the same in both until
 * cutover; the parity tests hold them together. Null means "no number" — the
 * caller shows Withheld with a reason, never a bare dash.
 */
export const crore = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const percent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : `${(n * 100).toFixed(1)}%`;
