import { RecastPeriod, Severity, UnusualItemBucket, UnusualItemPolicySummary } from "./types";

export const UNUSUAL_ITEM_POLICY_VERSION = "2026-03-phase7";

function terminalFlags(period: RecastPeriod) {
  return (period.spec_flags ?? []).filter((flag) => flag.affects_terminal);
}

function makeBucket(
  type: UnusualItemBucket["type"],
  label: string,
  amount: number,
  recurring: boolean,
  affectsCoreOI: boolean,
  affectsCoreNFE: boolean,
  blocksTerminalValuation: boolean,
  reason: string,
): UnusualItemBucket {
  return { type, label, amount, recurring, affectsCoreOI, affectsCoreNFE, blocksTerminalValuation, reason };
}

export function buildUnusualItemPolicy(period: RecastPeriod): UnusualItemPolicySummary {
  const operatingBuckets: UnusualItemBucket[] = [];
  const financialBuckets: UnusualItemBucket[] = [];

  const exceptionalOperating = period.cu.ExceptionalOperatingItemsAfterTax ?? 0;
  const discontinued = period.cu.DiscontinuedOperationsAfterTax ?? 0;
  const oci = period.cu.OCITotal ?? 0;
  const ufe = period.cu.UFE ?? 0;
  const affectsTerminalFlags = terminalFlags(period);
  const sales = Math.max(Math.abs(period.is?.Sales ?? 0), 1);
  const coreOiAbs = Math.max(Math.abs(period.cu.CoreOI ?? 0), 1);
  const uoiAbs = Math.abs(period.cu.UOI ?? 0);
  const otherItemsAbs = Math.abs(period.is?.OtherItems ?? 0);

  if (exceptionalOperating !== 0) {
    operatingBuckets.push(
      makeBucket(
        "operating_exceptional",
        "Exceptional operating items",
        exceptionalOperating,
        false,
        true,
        false,
        false,
        "Excluded from Core OI as explicitly non-recurring operating noise.",
      ),
    );
  }

  if (discontinued !== 0) {
    operatingBuckets.push(
      makeBucket(
        "discontinued_operations",
        "Discontinued operations",
        discontinued,
        false,
        true,
        false,
        true,
        "Discontinued operations are not valid terminal anchors and stay in UOI only.",
      ),
    );
  }

  if (oci !== 0) {
    operatingBuckets.push(
      makeBucket(
        "oci_reclassified",
        "OCI reclassified as unusual",
        oci,
        false,
        true,
        false,
        false,
        "OCI is excluded from persistent operating income under the current policy configuration.",
      ),
    );
  }

  if (ufe !== 0) {
    financialBuckets.push(
      makeBucket(
        "financial_unusual",
        "Unusual financing items",
        ufe,
        false,
        false,
        true,
        false,
        "Non-operating financing gains/losses remain outside Core NFE.",
      ),
    );
  }

  if (
    uoiAbs > 0
    && (uoiAbs / sales >= 0.05 || uoiAbs / coreOiAbs >= 0.35 || otherItemsAbs / sales >= 0.03)
  ) {
    operatingBuckets.push(
      makeBucket(
        "material_operating_noise",
        "Material company-specific operating noise",
        period.cu.UOI,
        false,
        true,
        false,
        true,
        "Unusual operating noise is large enough to distort terminal valuation if left untreated.",
      ),
    );
  }

  const blockerReasons = affectsTerminalFlags.map((flag) => `${flag.label}: ${flag.message}`);
  if (operatingBuckets.some((bucket) => bucket.type === "material_operating_noise")) {
    blockerReasons.push(
      `Material operating noise detected: UOI=${period.cu.UOI.toFixed(2)} with OtherItems=${(period.is?.OtherItems ?? 0).toFixed(2)}.`,
    );
  }
  if (affectsTerminalFlags.some((flag) => flag.label.includes("CAPITAL_TRANSACTION"))) {
    operatingBuckets.push(
      makeBucket(
        "capital_transaction_signal",
        "Capital transaction signal",
        0,
        false,
        false,
        false,
        true,
        "Terminal valuation should not rely on periods flagged for likely capital transactions or structural remeasurement.",
      ),
    );
  }

  const terminalBlocker =
    operatingBuckets.some((bucket) => bucket.blocksTerminalValuation)
    || affectsTerminalFlags.some((flag) => flag.severity === Severity.CRITICAL);

  return {
    policyVersion: UNUSUAL_ITEM_POLICY_VERSION,
    operatingBuckets,
    financialBuckets,
    operatingTotal: operatingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
    financialTotal: financialBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
    terminalBlocker,
    blockerReasons,
  };
}
