/* ══════════════════════════════════════════════════════════════════
   S-13.4 — Version-change log vs prior registry snapshot
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ./shared only — no back-edge to v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { CanonicalOutputRegistry } from "./shared";

export interface VersionChangeEntry {
  spec_id: string;
  variable: string;
  old_value: number;
  new_value: number;
  delta_pct: number;
  reason: string;
  category: "bug_fix" | "methodology" | "data" | "config" | "unknown";
}

export function compareWithPriorRegistry(
  currentRegistry: CanonicalOutputRegistry,
  priorSnapshot?: Record<string, unknown>,
): VersionChangeEntry[] {
  if (!priorSnapshot) return [];
  const tracked: Array<[string, string]> = [
    ["V_RE_CV3_reported", "RE CV3 (as-reported)"],
    ["V_primary", "Primary valuation"],
    ["g_effective", "Effective terminal growth"],
    ["kw_derived_latest", "kw (derived, latest)"],
    ["kw_derived_median", "kw (derived, median)"],
    ["DS_cumulative_all", "Cumulative dirty surplus"],
    ["eq16_residual_latest_pp", "Eq.16 residual (latest, pp)"],
    ["re_reoi_gap_pct", "RE/ReOI identity gap (%)"],
    ["tv_share_primary", "TV share (primary anchor)"],
    ["composite_confidence", "Composite confidence score"],
  ];
  const changes: VersionChangeEntry[] = [];
  for (const [key, label] of tracked) {
    const oldV = priorSnapshot[key];
    const newV = currentRegistry.get<number>(key);
    if (typeof oldV === "number" && typeof newV === "number") {
      const delta = Math.abs(oldV) > 0.001 ? (newV - oldV) / Math.abs(oldV) : (newV === oldV ? 0 : Number.POSITIVE_INFINITY);
      if (Math.abs(delta) > 0.01) {
        changes.push({ spec_id: "S-13.4", variable: label, old_value: oldV, new_value: newV, delta_pct: delta, reason: "[REQUIRES EXPLANATION]", category: "unknown" });
      }
    }
  }
  return changes;
}

export function renderVersionChangeLog(changes: VersionChangeEntry[]): string {
  if (!changes.length) return "";
  const header = `2.6A) Methodology Changes from Prior Version\n\nVariable | Prior | Current | Δ | Reason | Category\n---|---:|---:|---:|---|---\n`;
  return header + changes.map((c) => `${c.variable} | ${c.old_value.toFixed(4)} | ${c.new_value.toFixed(4)} | ${(c.delta_pct * 100).toFixed(1)}% | ${c.reason} | ${c.category}`).join("\n");
}
