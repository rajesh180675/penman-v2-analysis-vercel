/* ================================================================
   Company classification + multi-company records
   CompanyType drives pipeline routing; MultiCompanyRecord and
   CompanyRegistry are the registry-level shapes used by the
   workspace and comparison surfaces.
================================================================ */

import type { RawPeriodData } from "./raw";
import type { RecastPeriod } from "./recast";
import type { AnalysisTraceabilityEnvelope } from "./traceability";

/**
 * Phase D2 — explicit company type classification.
 * Drives pipeline routing without fragile label heuristics.
 */
export type CompanyType =
  | "auto"           // legacy: label-based heuristic detection
  | "bank"           // scheduled commercial bank (HDFC, ICICI, SBI, Axis)
  | "nbfc"           // non-banking financial company (Bajaj Finance, Shriram)
  | "insurance"      // life/general insurance (LIC, HDFC Life)
  | "industrial"     // manufacturing, infrastructure, conglomerate
  | "it-services"    // IT/software (TCS, Infosys, Wipro)
  | "consumer"       // FMCG, retail (ITC, HUL, Asian Paints)
  | "utility"        // power, gas, water (Power Grid, NTPC)
  | "telecom"        // Bharti Airtel, Vodafone Idea
  | "cyclical"       // metals, mining, capital goods (Tata Steel, JSW)
  | "loss-maker"     // structurally unprofitable / pre-earnings (Paytm pre-FY2024)
  | "conglomerate";  // diversified holding company with SOTP lens preferred

export interface MultiCompanyRecord {
  id: string; label: string;
  rawData: RawPeriodData[];
  recastData: RecastPeriod[];
  /** Explicit peer-comparison company type. Required for strict peer eligibility. */
  companyType?: CompanyType | null | undefined;
  /** Optional sector/subsector tag; when present, peer comparison requires a match. */
  sector?: string | null | undefined;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
}

export interface CompanyRegistry {
  companies: Record<string, MultiCompanyRecord>;
}
