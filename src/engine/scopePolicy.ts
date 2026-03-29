import { EngineConfig, RawPeriodData } from "./types";
import { SCOPE_POLICY_VERSION } from "./policyVersions";

type ScopeClassification = "supported-industrial" | "unsupported-financial-company";
type ScopeSignalKind = "banking" | "insurance" | "nbfc" | "manual-override";

export interface ScopeSignal {
  kind: ScopeSignalKind;
  key: string;
  periodsObserved: number;
}

export interface ScopeAssessment {
  policyVersion: string;
  classification: ScopeClassification;
  blocked: boolean;
  label: string;
  reasons: string[];
  recommendedAction: string;
  signals: ScopeSignal[];
}

const SIGNAL_GROUPS: Array<{
  kind: Exclude<ScopeSignalKind, "manual-override">;
  label: string;
  keys: string[];
}> = [
  {
    kind: "banking",
    label: "banking",
    keys: [
      "Cash and Balance with RBI",
      "Money at Call and Short Notice",
      "Bills Purchased and Discounted",
      "Investments of Banking Business",
      "Borrowings from RBI",
    ],
  },
  {
    kind: "insurance",
    label: "insurance",
    keys: [
      "Investments of Life Insurance Business",
      "Policy Holder's Investments (Insurance Business)",
      "Assets Held to Cover Linked Liabilities (Insurance Business)",
      "Assets Held to Cover Discontinued Funds (Insurance Business)",
      "Investment - Insurance Operation (Insurance Business)",
      "Cost of Insurance Operation (Insurance Business)",
      "Claims Expenses",
      "Reinsurance Expenses",
      "Premium Earned (Net)",
    ],
  },
  {
    kind: "nbfc",
    label: "nbfc",
    keys: [
      "Interest / Discount on Advances / Bills",
      "Income from Financial Services",
      "Finance Receivables",
      "Loan Assets",
      "Hire Purchase Assets",
      "Lease Assets",
      "Assets on Hire Purchase",
    ],
  },
];

function isMaterialValue(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && Math.abs(value) > 0.0001;
}

function countObservedKeys(periods: RawPeriodData[]) {
  const counts = new Map<string, number>();
  for (const period of periods) {
    for (const [compositeKey, value] of Object.entries(period.raw_metric_values ?? {})) {
      if (!isMaterialValue(value)) continue;
      const idx = compositeKey.lastIndexOf("__");
      const baseKey = idx >= 0 ? compositeKey.slice(0, idx) : compositeKey;
      counts.set(baseKey, (counts.get(baseKey) ?? 0) + 1);
    }
  }
  return counts;
}

export function assessAnalysisScope(
  periods: RawPeriodData[] | null | undefined,
  config?: Pick<EngineConfig, "financial_institution_mode"> | null,
): ScopeAssessment {
  const observedCounts = countObservedKeys(periods ?? []);
  const signals: ScopeSignal[] = [];

  if (config?.financial_institution_mode) {
    signals.push({
      kind: "manual-override",
      key: "financial_institution_mode",
      periodsObserved: periods?.length ?? 0,
    });
  }

  for (const group of SIGNAL_GROUPS) {
    for (const key of group.keys) {
      const periodsObserved = observedCounts.get(key) ?? 0;
      if (periodsObserved > 0) {
        signals.push({ kind: group.kind, key, periodsObserved });
      }
    }
  }

  if (signals.length === 0) {
    return {
      policyVersion: SCOPE_POLICY_VERSION,
      classification: "supported-industrial",
      blocked: false,
      label: "Supported industrial/company scope",
      reasons: [],
      recommendedAction: "Proceed with the industrial Penman-Nissim framework.",
      signals: [],
    };
  }

  const grouped = new Map<ScopeSignalKind, ScopeSignal[]>();
  for (const signal of signals) {
    const bucket = grouped.get(signal.kind) ?? [];
    bucket.push(signal);
    grouped.set(signal.kind, bucket);
  }

  const reasons: string[] = [];
  if (grouped.get("manual-override")) {
    reasons.push("Financial-institution mode was explicitly selected, which is outside the supported industrial framework.");
  }
  for (const [kind, bucket] of grouped.entries()) {
    if (kind === "manual-override") continue;
    const preview = bucket
      .sort((a, b) => b.periodsObserved - a.periodsObserved || a.key.localeCompare(b.key))
      .slice(0, 3)
      .map((signal) => signal.key)
      .join(", ");
    reasons.push(`Detected ${kind} ledger signals with material values: ${preview}.`);
  }

  return {
    policyVersion: SCOPE_POLICY_VERSION,
    classification: "unsupported-financial-company",
    blocked: true,
    label: "Unsupported banking / NBFC / insurance scope",
    reasons,
    recommendedAction: "Route this dataset to a financial-institution-specific framework instead of the industrial engine.",
    signals: signals.sort((a, b) => b.periodsObserved - a.periodsObserved || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
  };
}
