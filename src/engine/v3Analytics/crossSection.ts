/* ══════════════════════════════════════════════════════════════════
   S-13.3 — Cross-section consistency assertions
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ./shared only — no back-edge to v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { CanonicalOutputRegistry } from "./shared";

export interface CrossSectionRenderedBundle {
  header: string;
  section1: string;
  section5?: string | undefined;
  section6?: string | undefined;
  section6A?: string | undefined;
  section7?: string | undefined;
  section6A1RowCount?: number | undefined;
  /** For assertion 9: per-ke row with g values ascending and corresponding valuations */
  sensitivity?: Array<{ ke: number; values: number[]; g: number[] }>;
}

function parseFirstNumber(text: string): number | null {
  const m = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

function extractAfterToken(text: string, token: string): number | null {
  const idx = text.toLowerCase().indexOf(token.toLowerCase());
  if (idx < 0) return null;
  return parseFirstNumber(text.slice(idx + token.length));
}

export function runCrossSectionAssertions(registry: CanonicalOutputRegistry, rendered: CrossSectionRenderedBundle): string[] {
  const issues: string[] = [];

  // ASSERTION 1: §1 terminal anchor label matches primary
  const anchor = registry.get<string>("primary_anchor_label");
  if (anchor && !rendered.section1.includes(anchor)) issues.push(`§1 anchor mismatch: expected '${anchor}'.`);

  // ASSERTION 2: §1 TV grade matches primary (guarded) grade
  const tvGrade = registry.get<string>("tv_grade");
  if (tvGrade && rendered.section1.includes("GRADE_") && !rendered.section1.includes(tvGrade)) issues.push(`§1 TV grade mismatch: expected '${tvGrade}'.`);

  // ASSERTION 3: Header V matches registry V_primary
  const vPrimaryHeader = registry.get<number>("V_primary");
  const headerV = parseFirstNumber(rendered.header);
  if (vPrimaryHeader != null && headerV != null) {
    const rel = Math.abs(headerV - vPrimaryHeader) / Math.max(Math.abs(vPrimaryHeader), 1);
    if (rel > 0.001) issues.push(`Header V mismatch: header=${headerV}, registry=${vPrimaryHeader}.`);
  }

  // ASSERTION 4: §1 g_effective matches registry
  const g = registry.get<number>("g_effective");
  if (g != null) {
    const pctToken = `${(g * 100).toFixed(1)}%`;
    if (rendered.section1.includes("g =") && !rendered.section1.includes(pctToken)) issues.push("§1 g mention inconsistent with registry.g_effective.");
  }

  // ASSERTION 5: §7 PM warning threshold matches registry
  const pmWarn = registry.get<number>("pm_warning_threshold");
  if (pmWarn != null && rendered.section7 && rendered.section7.includes("falls below")) {
    const token = `${Math.round(pmWarn * 100)}%`;
    if (!rendered.section7.includes(token)) issues.push("§7 PM warning threshold inconsistent with registry.");
  }

  // ASSERTION 6: §1 DS figure matches §5 DS figure (S-13.3)
  const dsAll = registry.get<number>("DS_cumulative_all");
  if (dsAll != null && rendered.section5 && rendered.section1) {
    const ds1 = extractAfterToken(rendered.section1, "dirty");
    const ds5 = extractAfterToken(rendered.section5, "dirty");
    if (ds1 != null && ds5 != null) {
      const rel = Math.abs(ds1 - ds5) / Math.max(Math.abs(ds1), 1);
      if (rel > 0.01) issues.push(`§1 DS=${ds1} differs from §5 DS=${ds5}.`);
    }
  }

  // ASSERTION 7: Company ID in trigger labels matches header company ID
  const companyId = registry.get<string>("company_id");
  if (companyId && rendered.section7) {
    const labels = Array.from(rendered.section7.matchAll(/([A-Za-z0-9_.-]+)-specific trigger/g)).map((m) => m[1]);
    for (const label of labels) {
      if (label !== companyId) issues.push(`§7 trigger label '${label}-specific' does not match company_id '${companyId}'.`);
    }
  }

  // ASSERTION 8: §6A.1 RE row count = periods - 1
  const nPeriods = registry.get<number>("period_count");
  if (nPeriods && rendered.section6A1RowCount != null && rendered.section6A1RowCount !== Math.max(0, nPeriods - 1)) {
    issues.push(`§6A.1 row count mismatch: got ${rendered.section6A1RowCount}, expected ${nPeriods - 1}.`);
  }

  // ASSERTION 9: Sensitivity matrix monotonicity (S-13.3)
  if (rendered.sensitivity && rendered.sensitivity.length > 0) {
    for (const row of rendered.sensitivity) {
      for (let i = 0; i < row.values.length - 1; i++) {
        if (row.values[i]! > row.values[i + 1]! + 0.01) {
          issues.push(`Sensitivity matrix non-monotonic at ke=${(row.ke * 100).toFixed(1)}%: V(g[${i}])=${row.values[i]!.toFixed(0)} > V(g[${i+1}])=${row.values[i + 1]!.toFixed(0)}.`);
        }
      }
    }
    const colCount = rendered.sensitivity[0]!.values.length;
    const rowsByKe = [...rendered.sensitivity].sort((a, b) => a.ke - b.ke);
    for (let c = 0; c < colCount; c++) {
      for (let i = 0; i < rowsByKe.length - 1; i++) {
        if (rowsByKe[i]!.values[c]! < rowsByKe[i + 1]!.values[c]! - 0.01) {
          issues.push(`Sensitivity matrix not decreasing in ke for g-column ${c}.`);
          break;
        }
      }
    }
  }

  // ASSERTION 10: If contamination is GUARDED/COMPROMISED, V_primary ≠ V_RE_CV3_reported (S-13.3)
  const vPrimary = registry.get<number>("V_primary");
  const vReported = registry.get<number>("V_RE_CV3_reported");
  const contaminationTier = registry.get<string>("contamination_tier");
  const anchorLabel = registry.get<string>("primary_anchor_label");
  if (
    vPrimary != null && vReported != null &&
    (contaminationTier === "GUARDED" || contaminationTier === "COMPROMISED" || (
      anchorLabel != null && anchorLabel !== "RE_T (as reported)" && anchorLabel !== "RE_T (as reported, with warnings)"
    ))
  ) {
    if (Math.abs(vPrimary - vReported) < 1) {
      issues.push(`V_primary equals V_RE_CV3_reported despite contamination guard (tier='${contaminationTier ?? "N/A"}', anchor='${anchorLabel ?? "N/A"}').`);
    }
  }

  return issues;
}
