/* ================================================================
   Plan 5 PR-5.3 — Damodaran CAPM module.

   Static Damodaran data table for India (as of 2026-01-15) ships
   as a versioned JSON file with retrieval-date citations. The
   module exposes:

     getDamodaranData()                  the loaded snapshot
     selectIndustryBeta(name)            best-match industry lookup
     relevereBeta(unlevered, D/E, tax)   Hamada relever
     capmKe({beta, rf, erp})             cost of equity

   Reverse-engineering the historical Indian beta is impossible
   without curated industry data. Damodaran's tables are the
   industry standard reference; we mirror them rather than try to
   compute them from raw market data (which would require 5+ years
   of daily price + index returns per company).

   Why static JSON instead of fetching:
     - Audit reproducibility: same runId -> same ke.
     - No external dependency at run time.
     - Retrieval date is part of the ke citation.
   When the data ages out, drop a new dated file alongside this one
   and update the import.

   PR-5.3 ships the lookup + computation. Wiring into the valuation
   engine (so config.cost_of_equity is derived automatically when
   the user selects an industry) is a follow-up.
================================================================ */

import damodaranIndia2026 from "./data/damodaran/india-2026-01.json";
import type { CompanyType } from "../types/company";

export interface DamodaranIndustryRow {
  industry: string;
  leveredBeta: number;
  unleveredBeta: number;
  debtToEquity: number;
}

export interface DamodaranSnapshot {
  retrievalDate: string;
  source: string;
  sourceUrl: string;
  geography: string;
  currency: string;
  version: string;
  equityRiskPremium: { value: number; asOf: string; method: string };
  riskFreeRate: { value: number; asOf: string; instrument: string };
  industries: DamodaranIndustryRow[];
}

const DATA: DamodaranSnapshot = damodaranIndia2026 as DamodaranSnapshot;

export function getDamodaranData(): DamodaranSnapshot {
  return DATA;
}

/**
 * Best-match lookup by industry name. Case-insensitive substring
 * match; returns the row whose name has the largest fragment in
 * common. When no match exists, returns the "Diversified" row.
 *
 * Returns null when "Diversified" itself is missing (defensive).
 */
export function selectIndustryBeta(name: string): DamodaranIndustryRow | null {
  if (!name) return DATA.industries.find((r) => r.industry === "Diversified") ?? null;
  const target = name.trim().toLowerCase();
  // Exact match first
  const exact = DATA.industries.find((r) => r.industry.toLowerCase() === target);
  if (exact) return exact;
  // Substring match (either direction); pick longest overlap
  let best: DamodaranIndustryRow | null = null;
  let bestScore = 0;
  for (const row of DATA.industries) {
    const lowerRow = row.industry.toLowerCase();
    if (lowerRow.includes(target) || target.includes(lowerRow)) {
      const score = Math.min(target.length, lowerRow.length);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
  }
  return best ?? DATA.industries.find((r) => r.industry === "Diversified") ?? null;
}

/**
 * Deterministic CompanyType → Damodaran industry mapping.
 *
 * The free-text selectIndustryBeta above is for display-name callers. Feeding
 * it a CompanyType enum value is fragile: the auto-detect sentinel "auto" would
 * exact-match the "Auto" (automobiles) industry and pick beta 1.10, and
 * "it-services" cannot substring-match "IT Services" because of the hyphen, so
 * it silently fell through to "Diversified". This table resolves each enum value
 * to a named industry once, deterministically.
 *
 * Two deliberate Diversified mappings (no specific automaker/conglomerate beta):
 *  - "auto": the legacy auto-DETECT sentinel, NOT automobiles — must not pick the
 *    "Auto" carmaker row.
 *  - "industrial": broad manufacturing/infra/conglomerate bucket with no single
 *    Damodaran analogue; Diversified is the honest default.
 */
const COMPANY_TYPE_TO_DAMODARAN: Record<CompanyType, string> = {
  auto: "Diversified",
  bank: "Banks",
  nbfc: "NBFC",
  insurance: "Insurance (Life)",
  industrial: "Diversified",
  "it-services": "IT Services",
  consumer: "FMCG",
  utility: "Power",
  telecom: "Telecom",
  cyclical: "Metals",
};

/**
 * Resolve the Damodaran industry row for an explicit CompanyType enum value.
 * Falls back to "Diversified" if the mapped industry is somehow absent from the
 * snapshot (defensive — every mapped name exists in the shipped table today).
 */
export function selectIndustryBetaForCompanyType(companyType: CompanyType): DamodaranIndustryRow | null {
  const industryName = COMPANY_TYPE_TO_DAMODARAN[companyType];
  return (
    DATA.industries.find((r) => r.industry === industryName)
    ?? DATA.industries.find((r) => r.industry === "Diversified")
    ?? null
  );
}

/**
 * Hamada relever: leveredBeta = unleveredBeta * (1 + (1-tax) * D/E).
 * Used to adjust the industry beta for a specific company's
 * leverage profile.
 */
export function relevereBeta(unleveredBeta: number, debtToEquity: number, taxRate: number): number {
  return unleveredBeta * (1 + (1 - taxRate) * debtToEquity);
}

export interface CapmInputs {
  beta: number;
  riskFreeRate?: number | undefined; // defaults to Damodaran rf
  equityRiskPremium?: number | undefined; // defaults to Damodaran ERP
}

export interface CapmResult {
  ke: number;
  citation: {
    retrievalDate: string;
    source: string;
    rf: { value: number; asOf: string };
    erp: { value: number; asOf: string };
    beta: number;
  };
}

/**
 * Cost of equity via CAPM:
 *   ke = rf + beta * ERP
 *
 * Defaults pull from the Damodaran snapshot (rf, ERP). Caller can
 * override either to test alternative anchors.
 */
export function capmKe(inputs: CapmInputs): CapmResult {
  const rf = inputs.riskFreeRate ?? DATA.riskFreeRate.value;
  const erp = inputs.equityRiskPremium ?? DATA.equityRiskPremium.value;
  return {
    ke: rf + inputs.beta * erp,
    citation: {
      retrievalDate: DATA.retrievalDate,
      source: DATA.source,
      rf: {
        value: rf,
        asOf: inputs.riskFreeRate != null ? "user-supplied" : DATA.riskFreeRate.asOf,
      },
      erp: {
        value: erp,
        asOf: inputs.equityRiskPremium != null ? "user-supplied" : DATA.equityRiskPremium.asOf,
      },
      beta: inputs.beta,
    },
  };
}
