/**
 * Lineage builder — Gap 4 / PR-D.
 *
 * Reconstructs per-number lineage POST-HOC from already-computed
 * RecastPeriod / RawPeriodData / ValuationResult, instead of threading
 * a builder through the hot pipeline path. This keeps `pipeline.ts`
 * pure (Plan v4 N-8) and the cost zero on runs that don't request a
 * snapshot.
 *
 * For each (concept, period) we describe:
 *   - sourceMetricKeys: the raw keys that fed the recast computation
 *   - sourceStatements: BS / IS / CF / SD
 *   - transformationSteps: the deterministic recipe the pipeline used
 *   - policyDecisionsApplied: spec_flags or unusual-item exclusions
 *     that touched this concept in this period
 *   - confidence: high (all sources matched), medium (some derived),
 *     low (multiple fallbacks), estimated (computed from defaults)
 */

import { RawPeriodData, RecastPeriod } from "./types";
import { findRawMetric } from "./rawMetricTools";
import {
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
  /** Optional valuation outputs — when present we populate lineage for
   *  IntrinsicValuePerShare. Caller passes the per-period IV/share map
   *  if available; absent → IV lineage is omitted. */
  intrinsicValuePerShareByPeriod?: Record<string, number | null>;
}

/**
 * Aliases used by each concept. These mirror the concept ontology but
 * are duplicated here on purpose: lineage cares about raw resolution,
 * not the canonical concept identity. Keeping them local avoids a
 * circular import on conceptOntology.
 */
const CONCEPT_RAW_ALIASES: Record<LineageConceptId, string[]> = {
  "noa": [],   // derived from BS
  "nfo": [],   // derived from BS
  "cse": ["Total Equity", "Shareholders Funds", "Equity Share Capital"],
  "core-oi": [],   // derived from IS
  "rnoa": [],      // derived from CoreOI / NOA
  "free-cash-flow": ["Net Cash From Operating Activities", "Cash Flow From Operating Activities"],
  "pat": ["Profit After Tax", "Profit Attributable to Ordinary Shareholders"],
  "intrinsic-value-per-share": [],
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
};

const TRANSFORMATION_RECIPE: Record<LineageConceptId, string[]> = {
  "noa": [
    "NOA = Total Assets − OL_ex_DTL − DTL − PensionObl",
    "Cap to non-financial assets only.",
  ],
  "nfo": [
    "NFO = FO − FA",
    "FO = financial obligations (debt + lease + bridge debt)",
    "FA = financial assets (cash, investments)",
  ],
  "cse": [
    "CSE = Total Equity − Minority Interest",
    "Reconcile against share-capital movement (PR #137 strict peer matching).",
  ],
  "core-oi": [
    "CoreOI = OI_from_sales − UOI",
    "Exclude unusual items per UnusualItemPolicy.",
  ],
  "rnoa": [
    "RNOA = CoreOI / Avg(NOA)",
    "Avg(NOA) = (NOA_t + NOA_{t-1}) / 2 when prior period exists.",
  ],
  "free-cash-flow": [
    "FCF_cash = CFO − Capex + NetBorrowing",
    "FCF_accounting = CNI − dCSE (clean surplus).",
  ],
  "pat": [
    "PAT directly mapped from raw label.",
    "Cross-check: PAT = PBT − TaxExpense.",
  ],
  "intrinsic-value-per-share": [
    "IV/share = ResidualIncomeTerminalValue + (CSE_T / shares_outstanding).",
    "Discount RI by ke; capital cost from S-9.4C structural derivation.",
  ],
};

function buildEntry(
  conceptId: LineageConceptId,
  period: string,
  recast: RecastPeriod,
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

  // For derived concepts, source keys come from the BS/IS we used.
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

  // spec_flags surface as policy decisions.
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

  // Pull final value from the recast data.
  let finalValue: number | null = null;
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
  if (finalValue == null) {
    confidence = "estimated";
    warnings.push(`Final value missing for ${conceptId} in ${period}.`);
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
  const rawByPeriod = new Map<string, RawPeriodData>(
    (input.rawData ?? []).map((r) => [r.period_end, r]),
  );

  for (const recast of recastData) {
    for (const conceptId of LINEAGE_CONCEPT_IDS) {
      const entry = buildEntry(
        conceptId,
        recast.period_end,
        recast,
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
