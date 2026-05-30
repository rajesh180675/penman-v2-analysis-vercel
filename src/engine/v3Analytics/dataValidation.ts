/* ================================================================
   v3Analytics decomposition — §2.5 Data Validation cluster.

   Lifted verbatim from src/engine/v3Analytics.ts. Depends only on
   the RecastPeriod shape (imported DOWN from ../types/recast), so it
   forms no back-edge to the parent. v3Analytics.ts re-exports the
   public surface, leaving external import paths unchanged.

   Behaviour byte-for-byte identical.
================================================================ */

import type { RecastPeriod } from "../types/recast";

export interface DataValidationResult {
  checks: Array<{
    id: string;
    description: string;
    period?: string | undefined;
    passed: boolean;
    severity: "ERROR" | "WARNING";
    detail?: string | undefined;
  }>;
  errors: number;
  warnings: number;
}

export function runDataValidation(periods: RecastPeriod[]): DataValidationResult {
  const checks: DataValidationResult["checks"] = [];
  // CHECK_5: Minimum periods
  if (periods.length < 5) {
    checks.push({
      id: "CHECK_5a",
      description: "Insufficient data — at least 5 periods required",
      passed: false,
      severity: "ERROR",
      detail: `Only ${periods.length} periods found`,
    });
  } else if (periods.length < 10) {
    checks.push({
      id: "CHECK_5b",
      description: "Fewer than 10 periods — company-specific fade parameter estimation disabled",
      passed: false,
      severity: "WARNING",
      detail: `${periods.length} periods found`,
    });
  } else {
    checks.push({
      id: "CHECK_5",
      description: "Minimum period count",
      passed: true,
      severity: "WARNING",
    });
  }
  // CHECK_3: Sign consistency
  for (const p of periods) {
    if (p.bs.TA <= 0) {
      checks.push({
        id: "CHECK_3",
        description: "Sign convention violation",
        period: p.period_end,
        passed: false,
        severity: "ERROR",
        detail: `Total assets = ${p.bs.TA}`,
      });
    }
    if (p.is.Sales <= 0) {
      checks.push({
        id: "CHECK_3b",
        description: "Revenue non-positive",
        period: p.period_end,
        passed: false,
        severity: "ERROR",
        detail: `Sales = ${p.is.Sales}`,
      });
    }
  }
  // CHECK_1: Balance sheet approximate balance
  for (const p of periods) {
    const totalFinancing = p.bs.CSE + p.bs.MI + p.bs.FO + p.bs.OL;
    const gap = Math.abs(p.bs.TA - totalFinancing);
    if (p.bs.TA > 0 && gap / p.bs.TA > 0.05) {
      checks.push({
        id: "CHECK_1",
        description: "Balance sheet does not balance",
        period: p.period_end,
        passed: false,
        severity: "WARNING",
        detail: `Gap = ₹${gap.toFixed(0)} Cr (${((gap / p.bs.TA) * 100).toFixed(1)}% of TA)`,
      });
    }
  }
  // CHECK_4: Temporal consistency
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i]!;
    const prev = periods[i - 1]!;
    if (prev.bs.TA > 0) {
      const taRatio = cur.bs.TA / prev.bs.TA;
      if (taRatio > 3.0 || taRatio < 0.33) {
        checks.push({
          id: "CHECK_4a",
          description: "Total assets changed by >3× YoY",
          period: cur.period_end,
          passed: false,
          severity: "WARNING",
          detail: `Ratio = ${taRatio.toFixed(2)}×`,
        });
      }
    }
    if (prev.is.Sales > 0) {
      const salesRatio = cur.is.Sales / prev.is.Sales;
      if (salesRatio > 2.5 || salesRatio < 0.4) {
        checks.push({
          id: "CHECK_4b",
          description: "Revenue changed by >2.5× YoY",
          period: cur.period_end,
          passed: false,
          severity: "WARNING",
          detail: `Ratio = ${salesRatio.toFixed(2)}×`,
        });
      }
    }
  }
  const errors = checks.filter((c) => !c.passed && c.severity === "ERROR").length;
  const warnings = checks.filter((c) => !c.passed && c.severity === "WARNING").length;
  return { checks, errors, warnings };
}
