import { CURRENT_MODEL_REGISTRY } from "../modelCatalog/definitions";
import type { BankValuationBundle, BankValuationModelResult } from "./types";

/**
 * What a financial institution's valuation rests on, as independent lenses.
 *
 * The bundle's models are grouped by the model catalog's independence groups,
 * the registry being the one authority on which models share evidence. A
 * bank's justified P/B, equity residual income and DDM are one group (one
 * algebra on book, ROE, ke and g), so a bank has a single lens however many of
 * them compute. An insurer's embedded value and an NBFC's P/AUM are separate
 * groups.
 */
export interface FinancialLensGroup {
  readonly group: string;
  readonly label: string;
  /** Median of the group's computed models, in ₹ Cr. */
  readonly value: number;
  readonly models: ReadonlyArray<{ readonly label: string; readonly value: number }>;
}

export interface FinancialValuationEvidence {
  readonly groups: readonly FinancialLensGroup[];
  /** Largest gap between two groups' values as a share of their median; null below two groups. */
  readonly maxGapRatio: number | null;
}

const BUNDLE_MODELS: ReadonlyArray<readonly [keyof BankValuationBundle, string, string]> = [
  ["justifiedPB", "fi.bank.justified-pb-gordon", "justified P/B"],
  ["equityResidualIncome", "fi.bank.equity-residual-income", "equity residual income"],
  ["sustainableDDM", "fi.bank.sustainable-ddm", "DDM"],
  ["roaLeverageRI", "fi.nbfc.roa-leverage-residual-income", "ROA × leverage RI"],
  ["evBased", "fi.insurance.embedded-value-vnb", "embedded value + VNB"],
  ["pAum", "fi.nbfc.p-aum", "P/AUM"],
];

const GROUP_LABELS: Readonly<Record<string, string>> = {
  "fi-book-residual-income": "book residual income",
  "actuarial-embedded-value": "embedded value",
  "fi-asset-market-multiple": "asset multiple",
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarizeFinancialValuationEvidence(bundle: BankValuationBundle | null | undefined): FinancialValuationEvidence {
  const byGroup = new Map<string, Array<{ label: string; value: number }>>();
  for (const [field, modelId, label] of BUNDLE_MODELS) {
    const model = bundle?.[field] as BankValuationModelResult | undefined;
    const value = model?.status === "computed" ? model.intrinsicValue : null;
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    const group = CURRENT_MODEL_REGISTRY.require(modelId).independenceGroup;
    byGroup.set(group, [...(byGroup.get(group) ?? []), { label, value }]);
  }
  const groups = [...byGroup.entries()].map(([group, models]) => ({
    group,
    label: GROUP_LABELS[group] ?? group,
    value: median(models.map((m) => m.value)),
    models,
  }));
  if (groups.length < 2) return { groups, maxGapRatio: null };
  const values = groups.map((g) => g.value);
  return { groups, maxGapRatio: (Math.max(...values) - Math.min(...values)) / median(values) };
}

const crore = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")} Cr`;

/** One sentence on what the valuation rests on, for the rigor checkpoint that caps it. */
export function describeFinancialValuationEvidence(evidence: FinancialValuationEvidence): string {
  const { groups, maxGapRatio } = evidence;
  if (groups.length === 0) return "No financial-institution valuation model computed.";
  if (groups.length === 1) {
    const [only] = groups;
    const models = only!.models.map((m) => `${m.label} ${crore(m.value)}`).join(", ");
    return only!.models.length > 1
      ? `One independent lens, ${only!.label} (${models}): one algebra on the same book, ROE, ke and growth, so nothing independent cross-checks it.`
      : `One independent lens, ${only!.label} (${models}), so nothing independent cross-checks it.`;
  }
  const lenses = groups.map((g) => `${g.label} ${crore(g.value)}`).join(" vs ");
  return `${groups.length} independent lenses: ${lenses}, ${((maxGapRatio ?? 0) * 100).toFixed(0)}% apart.`;
}
