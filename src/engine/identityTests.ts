import { RecastPeriod } from "./types";

export type A9FailureReason =
  | "ind-as-transition"
  | "structural-event"
  | "large-dirty-surplus"
  | "unexplained";

export interface IdentityAssertionResult {
  id: "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9";
  label: string;
  period: string;
  lhs: number;
  rhs: number;
  diff: number;
  tolerance: number;
  pass: boolean;
  reasonCode?: A9FailureReason | undefined;
}

function classifyA9Failure(period: RecastPeriod, diff: number): A9FailureReason {
  const labels = new Set((period.spec_flags ?? []).map((flag) => flag.label));
  if (period.period_end.startsWith("2017-")) return "ind-as-transition";
  if (labels.has("STRUCTURAL_EVENT_CRITICAL") || labels.has("STRUCTURAL_EVENT_WARNING")) return "structural-event";
  const dirtySurplusPct = Math.abs(period.ratios?.dirty_surplus_pct_cse ?? 0);
  if (dirtySurplusPct >= 0.05 || Math.abs(diff) >= 0.05) return "large-dirty-surplus";
  return "unexplained";
}

function withReasonCode(result: IdentityAssertionResult, period: RecastPeriod): IdentityAssertionResult {
  if (result.id !== "A9" || result.pass) return result;
  return {
    ...result,
    reasonCode: classifyA9Failure(period, result.diff),
  };
}

function categorizeResults(results: IdentityAssertionResult[]) {
  return results.reduce<Record<A9FailureReason, number>>((acc, result) => {
    if (result.id === "A9" && !result.pass && result.reasonCode) acc[result.reasonCode] += 1;
    return acc;
  }, {
    "ind-as-transition": 0,
    "structural-event": 0,
    "large-dirty-surplus": 0,
    "unexplained": 0,
  });
}

function attachA9Result(results: IdentityAssertionResult[], period: RecastPeriod, result: IdentityAssertionResult) {
  results.push(withReasonCode(result, period));
}

function identitySummary(results: IdentityAssertionResult[]) {
  const passed = results.filter((r) => r.pass).length;
  return {
    passed,
    failed: results.length - passed,
    a9ReasonCounts: categorizeResults(results),
  };
}

function pushIdentityResult(results: IdentityAssertionResult[], period: RecastPeriod, result: IdentityAssertionResult) {
  if (result.id === "A9") {
    attachA9Result(results, period, result);
    return;
  }
  results.push(result);
}

function buildIdentityResult(
  id: IdentityAssertionResult["id"],
  label: string,
  period: string,
  lhs: number,
  rhs: number,
  tolerance: number,
) {
  return asrt(id, label, period, lhs, rhs, tolerance);
}

function pushA9Assertion(results: IdentityAssertionResult[], period: RecastPeriod, lhs: number, rhs: number, tolerance: number) {
  pushIdentityResult(results, period, buildIdentityResult("A9", "ROCE = RNOA + FLEV*SPREAD", period.period_end, lhs, rhs, tolerance));
}

function pushStandardAssertion(results: IdentityAssertionResult[], period: RecastPeriod, id: IdentityAssertionResult["id"], label: string, lhs: number, rhs: number, tolerance: number) {
  pushIdentityResult(results, period, buildIdentityResult(id, label, period.period_end, lhs, rhs, tolerance));
}

function summarizeIdentityResults(results: IdentityAssertionResult[]) {
  return identitySummary(results);
}

function countAssertions(results: IdentityAssertionResult[]) {
  const summary = summarizeIdentityResults(results);
  return {
    passed: summary.passed,
    failed: summary.failed,
    a9ReasonCounts: summary.a9ReasonCounts,
  };
}

function pushAssertion(results: IdentityAssertionResult[], period: RecastPeriod, id: IdentityAssertionResult["id"], label: string, lhs: number, rhs: number, tolerance: number) {
  if (id === "A9") {
    pushA9Assertion(results, period, lhs, rhs, tolerance);
    return;
  }
  pushStandardAssertion(results, period, id, label, lhs, rhs, tolerance);
}

function countByAssertion(results: IdentityAssertionResult[]) {
  const byAssertion: IdentitySuiteReport["byAssertion"] = {
    A1: { passed: 0, failed: 0 },
    A2: { passed: 0, failed: 0 },
    A3: { passed: 0, failed: 0 },
    A4: { passed: 0, failed: 0 },
    A5: { passed: 0, failed: 0 },
    A6: { passed: 0, failed: 0 },
    A7: { passed: 0, failed: 0 },
    A8: { passed: 0, failed: 0 },
    A9: { passed: 0, failed: 0 },
  };
  for (const r of results) {
    if (r.pass) byAssertion[r.id].passed += 1;
    else byAssertion[r.id].failed += 1;
  }
  return byAssertion;
}

export interface IdentitySuiteReport {
  total: number;
  passed: number;
  failed: number;
  byAssertion: Record<string, { passed: number; failed: number }>;
  results: IdentityAssertionResult[];
  a9ReasonCounts: Record<A9FailureReason, number>;
}

export interface IdentitySuiteReport {
  total: number;
  passed: number;
  failed: number;
  byAssertion: Record<string, { passed: number; failed: number }>;
  results: IdentityAssertionResult[];
}

const asrt = (
  id: IdentityAssertionResult["id"],
  label: string,
  period: string,
  lhs: number,
  rhs: number,
  tolerance: number,
): IdentityAssertionResult => {
  const diff = lhs - rhs;
  return {
    id,
    label,
    period,
    lhs,
    rhs,
    diff,
    tolerance,
    pass: Math.abs(diff) <= tolerance,
  };
};

export function runIdentityAssertions(periods: RecastPeriod[]): IdentitySuiteReport {
  const results: IdentityAssertionResult[] = [];

  for (let i = 0; i < periods.length; i++) {
    const cur = periods[i];
    const prev = i > 0 ? periods[i - 1] : null;
    const tTol = Math.max(1, cur.bs.TA * 0.005);

    // A1: NOA = OA - OL
    pushAssertion(results, cur, "A1", "NOA = OA - OL", cur.bs.NOA, cur.bs.OA - cur.bs.OL, tTol);

    // A2: NOA = CSE + NFO + MI  (with minority extension)
    pushAssertion(results, cur, "A2", "NOA = CSE + NFO + MI", cur.bs.NOA, cur.bs.CSE + cur.bs.NFO + cur.bs.MI, tTol);

    // A3: TA = FA + OA
    pushAssertion(results, cur, "A3", "TA = FA + OA", cur.bs.TA, cur.bs.FA + cur.bs.OA, tTol);

    // A4: TA = CSE + MI + FO + OL
    pushAssertion(results, cur, "A4", "TA = CSE + MI + FO + OL", cur.bs.TA, cur.bs.CSE + cur.bs.MI + cur.bs.FO + cur.bs.OL, tTol);

    // A5: CNI = OI - NFE - MII
    pushAssertion(results, cur, "A5", "CNI = OI - NFE - MII", cur.is.CNI, cur.is.OI - cur.is.NFE - cur.is.MII, Math.max(1, Math.abs(cur.is.CNI) * 0.005));

    if (prev) {
      const dNOA = cur.bs.NOA - prev.bs.NOA;
      const dNFO = cur.bs.NFO - prev.bs.NFO;

      // A6: FCF = OI - ΔNOA
      pushAssertion(results, cur, "A6", "FCF_accounting = OI - ΔNOA", cur.cf.FCF_accounting, cur.is.OI - dNOA, Math.max(1, Math.abs(cur.cf.FCF_accounting) * 0.02));

      // A7: d_t = FCF - NFE + ΔNFO
      pushAssertion(results, cur, "A7", "d_t = FCF - NFE + ΔNFO", cur.cf.d_t_formula, cur.cf.FCF_accounting - cur.is.NFE + dNFO, Math.max(1, Math.abs(cur.cf.d_t_formula) * 0.02));

      // A8: RNOA = SalesPM*ATO + OtherItems/NOA
      if (cur.ratios?.RNOA != null && cur.ratios.SalesPM != null && cur.ratios.ATO != null && cur.ratios.OtherItemsRatio != null) {
        pushAssertion(results, cur, "A8", "RNOA = SalesPM*ATO + OtherItems/NOA", cur.ratios.RNOA, cur.ratios.SalesPM * cur.ratios.ATO + cur.ratios.OtherItemsRatio, 0.01);
      }

      // A9: ROCE = RNOA + FLEV*SPREAD
      if (
        cur.ratios?.ROCE != null &&
        cur.ratios.RNOA != null &&
        cur.ratios.FLEV != null &&
        cur.ratios.SPREAD != null
      ) {
        pushAssertion(results, cur, "A9", "ROCE = RNOA + FLEV*SPREAD", cur.ratios.ROCE, cur.ratios.RNOA + cur.ratios.FLEV * cur.ratios.SPREAD, 0.01);
      }
    }
  }

  const byAssertion = countByAssertion(results);
  const summary = countAssertions(results);
  return {
    total: results.length,
    passed: summary.passed,
    failed: summary.failed,
    byAssertion,
    results,
    a9ReasonCounts: summary.a9ReasonCounts,
  };
}
