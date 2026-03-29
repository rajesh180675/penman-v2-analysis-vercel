import { describe, expect, it } from "vitest";
import { RecastPeriod, Severity } from "../types";
import { UNUSUAL_ITEM_POLICY_VERSION, buildUnusualItemPolicy } from "../unusualItemPolicy";

function mkPeriod(): RecastPeriod {
  return {
    period_end: "2025-03-31",
    is: {} as RecastPeriod["is"],
    bs: {} as RecastPeriod["bs"],
    cf: {} as RecastPeriod["cf"],
    cu: {
      UOI: 42,
      CoreOI: 100,
      UFE: -5,
      CoreNFE: 10,
      ExceptionalItemsAfterTax: 30,
      ExceptionalOperatingItemsAfterTax: 18,
      DiscontinuedOperationsAfterTax: 12,
      OCITotal: 12,
    },
    spec_flags: [
      {
        spec_id: "S-5.2",
        severity: Severity.CRITICAL,
        label: "CAPITAL_TRANSACTION_LIKELY",
        message: "Equity base changed because of a structural capital action.",
        affects_terminal: true,
        period: "2025-03-31",
      },
    ],
  } as RecastPeriod;
}

describe("buildUnusualItemPolicy", () => {
  it("classifies operating, OCI, financing, and capital-transaction signals", () => {
    const policy = buildUnusualItemPolicy(mkPeriod());

    expect(policy.policyVersion).toBe(UNUSUAL_ITEM_POLICY_VERSION);
    expect(policy.operatingBuckets.map((bucket) => bucket.type)).toEqual([
      "operating_exceptional",
      "discontinued_operations",
      "oci_reclassified",
      "material_operating_noise",
      "capital_transaction_signal",
    ]);
    expect(policy.financialBuckets.map((bucket) => bucket.type)).toEqual(["financial_unusual"]);
    expect(policy.operatingTotal).toBe(84);
    expect(policy.financialTotal).toBe(-5);
    expect(policy.terminalBlocker).toBe(true);
    expect(policy.blockerReasons[0]).toContain("CAPITAL_TRANSACTION_LIKELY");
  });
});
