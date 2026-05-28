/* ================================================================
   Unusual-item buckets and policy summary
   Outputs of buildUnusualItemPolicy(). Used by recast (CoreUnusual)
   and the rigor traceability envelope.
================================================================ */

export type UnusualBucketType =
  | "operating_exceptional"
  | "discontinued_operations"
  | "oci_reclassified"
  | "financial_unusual"
  | "capital_transaction_signal"
  | "material_operating_noise";

export interface UnusualItemBucket {
  type: UnusualBucketType;
  label: string;
  amount: number;
  recurring: boolean;
  affectsCoreOI: boolean;
  affectsCoreNFE: boolean;
  blocksTerminalValuation: boolean;
  reason: string;
}

export interface UnusualItemPolicySummary {
  policyVersion: string;
  operatingBuckets: UnusualItemBucket[];
  financialBuckets: UnusualItemBucket[];
  operatingTotal: number;
  financialTotal: number;
  terminalBlocker: boolean;
  blockerReasons: string[];
}
