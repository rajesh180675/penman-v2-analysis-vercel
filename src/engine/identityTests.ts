import { RecastPeriod } from "./types";

export interface IdentityAssertionResult {
  id: "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9";
  label: string;
  period: string;
  lhs: number;
  rhs: number;
  diff: number;
  tolerance: number;
  pass: boolean;
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
    const p = cur.period_end;
    const tTol = Math.max(1, cur.bs.TA * 0.005);

    // A1: NOA = OA - OL
    results.push(asrt("A1", "NOA = OA - OL", p, cur.bs.NOA, cur.bs.OA - cur.bs.OL, tTol));

    // A2: NOA = CSE + NFO + MI  (with minority extension)
    results.push(asrt("A2", "NOA = CSE + NFO + MI", p, cur.bs.NOA, cur.bs.CSE + cur.bs.NFO + cur.bs.MI, tTol));

    // A3: TA = FA + OA
    results.push(asrt("A3", "TA = FA + OA", p, cur.bs.TA, cur.bs.FA + cur.bs.OA, tTol));

    // A4: TA = CSE + MI + FO + OL
    results.push(asrt("A4", "TA = CSE + MI + FO + OL", p, cur.bs.TA, cur.bs.CSE + cur.bs.MI + cur.bs.FO + cur.bs.OL, tTol));

    // A5: CNI = OI - NFE - MII
    results.push(asrt("A5", "CNI = OI - NFE - MII", p, cur.is.CNI, cur.is.OI - cur.is.NFE - cur.is.MII, Math.max(1, Math.abs(cur.is.CNI) * 0.005)));

    if (prev) {
      const dNOA = cur.bs.NOA - prev.bs.NOA;
      const dNFO = cur.bs.NFO - prev.bs.NFO;

      // A6: FCF = OI - ΔNOA
      results.push(asrt("A6", "FCF_accounting = OI - ΔNOA", p, cur.cf.FCF_accounting, cur.is.OI - dNOA, Math.max(1, Math.abs(cur.cf.FCF_accounting) * 0.02)));

      // A7: d_t = FCF - NFE + ΔNFO
      results.push(asrt("A7", "d_t = FCF - NFE + ΔNFO", p, cur.cf.d_t_formula, cur.cf.FCF_accounting - cur.is.NFE + dNFO, Math.max(1, Math.abs(cur.cf.d_t_formula) * 0.02)));

      // A8: RNOA = SalesPM*ATO + OtherItems/NOA
      if (cur.ratios?.RNOA != null && cur.ratios.SalesPM != null && cur.ratios.ATO != null && cur.ratios.OtherItemsRatio != null) {
        results.push(asrt("A8", "RNOA = SalesPM*ATO + OtherItems/NOA", p, cur.ratios.RNOA, cur.ratios.SalesPM * cur.ratios.ATO + cur.ratios.OtherItemsRatio, 0.01));
      }

      // A9: ROCE = RNOA + FLEV*SPREAD
      if (
        cur.ratios?.ROCE != null &&
        cur.ratios.RNOA != null &&
        cur.ratios.FLEV != null &&
        cur.ratios.SPREAD != null
      ) {
        results.push(asrt("A9", "ROCE = RNOA + FLEV*SPREAD", p, cur.ratios.ROCE, cur.ratios.RNOA + cur.ratios.FLEV * cur.ratios.SPREAD, 0.01));
      }
    }
  }

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

  const passed = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    byAssertion,
    results,
  };
}
