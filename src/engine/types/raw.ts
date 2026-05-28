/* ================================================================
   Raw / ingestion-side primitives
   Shapes produced by parsers (Capitaline, Screener, JSON, XBRL,
   Manual) before recasting. Plain numeric primitives — see Plan 1
   PR-1.4 for the branded-primitive successor.
================================================================ */

export interface RawPeriodData {
  company_id: string;
  period_end: string;
  raw_metric_values: Record<string, number | null>;
  /**
   * Phase A — Multi-standard ingestion.
   * Dominant accounting standard for this period's source files.
   * Optional for backward compatibility: pre-existing fixtures and
   * synthetic test data won't carry this. When present, the rigor
   * envelope discounts pre-Ind-AS periods.
   */
  accounting_standard?: "ind-as" | "revised-sch-vi" | "standard" | "unknown" | undefined;
  /**
   * Phase I7 — Currency unit auto-detection.
   * Records what unit was detected in the Capitaline source file.
   * The parser normalises ALL raw_metric_values to ₹ Crores before
   * storing them — this field is for audit/traceability only.
   *
   *   "Crores"   — no scaling applied (default; most large-cap exports)
   *   "Lakhs"    — source was in lakhs; values multiplied by 0.01
   *   "Millions" — source was in millions; values multiplied by 0.1
   *   "Thousands"— source was in thousands; values multiplied by 0.0001
   *   "Absolute" — source was in absolute Rs.; values multiplied by 1e-7
   *   "Unknown"  — header row present but unit string unrecognised
   *
   * When absent (legacy fixtures, synthetic test data), assume Crores.
   */
  currency_unit?: "Crores" | "Lakhs" | "Millions" | "Thousands" | "Absolute" | "Unknown" | undefined;
}

export type TraceStatement = "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Derived" | "Fallback";

export interface TraceEntry {
  statement: TraceStatement;
  key: string;
  value: number;
  matchType: "exact_composite" | "exact_base" | "fuzzy" | "derived";
  note?: string | undefined;
}

export type TraceMap = Record<string, TraceEntry[]>;
