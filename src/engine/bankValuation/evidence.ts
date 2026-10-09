import { CURRENT_MODEL_REGISTRY } from "../modelCatalog/definitions";
import type { FinancialInstitutionSubtype } from "../analysisFamily";
import type { BankValuationBundle, BankValuationModelResult } from "./types";
import type { ValuationModelResult } from "../modelCatalog/types";

/**
 * What a financial institution's valuation rests on, as independent lenses.
 *
 * The bundle's models are grouped by the model catalog's independence groups,
 * the registry being the one authority on which models share evidence. A
 * bank's justified P/B, equity residual income and DDM are one group (one
 * algebra on book, ROE, ke and g), so a bank has a single lens however many of
 * them compute. An insurer's embedded value and an NBFC's P/AUM are separate
 * groups. Only models the catalog applies to the subtype count: an insurer's
 * book models are sanity brackets beside its embedded value (computeBankValuation
 * values it on embedded value alone), not a second lens.
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
  /** Market-multiple lenses computed on a multiple nothing sources: shown, not counted. */
  readonly assumedMultipleLenses: ReadonlyArray<{ readonly label: string; readonly value: number; readonly multiple: number | null }>;
}

/**
 * Groups whose value is a market multiple applied to the company's own
 * figures. Such a lens is independent of the book algebra only through its
 * multiple, so it corroborates nothing unless the multiple is a market
 * observation (`diagnostics.multipleSourced === 1`). P/AUM applies a 12× P/E
 * constant: counted, it made Muthoot "two lenses within 30%" on a number
 * nothing sources — the ground #398 held insurers back on for VNB × 12.
 */
const MARKET_MULTIPLE_GROUPS = new Set(["fi-asset-market-multiple"]);

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

export function summarizeFinancialValuationEvidence(
  bundle: BankValuationBundle | null | undefined,
  subtype?: FinancialInstitutionSubtype | null | undefined,
): FinancialValuationEvidence {
  // A generic financial runs the bank models.
  const family = subtype === "generic-financial" ? "bank" : subtype;
  const byGroup = new Map<string, Array<{ label: string; value: number }>>();
  const assumedMultipleLenses: Array<{ label: string; value: number; multiple: number | null }> = [];
  for (const [field, modelId, label] of BUNDLE_MODELS) {
    const model = bundle?.[field] as BankValuationModelResult | undefined;
    const value = model?.status === "computed" ? model.intrinsicValue : null;
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    const definition = CURRENT_MODEL_REGISTRY.require(modelId);
    if (family && !(definition.families as readonly string[]).includes(family)) continue;
    const group = definition.independenceGroup;
    if (MARKET_MULTIPLE_GROUPS.has(group) && model?.diagnostics?.multipleSourced !== 1) {
      assumedMultipleLenses.push({ label, value, multiple: model?.diagnostics?.peMultiple ?? null });
      continue;
    }
    byGroup.set(group, [...(byGroup.get(group) ?? []), { label, value }]);
  }
  const groups = [...byGroup.entries()].map(([group, models]) => ({
    group,
    label: GROUP_LABELS[group] ?? group,
    value: median(models.map((m) => m.value)),
    models,
  }));
  if (groups.length < 2) return { groups, maxGapRatio: null, assumedMultipleLenses };
  const values = groups.map((g) => g.value);
  return { groups, maxGapRatio: (Math.max(...values) - Math.min(...values)) / median(values), assumedMultipleLenses };
}

const crore = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")} Cr`;

/** One sentence on what the valuation rests on, for the rigor checkpoint that caps it. */
export function describeFinancialValuationEvidence(evidence: FinancialValuationEvidence): string {
  const { groups, maxGapRatio } = evidence;
  const assumed = (evidence.assumedMultipleLenses ?? []).map((l) =>
    ` ${l.label} ${crore(l.value)} applies an assumed ${l.multiple != null ? `${l.multiple}× ` : ""}multiple nothing sources, so it is shown, not counted.`).join("");
  if (groups.length === 0) return `No financial-institution valuation model computed.${assumed}`;
  if (groups.length === 1) {
    const [only] = groups;
    const models = only!.models.map((m) => `${m.label} ${crore(m.value)}`).join(", ");
    return (only!.models.length > 1
      ? `One independent lens, ${only!.label} (${models}): one algebra on the same book, ROE, ke and growth, so nothing independent cross-checks it.`
      : `One independent lens, ${only!.label} (${models}), so nothing independent cross-checks it.`) + assumed;
  }
  const lenses = groups.map((g) => `${g.label} ${crore(g.value)}`).join(" vs ");
  return `${groups.length} independent lenses: ${lenses}, ${((maxGapRatio ?? 0) * 100).toFixed(0)}% apart.${assumed}`;
}

/**
 * The bundle's models as catalog results, for the run's model table: each
 * model the catalog applies to the subtype, computed with its equity value in
 * ₹ Cr or skipped with its reason in the diagnostics.
 */
export function adaptBankValuationModelResults(
  bundle: BankValuationBundle | null | undefined,
  subtype: FinancialInstitutionSubtype | null | undefined,
): ValuationModelResult[] {
  if (!bundle) return [];
  const family = subtype === "generic-financial" ? "bank" : subtype;
  const results: ValuationModelResult[] = [];
  for (const [field, modelId] of BUNDLE_MODELS) {
    const definition = CURRENT_MODEL_REGISTRY.require(modelId);
    if (family && !(definition.families as readonly string[]).includes(family)) continue;
    const model = bundle[field] as BankValuationModelResult | undefined;
    if (!model) continue;
    const value = model.status === "computed" ? model.intrinsicValue : null;
    if (value != null && Number.isFinite(value)) {
      results.push({
        modelId,
        modelVersion: definition.modelVersion,
        caseId: null,
        status: "computed",
        enterpriseValue: null,
        equityValue: value,
        perShare: null,
        unit: "INR_CRORE",
        evidenceRefs: [],
        transformationRefs: [],
        diagnostics: { ...model.diagnostics, reason: model.reason },
        guardResults: [],
      });
    } else {
      results.push({ modelId, modelVersion: definition.modelVersion, caseId: null, status: "skipped", reasonCode: "FI_MODEL_SKIPPED", missingRequirementIds: [] });
    }
  }
  return results;
}
