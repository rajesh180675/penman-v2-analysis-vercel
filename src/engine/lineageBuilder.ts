/**
 * lineageBuilder.ts
 *
 * Builds a per-period source-cell map for the instrumented concepts. The map
 * is persisted as an audit sidecar (separate from the traceability envelope)
 * and is used by RunInspector / DebugPanel reviewers to drill into the raw
 * cells behind any recast number.
 *
 * Phase 1 additions:
 *  - Intrinsic value per share can be threaded in by the caller (valuation
 *    triangulation) and is attached to the latest period.
 *  - Direct concepts now attempt real raw-key resolution via findRawMetric.
 *  - Financial-institution rows (recastData empty, bankMetrics present) build
 *    a bank-specific lineage so they no longer fail the lineage evidence gate.
 */

import { RawPeriodData, RecastPeriod } from "./types";
import { BankPeriodMetrics } from "./bankPipeline/metrics";
import { findRawMetric } from "./rawMetricTools";
import {
  FINANCIAL_LINEAGE_CONCEPT_IDS,
  LINEAGE_CONCEPT_IDS,
  LINEAGE_POLICY_DECISIONS_CAP,
  LINEAGE_SOURCE_KEYS_CAP,
  LINEAGE_TRANSFORMATION_STEPS_CAP,
  LineageConceptId,
  LineageMap,
  LineageRef,
  NumberLineage,
} from "./lineageTypes";

interface BuildLineageInput {
  recastData: RecastPeriod[] | null;
  rawData: RawPeriodData[] | null;
  /** Optional bank metrics — when present and recastData is empty, build
   *  a financial-institution lineage instead of the industrial one. */
  bankMetrics?: BankPeriodMetrics[] | null;
  /** Optional valuation outputs — when present we populate lineage for
   *  IntrinsicValuePerShare. Caller passes the per-period IV/share map
   *  if available; absent → IV lineage is omitted. */
  intrinsicValuePerShareByPeriod?: Record<string, number | null>;
}

/**
 * Manual alias lists for the concepts we instrument. These are deliberately
 * conservative: if a label isn't found, lineage still records the derived
 * source keys, so reviewers can see the calculation. Keeping them local avoids
 * circular import on conceptOntology.
 */
const CONCEPT_RAW_ALIASES: Record<LineageConceptId, string[]> = {
  "noa": ["Total Assets", "Total Current Assets", "Total Non Current Assets", "Total Current Liabilities", "Total Non Current Liabilities", "Deferred Tax Liabilities Net"],
  "nfo": ["Borrowings", "Long Term Borrowings", "Short Term Borrowings", "Current Maturities of Long Term Debt", "Lease Liabilities", "Cash and Cash Equivalents", "Bank Balances", "Current Investments"],
  "cse": ["Total Equity", "Shareholders Funds", "Equity Share Capital"],
  "core-oi": ["Revenue From Operations(Net)", "Total Revenue", "Other Income", "Operating Income"],
  "rnoa": [],
  "free-cash-flow": ["Net Cash From Operating Activities", "Cash Flow From Operating Activities", "Purchase of Fixed Assets", "Capital Expenditure"],
  "pat": ["Profit After Tax", "Profit Attributable to Ordinary Shareholders"],
  "intrinsic-value-per-share": [],
  // Financial-institution source labels
  "total-assets": ["Total Assets"],
  "total-equity": ["Total Equity", "Shareholders Funds", "Equity Share Capital"],
  "net-interest-income": ["Interest Earned", "Total Interest Expenses", "Interest Expended", "Finance Cost", "Revenue From Operations(Net)"],
  "operating-profit": ["Interest Earned", "Other Income", "Operating Expenses", "Total Operating Expenses", "Provisions"],
  "advances": ["Advances", "Total Advances", "Loans and Advances"],
  "deposits": ["Deposits", "Total Deposits"],
  "credit-cost": ["Provisions", "Impairment on Financial Instruments", "Loss Allowance on Loans", "Advances", "Total Advances"],
};

const STATEMENT_OWNER: Record<LineageConceptId, NumberLineage["sourceStatements"][number]> = {
  "noa": "BS",
  "nfo": "BS",
  "cse": "BS",
  "core-oi": "IS",
  "rnoa": "SD",
  "free-cash-flow": "CF",
  "pat": "IS",
  "intrinsic-value-per-share": "SD",
  // Financial-institution concepts
  "total-assets": "BS",
  "total-equity": "BS",
  "net-interest-income": "IS",
  "operating-profit": "IS",
  "advances": "BS",
  "deposits": "BS",
  "credit-cost": "SD",
};

const TRANSFORMATION_RECIPE: Record<LineageConceptId, string[]> = {
  "noa": [
    "NOA = Total Assets \u2212 OL_ex_DTL \u2212 DTL \u2212 PensionObl",
    "Cap to non-financial assets only.",
  ],
  "nfo": [
    "NFO = FO \u2212 FA",
    "FO = financial obligations (debt + lease + bridge debt)",
    "FA = financial assets (cash, investments)",
  ],
  "cse": [
    "CSE = Total Equity \u2212 Minority Interest",
    "Reconcile against share-capital movement (PR #137 strict peer matching).",
  ],
  "core-oi": [
    "CoreOI = OI_from_sales \u2212 UOI",
    "Exclude unusual items per UnusualItemPolicy.",
  ],
  "rnoa": [
    "RNOA = CoreOI / Avg(NOA)",
    "Avg(NOA) = (NOA_t + NOA_{t-1}) / 2 when prior period exists.",
  ],
  "free-cash-flow": [
    "FCF_cash = CFO \u2212 Capex + NetBorrowing",
    "FCF_accounting = CNI \u2212 dCSE (clean surplus).",
  ],
  "pat": [
    "PAT directly mapped from raw label.",
    "Cross-check: PAT = PBT \u2212 TaxExpense.",
  ],
  "intrinsic-value-per-share": [
    "IV/share = ResidualIncomeTerminalValue + (CSE_T / shares_outstanding).",
    "Discount RI by ke; capital cost from S-9.4C structural derivation.",
  ],
  // Financial-institution recipes
  "total-assets": ["Total Assets as reported on balance sheet."],
  "total-equity": ["Total Equity / Shareholders Funds."],
  "net-interest-income": ["NII = Interest Earned \u2212 Interest Expended."],
  "operating-profit": ["Operating Profit = NII + Other Income \u2212 OpEx \u2212 Provisions."],
  "advances": ["Gross advances / loan book."],
  "deposits": ["Total deposits / core funding."],
  "credit-cost": ["Credit Cost = Provisions / Average Advances."],
};

/** True when the concept is driven by bank metrics rather than recast data. */
function isFinancialConcept(conceptId: LineageConceptId): boolean {
  return FINANCIAL_LINEAGE_CONCEPT_IDS.includes(conceptId);
}

function resolveNii(metric: BankPeriodMetrics): number | null {
  if (metric.nii != null && Number.isFinite(metric.nii)) return metric.nii;
  if (
    metric.interestEarned != null &&
    metric.interestExpended != null &&
    metric.interestEarned > 0
  ) {
    const nii = metric.interestEarned - Math.abs(metric.interestExpended);
    return nii >= 0 ? nii : null;
  }
  return null;
}

function resolveOperatingProfit(metric: BankPeriodMetrics): number | null {
  const nii = resolveNii(metric);
  if (nii == null) return null;
  const otherIncome = metric.otherIncome ?? 0;
  const opex = metric.operatingExpenses ?? 0;
  const provisions = metric.provisions ?? 0;
  const op = nii + otherIncome - opex - provisions;
  return Number.isFinite(op) ? op : null;
}

const RAW_ONLY_LINEAGE_CONCEPTS: readonly LineageConceptId[] = ["cse", "pat", "free-cash-flow"] as const;

function buildRawOnlyEntry(conceptId: LineageConceptId, raw: RawPeriodData): NumberLineage | null {
  const aliases = CONCEPT_RAW_ALIASES[conceptId] ?? [];
  if (aliases.length === 0) return null;
  const match = findRawMetric(raw, aliases);
  if (!match?.key) return null;
  return {
    conceptId,
    period: raw.period_end,
    finalValue: match.value,
    sourceMetricKeys: [match.key],
    sourceStatements: [STATEMENT_OWNER[conceptId]],
    transformationSteps: [
      "Raw Capitaline metric preserved for source-lineage fallback.",
      "Financial-institution audit rows do not retain industrial RecastPeriod traces.",
    ],
    policyDecisionsApplied: [],
    confidence: "medium",
    warnings: ["Raw-data lineage fallback; canonical recast lineage unavailable for this audit route."],
  };
}

function buildEntry(
  conceptId: LineageConceptId,
  period: string,
  recast: RecastPeriod | null,
  bankMetric: BankPeriodMetrics | null,
  raw: RawPeriodData | null,
  intrinsicValuePerShare?: number | null | undefined,
): NumberLineage {
  const sourceKeys: string[] = [];
  const policy: string[] = [];
  const warnings: string[] = [];
  let confidence: NumberLineage["confidence"] = "high";

  // Raw-key resolution where applicable.
  if (raw) {
    for (const alias of CONCEPT_RAW_ALIASES[conceptId]) {
      const match = findRawMetric(raw, [alias]);
      if (match?.key) {
        sourceKeys.push(match.key);
      }
    }
  }

  // Derived-concept source keys (industrial).
  if (recast) {
    if (conceptId === "noa") {
      sourceKeys.push("BS.TA", "BS.OL_ex_DTL", "BS.DTL", "BS.PensionObl");
    } else if (conceptId === "nfo") {
      sourceKeys.push("BS.FO", "BS.FA");
    } else if (conceptId === "core-oi") {
      sourceKeys.push("IS.OI_from_sales", "IS.UOI");
    } else if (conceptId === "rnoa") {
      sourceKeys.push("derived.CoreOI", "derived.NOA(prev,curr)");
    } else if (conceptId === "free-cash-flow") {
      sourceKeys.push("CF.CFO", "CF.Capex", "CF.BridgeDebtProceeds", "CF.BridgeDebtRepayment");
    } else if (conceptId === "intrinsic-value-per-share") {
      sourceKeys.push("derived.CSE_T", "derived.ResidualIncomeTerminalValue", "config.shares_outstanding");
    }
  }

  // Derived-concept source keys (financial institution).
  if (bankMetric) {
    if (conceptId === "net-interest-income") {
      sourceKeys.push("bank.interestEarned", "bank.interestExpended");
    } else if (conceptId === "operating-profit") {
      sourceKeys.push("bank.nii", "bank.otherIncome", "bank.operatingExpenses", "bank.provisions");
    } else if (conceptId === "credit-cost") {
      sourceKeys.push("bank.provisions", "bank.advances");
    }
  }

  // spec_flags surface as policy decisions (recast rows only).
  if (recast) {
    for (const flag of recast.spec_flags ?? []) {
      if (policy.length >= LINEAGE_POLICY_DECISIONS_CAP) {
        policy.push(`... (${(recast.spec_flags?.length ?? 0) - policy.length} more)`);
        break;
      }
      policy.push(`spec_flag: ${flag.label}`);
      if (flag.affects_terminal && conceptId === "rnoa") {
        warnings.push(`Terminal-affecting flag in this period: ${flag.label}.`);
        confidence = "medium";
      }
    }
  }

  // Pull final value from the appropriate data source.
  let finalValue: number | null = null;
  if (recast) {
    switch (conceptId) {
      case "noa":
        finalValue = recast.bs.NOA ?? null;
        break;
      case "nfo":
        finalValue = recast.bs.NFO ?? null;
        break;
      case "cse":
        finalValue = recast.bs.CSE ?? null;
        break;
      case "core-oi":
        finalValue = recast.cu.CoreOI ?? null;
        break;
      case "rnoa":
        finalValue = recast.ratios?.RNOA ?? null;
        break;
      case "free-cash-flow":
        finalValue = recast.cf.FCF_cash ?? recast.cf.FCF_accounting ?? null;
        break;
      case "pat":
        finalValue = recast.is.PAT ?? null;
        break;
      case "intrinsic-value-per-share":
        finalValue = intrinsicValuePerShare ?? null;
        break;
    }
  }
  if (finalValue == null && bankMetric) {
    switch (conceptId) {
      case "total-assets":
        finalValue = bankMetric.totalAssets ?? null;
        break;
      case "total-equity":
        finalValue = bankMetric.totalEquity ?? null;
        break;
      case "net-interest-income":
        finalValue = resolveNii(bankMetric);
        break;
      case "operating-profit":
        finalValue = resolveOperatingProfit(bankMetric);
        break;
      case "advances":
        finalValue = bankMetric.advances ?? null;
        break;
      case "deposits":
        finalValue = bankMetric.deposits ?? null;
        break;
      case "credit-cost":
        finalValue = bankMetric.creditCost ?? null;
        break;
      case "pat":
        finalValue = bankMetric.pat ?? null;
        break;
    }
  }

  if (finalValue == null) {
    confidence = "estimated";
    warnings.push(`Final value missing for ${conceptId} in ${period}.`);
  } else if (sourceKeys.length === 0 && !isFinancialConcept(conceptId)) {
    // A value without any raw key is still derived-only; mark medium so the
    // reviewer knows it didn't land on a source cell.
    confidence = "medium";
  }

  // Cap source keys to budget.
  const truncatedSourceKeys =
    sourceKeys.length > LINEAGE_SOURCE_KEYS_CAP
      ? [...sourceKeys.slice(0, LINEAGE_SOURCE_KEYS_CAP - 1), `... (${sourceKeys.length - LINEAGE_SOURCE_KEYS_CAP + 1} more)`]
      : sourceKeys;

  // Transformation steps come from the static recipe — already small,
  // but cap defensively.
  const recipe = TRANSFORMATION_RECIPE[conceptId] ?? [];
  const truncatedSteps =
    recipe.length > LINEAGE_TRANSFORMATION_STEPS_CAP
      ? [...recipe.slice(0, LINEAGE_TRANSFORMATION_STEPS_CAP - 1), `... (${recipe.length - LINEAGE_TRANSFORMATION_STEPS_CAP + 1} more)`]
      : recipe;

  return {
    conceptId,
    period,
    finalValue,
    sourceMetricKeys: truncatedSourceKeys,
    sourceStatements: [STATEMENT_OWNER[conceptId]],
    transformationSteps: truncatedSteps,
    policyDecisionsApplied: policy,
    confidence,
    warnings,
  };
}

/**
 * Build the lineage sidecar map. Caller persists it inside the audit
 * snapshot — never the envelope.
 */
export function buildLineageMap(input: BuildLineageInput): LineageMap {
  const entries: Record<string, NumberLineage> = {};
  let truncated = false;

  const recastData = input.recastData ?? [];
  const bankMetrics = input.bankMetrics ?? [];
  const rawByPeriod = new Map<string, RawPeriodData>(
    (input.rawData ?? []).map((r) => [r.period_end, r]),
  );

  // Prefer the industrial recast lineage when periods exist.
  if (recastData.length > 0) {
    for (const recast of recastData) {
      for (const conceptId of LINEAGE_CONCEPT_IDS) {
        const entry = buildEntry(
          conceptId,
          recast.period_end,
          recast,
          null,
          rawByPeriod.get(recast.period_end) ?? null,
          input.intrinsicValuePerShareByPeriod?.[recast.period_end],
        );
        entries[`${conceptId}|${recast.period_end}`] = entry;
        if (
          entry.sourceMetricKeys.some((k) => k.startsWith("...")) ||
          entry.transformationSteps.some((s) => s.startsWith("...")) ||
          entry.policyDecisionsApplied.some((p) => p.startsWith("..."))
        ) {
          truncated = true;
        }
      }
    }
  } else if (bankMetrics.length > 0) {
    // Financial-institution path: build a lineage from bank metrics.
    for (const metric of bankMetrics) {
      for (const conceptId of LINEAGE_CONCEPT_IDS) {
        const entry = buildEntry(
          conceptId,
          metric.period_end,
          null,
          metric,
          rawByPeriod.get(metric.period_end) ?? null,
          input.intrinsicValuePerShareByPeriod?.[metric.period_end],
        );
        entries[`${conceptId}|${metric.period_end}`] = entry;
        if (
          entry.sourceMetricKeys.some((k) => k.startsWith("...")) ||
          entry.transformationSteps.some((s) => s.startsWith("...")) ||
          entry.policyDecisionsApplied.some((p) => p.startsWith("..."))
        ) {
          truncated = true;
        }
      }
    }
  } else {
    // Last-resort source lineage for datasets that have neither recast rows
    // nor financial-institution metrics.
    for (const raw of input.rawData ?? []) {
      for (const conceptId of RAW_ONLY_LINEAGE_CONCEPTS) {
        const entry = buildRawOnlyEntry(conceptId, raw);
        if (entry) entries[`${conceptId}|${raw.period_end}`] = entry;
      }
    }
  }

  const json = JSON.stringify(entries);
  return {
    entries,
    sizeBytes: json.length,
    truncated,
  };
}

/**
 * Build a small `LineageRef` for the envelope. Carries a checksum so a
 * future reader can detect drift between the envelope and the (separately
 * persisted) lineage sidecar.
 */
export function buildLineageRef(map: LineageMap | null): LineageRef {
  if (!map || Object.keys(map.entries).length === 0) {
    return { hasLineage: false, conceptCount: 0, periodCount: 0, checksum: "" };
  }
  const concepts = new Set<string>();
  const periods = new Set<string>();
  for (const key of Object.keys(map.entries)) {
    const [concept, period] = key.split("|");
    concepts.add(concept!);
    periods.add(period!);
  }
  return {
    hasLineage: true,
    conceptCount: concepts.size,
    periodCount: periods.size,
    checksum: cheapChecksum(map.entries),
  };
}

/**
 * Cheap deterministic checksum (FNV-1a-like) over the JSON-serialized
 * lineage. Not cryptographic — purpose is drift detection only.
 */
function cheapChecksum(value: unknown): string {
  const str = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
