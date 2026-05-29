/* ================================================================
   v3Analytics decomposition — §12 Sensitivity Matrix and Anchor Table.

   Lifted verbatim from src/engine/v3Analytics.ts. Imports DOWN only:
   the TerminalAnchorResult type from the sibling ./terminalValue leaf
   (a lateral leaf-to-leaf type edge; terminalValue does not import
   this module, so no cycle). No back-edge to the parent. v3Analytics.ts
   re-exports the public surface, leaving external import paths
   (V3AnalyticsPanel, AcademicReport) unchanged. Behaviour identical.
================================================================ */

import type { TerminalAnchorResult } from "./terminalValue";

export interface SensMatrixEntry {
  ke: number;
  g: number;
  V_RE_CV3: number;
}
export function computeSensitivityMatrix(
  CSE0: number,
  _sum_PV_RE: number, // already discounted at base ke; we must recompute at grid ke
  RE_stream: Array<{ RE: number; period: string }>,
  selected_RE_anchor: number,
  base_ke: number,
  base_g: number,
  T: number, // number of explicit years
  gFloor = 0.02
): SensMatrixEntry[] {
  // ke grid: [ke-4%, ke-3%, ke-2%, ke, ke+2%] — no values below 5%
  const ke_grid = Array.from(
    new Set([
      Math.max(base_ke - 0.04, 0.05),
      Math.max(base_ke - 0.03, 0.05),
      Math.max(base_ke - 0.02, 0.06),
      base_ke,
      base_ke + 0.02,
    ])
  ).sort((a, b) => a - b);
  // g grid: ascending, max 3 values, capped below ke
  const g_low = Math.max(base_g - 0.02, gFloor);
  const g_mid_raw = Math.floor(base_g * 100) / 100; // round down to nearest 1%
  const g_mid = g_mid_raw < base_g ? g_mid_raw : base_g - 0.01;
  const g_grid = Array.from(new Set([g_low, g_mid, base_g]))
    .filter((g) => g < base_ke)
    .sort((a, b) => a - b);
  const results: SensMatrixEntry[] = [];
  for (const ke_i of ke_grid) {
    // Recompute sum_PV_RE at this ke
    const sum_pv = RE_stream.reduce((s, r, idx) => s + r.RE / Math.pow(1 + ke_i, idx + 1), 0);
    for (const g_j of g_grid) {
      if (ke_i - g_j <= 0) continue; // Gordon formula undefined
      const CV3 = (selected_RE_anchor * (1 + g_j)) / (ke_i - g_j);
      const PV_CV3 = CV3 / Math.pow(1 + ke_i, T);
      const V = CSE0 + sum_pv + PV_CV3;
      results.push({ ke: ke_i, g: g_j, V_RE_CV3: V });
    }
  }
  return results;
}
export interface AnchorTableEntry {
  label: string;
  anchor: number;
  V_RE_CV3: number;
  tv_share: number | null;
}
export function computeAnchorTable(
  CSE0: number,
  sum_PV_RE: number,
  anchorResult: TerminalAnchorResult,
  ke: number,
  T: number
): AnchorTableEntry[] {
  const { g_terminal } = anchorResult;
  const rhoE = 1 + ke;
  const valFromAnchor = (anchor: number) => {
    if (ke - g_terminal <= 0) return CSE0 + sum_PV_RE;
    const CV3 = (anchor * (1 + g_terminal)) / (ke - g_terminal);
    const PV_CV3 = CV3 / Math.pow(rhoE, T);
    return CSE0 + sum_PV_RE + PV_CV3;
  };
  const V_CV1 = CSE0 + sum_PV_RE;
  const entries: AnchorTableEntry[] = [];
  const addEntry = (label: string, anchor: number | null) => {
    if (anchor == null) return;
    const V = valFromAnchor(anchor);
    entries.push({
      label,
      anchor,
      V_RE_CV3: V,
      tv_share: V !== 0 ? (V - V_CV1) / V : null,
    });
  };
  addEntry("RE_T (as reported)", anchorResult.RE_anchor_1);
  addEntry("RE_(T-1) + growth", anchorResult.RE_anchor_2);
  addEntry("3Y median RE", anchorResult.RE_anchor_3);
  return entries;
}
