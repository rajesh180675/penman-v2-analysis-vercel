/** Schema version — bump on breaking changes. Loader rejects mismatched versions. */
export const BANK_QUALITY_SCHEMA_VERSION = "2026-05-bank-quality-v1";

/**
 * Per-period asset-quality indicators sourced from the bank's annual
 * report. ALL ratio fields are expressed as PERCENTAGES (e.g., 1.33
 * means 1.33%), matching how they appear in ARs. This is the friction-
 * minimising convention — reviewers cross-check against the source
 * page without unit-conversion gymnastics.
 *
 * All fields except `period_end` are optional because partial coverage
 * is normal: older years may not break out PCR or slippage in the
 * highlights table; some banks omit Tier-1 from the consolidated view.
 */
export interface BankQualityPeriod {
  /** ISO date of the fiscal year end (e.g., "2025-03-31"). */
  period_end: string;
  /** Human-readable label for cross-referencing source docs (e.g., "FY25"). */
  fiscal_label?: string | undefined;

  // ── Asset quality ────────────────────────────────────────────────
  /** Gross NPA as % of gross advances. */
  gnpa_pct?: number | null | undefined;
  /** Net NPA as % of net advances. */
  nnpa_pct?: number | null | undefined;
  /** Provision Coverage Ratio %. Definition varies by bank — capture
   *  the headline number reported and explain in `source_notes` if it
   *  excludes/includes technical write-offs. */
  pcr_pct?: number | null | undefined;
  /** Slippage ratio % — fresh slippages / opening standard advances.
   *  Often reported only in MD&A prose, not in the highlights table. */
  slippage_pct?: number | null | undefined;
  /** Restructured/standard restructured book as % of advances. */
  restructured_pct?: number | null | undefined;

  // ── Capital adequacy ─────────────────────────────────────────────
  /** Capital to Risk-Weighted Assets Ratio (CRAR / CAR) %. */
  crar_pct?: number | null | undefined;
  /** Tier-1 capital ratio %. */
  tier1_pct?: number | null | undefined;
  /** Common Equity Tier-1 (CET1) ratio %. Optional — banks vary on
   *  whether they break this out from Tier-1 in the highlights table. */
  cet1_pct?: number | null | undefined;

  // ── Funding mix ──────────────────────────────────────────────────
  /** CASA (Current + Savings) deposits as % of total deposits. */
  casa_pct?: number | null | undefined;

  // ── Growth ───────────────────────────────────────────────────────
  /** YoY growth in advances %. */
  advances_growth_pct?: number | null | undefined;
  /** YoY growth in total deposits %. */
  deposits_growth_pct?: number | null | undefined;

  // ── Insurance indicators (Tier 2 sidecar) ────────────────────────
  /** Solvency ratio (e.g. 1.85 means 1.85x / 185%). */
  solvency_ratio?: number | null | undefined;
  /** Embedded Value (EV) in Cr. */
  embedded_value?: number | null | undefined;
  /** New Business Margin (NBM) %. */
  nbm_pct?: number | null | undefined;
  /** Value of New Business (VNB) in Cr. */
  vnb?: number | null | undefined;
  /** Lapse rate %. */
  lapse_rate?: number | null | undefined;
  /** 13th month persistency %. */
  persistency_13m?: number | null | undefined;
  /** 61st month persistency %. */
  persistency_61m?: number | null | undefined;

  // ── Insurance Tier 1 (AR IRDAI 5-year summary) ────────────────────
  // Capitaline Ind-AS does NOT carry these for life insurers (LIC). The
  // AR's "Summary of Financial Statements" has them in a structured form.
  // See scripts/extract_insurance_quality.py.
  /** Gross premium income (₹ Cr). */
  gross_premium_cr?: number | null | undefined;
  /** Net premium income (gross - reinsurance ceded) (₹ Cr). */
  net_premium_cr?: number | null | undefined;
  /** Net claims paid / benefits paid (₹ Cr). */
  claims_paid_cr?: number | null | undefined;
  /** Operating expenses related to insurance business (₹ Cr). */
  operating_expenses_cr?: number | null | undefined;
  /** Commissions paid to agents/brokers (₹ Cr). */
  commissions_cr?: number | null | undefined;
  /** Investment income from policyholders' fund (₹ Cr). */
  investment_income_cr?: number | null | undefined;
  /** Yield on policyholders' fund investments (%). */
  investment_yield_pct?: number | null | undefined;
  /** Claims ratio = claims_paid / net_premium (%). */
  claims_ratio_pct?: number | null | undefined;
  /** Expense ratio = (opex + commissions) / net_premium (%). */
  expense_ratio_pct?: number | null | undefined;
  /** Combined ratio = claims_ratio + expense_ratio (%). */
  combined_ratio_pct?: number | null | undefined;
  /** YoY premium growth (%). */
  premium_growth_pct?: number | null | undefined;

  // ── NBFC indicators (IndAS 109 ECL framework) ────────────────────
  /** Stage 3 (credit-impaired) loans as % of gross loan book. NBFC GNPA equivalent. */
  stage3_pct?: number | null | undefined;
  /** Stage 2 (significant credit deterioration) loans as % of gross loan book. */
  stage2_pct?: number | null | undefined;
  /** Impairment loss allowance on Stage 3 / Gross Stage 3 — ECL coverage of bad book. */
  ecl_coverage_pct?: number | null | undefined;
  /** Total ECL provision / Gross loan book — overall provisioning intensity. */
  total_ecl_pct?: number | null | undefined;
  /** Assets Under Management (consolidated, ₹ Cr). NBFC-specific scale metric. */
  aum_cr?: number | null | undefined;
  /** YoY AUM growth %. NBFC equivalent of "loan book growth". */
  aum_growth_pct?: number | null | undefined;
  /** Off-book / assignment / co-lending share of AUM %. Fee-based vs spread-based mix. */
  off_book_share_pct?: number | null | undefined;
  /** AR-reported cost-to-income ratio (Opex/NTI %). Definitive figure from management. */
  cost_to_income_pct?: number | null | undefined;

  // ── Audit trail ──────────────────────────────────────────────────
  /** Source PDF filename, e.g., "HDFCBANK_AR_FY2025.pdf". */
  source_doc?: string | undefined;
  /** Page number in the source PDF where these numbers appear. */
  source_page?: number | undefined;
  /** Per-record notes (e.g., "PCR excludes technical write-offs"). */
  source_notes?: string | undefined;

  // ── Subsidiary data (from Capitaline sidecar XLS) ───────────────
  /** Per-subsidiary financials from the Capitaline "Subsidiaries" export.
   *  Each entry represents one subsidiary's standalone financials for this period. */
  subsidiaries?: SubsidiaryRecord[] | null | undefined;
}

/** A single subsidiary's financials for one fiscal year. */
export interface SubsidiaryRecord {
  name: string;
  equity_cr?: number | null | undefined;
  reserves_cr?: number | null | undefined;
  investment_cost_cr?: number | null | undefined;
  pat_cr?: number | null | undefined;
  total_assets_cr?: number | null | undefined;
  total_liabilities_cr?: number | null | undefined;
  sales_cr?: number | null | undefined;
}

export interface BankQualityIndicators {
  /** Schema version — must equal BANK_QUALITY_SCHEMA_VERSION. */
  schema_version: string;
  /** Company name as it appears in the AR. */
  company_name: string;
  /** ISO date for the latest period covered. */
  as_of_date: string;
  /** Free-form notes covering source provenance. */
  source_notes?: string | undefined;
  /** Per-period records, one per fiscal year. Need not be sorted. */
  periods: BankQualityPeriod[];
}
