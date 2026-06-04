import { trace } from "../lib/traceLogger";

/**
 * Bank Quality Indicators — Phase B5.1
 *
 * Capitaline's static .xls exports do NOT carry the asset-quality
 * indicators that drive bank investment decisions:
 *   - Gross NPA %, Net NPA %, Provision Coverage Ratio
 *   - Capital Adequacy Ratio (CRAR), Tier-1 ratio
 *   - Slippage ratio, restructured book %
 *   - CASA %, advances/deposit growth
 *
 * Those numbers live in the Annual Report's "Key Indicators" section
 * (10-year financial highlights table) and the Management Discussion
 * & Analysis (MD&A) prose. They are not reliably present in any
 * Capitaline auto-export.
 *
 * This module defines the contract for hand-curated quality data,
 * loaded from a sidecar JSON file alongside the company's Capitaline
 * exports:
 *
 *   public/data/companies/<CompanyName>/quality_indicators.json
 *
 * The sidecar is OPTIONAL — when absent, the engine still runs and
 * downstream asset-quality signals skip-with-reason. When present,
 * indicators are joined to bank metrics by period_end and surfaced
 * through `BankPeriodMetrics.quality`.
 *
 * Schema versioned so future additions (e.g., per-segment NPA, PCR
 * including write-offs) don't silently break existing fixtures.
 */

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

// ─── Validation ─────────────────────────────────────────────────────

export interface QualityValidationIssue {
  severity: "error" | "warning";
  field: string;
  period_end?: string | undefined;
  message: string;
}

export interface QualityValidationResult {
  ok: boolean;
  issues: QualityValidationIssue[];
}

/**
 * Validate a parsed sidecar payload. Returns ok=false on schema-version
 * mismatch, missing required fields, malformed period_end dates, or
 * out-of-range ratio values (e.g., GNPA > 100). Range warnings don't
 * fail validation — they're surfaced for review but the data still loads.
 */
export function validateBankQualityIndicators(
  payload: unknown,
): QualityValidationResult {
  const issues: QualityValidationIssue[] = [];

  if (payload == null || typeof payload !== "object") {
    return {
      ok: false,
      issues: [{ severity: "error", field: "(root)", message: "payload is not an object" }],
    };
  }
  const obj = payload as Record<string, unknown>;

  // Schema version
  if (obj.schema_version !== BANK_QUALITY_SCHEMA_VERSION) {
    issues.push({
      severity: "error",
      field: "schema_version",
      message: `expected "${BANK_QUALITY_SCHEMA_VERSION}", got "${String(obj.schema_version)}"`,
    });
  }

  // Required strings
  for (const key of ["company_name", "as_of_date"] as const) {
    if (typeof obj[key] !== "string" || (obj[key] as string).length === 0) {
      issues.push({
        severity: "error",
        field: key,
        message: "missing or empty",
      });
    }
  }

  // Periods array
  if (!Array.isArray(obj.periods)) {
    issues.push({ severity: "error", field: "periods", message: "must be an array" });
    return { ok: issues.every((i) => i.severity !== "error"), issues };
  }

  const seenPeriods = new Set<string>();
  for (let i = 0; i < obj.periods.length; i++) {
    const p = obj.periods[i] as Record<string, unknown> | null;
    if (p == null || typeof p !== "object") {
      issues.push({
        severity: "error",
        field: `periods[${i}]`,
        message: "must be an object",
      });
      continue;
    }
    const periodEnd = p.period_end;
    if (typeof periodEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      issues.push({
        severity: "error",
        field: `periods[${i}].period_end`,
        message: `must be ISO date YYYY-MM-DD, got "${String(periodEnd)}"`,
      });
      continue;
    }
    if (seenPeriods.has(periodEnd)) {
      issues.push({
        severity: "error",
        field: `periods[${i}].period_end`,
        period_end: periodEnd,
        message: "duplicate period_end",
      });
    }
    seenPeriods.add(periodEnd);

    // Range checks for ratio fields. Out-of-range = warning, not error,
    // because (a) some banks have anomalous reported numbers in stress
    // years, (b) a typo will still surface for the curator to fix.
    const ratioFields: Array<keyof BankQualityPeriod> = [
      "gnpa_pct", "nnpa_pct", "pcr_pct", "slippage_pct", "restructured_pct",
      "crar_pct", "tier1_pct", "cet1_pct", "casa_pct",
      "advances_growth_pct", "deposits_growth_pct",
      "solvency_ratio", "embedded_value", "nbm_pct", "vnb", "lapse_rate", "persistency_13m", "persistency_61m",
      "stage3_pct", "stage2_pct", "ecl_coverage_pct", "total_ecl_pct",
      "aum_cr", "aum_growth_pct", "off_book_share_pct",
    ];
    for (const f of ratioFields) {
      const v = p[f];
      if (v == null) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        issues.push({
          severity: "error",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `must be a finite number or null, got ${typeof v}`,
        });
        continue;
      }
      // Plausibility band: NPA/PCR/CRAR/CASA bounded; growth can be
      // negative but should not exceed +/- 100% YoY (de-mergers excluded).
      if (f === "pcr_pct" && (v < 0 || v > 100)) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `PCR ${v}% outside [0, 100]`,
        });
      } else if (
        ["gnpa_pct", "nnpa_pct", "slippage_pct", "restructured_pct"].includes(f as string) &&
        (v < 0 || v > 30)
      ) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% outside plausibility band [0, 30]`,
        });
      } else if (
        ["crar_pct", "tier1_pct", "cet1_pct"].includes(f as string) &&
        (v < 0 || v > 50)
      ) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% outside plausibility band [0, 50]`,
        });
      } else if (f === "casa_pct" && (v < 0 || v > 100)) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `CASA ${v}% outside [0, 100]`,
        });
      } else if (
        ["advances_growth_pct", "deposits_growth_pct"].includes(f as string) &&
        Math.abs(v) > 100
      ) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% magnitude > 100% — verify against AR`,
        });
      } else if (f === "solvency_ratio" && (v < 0 || v > 10)) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `Solvency ratio ${v} outside plausible range [0, 10]`,
        });
      } else if (
        ["nbm_pct", "lapse_rate", "persistency_13m", "persistency_61m"].includes(f as string) &&
        (v < 0 || v > 100)
      ) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% outside [0, 100]`,
        });
      } else if (["embedded_value", "vnb"].includes(f as string) && v < 0) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} cannot be negative`,
        });
      } else if (
        ["stage3_pct", "stage2_pct"].includes(f as string) &&
        (v < 0 || v > 30)
      ) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% outside plausibility band [0, 30]`,
        });
      } else if (
        ["ecl_coverage_pct", "total_ecl_pct", "off_book_share_pct"].includes(f as string) &&
        (v < 0 || v > 100)
      ) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% outside [0, 100]`,
        });
      } else if (f === "aum_growth_pct" && Math.abs(v) > 200) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `${f} ${v}% magnitude > 200% — verify against AR`,
        });
      } else if (f === "aum_cr" && v < 0) {
        issues.push({
          severity: "warning",
          field: `periods[${i}].${f}`,
          period_end: periodEnd,
          message: `aum_cr cannot be negative`,
        });
      }
    }

    // Cross-field sanity: NNPA <= GNPA when both present
    if (
      typeof p.gnpa_pct === "number" &&
      typeof p.nnpa_pct === "number" &&
      Number.isFinite(p.gnpa_pct) &&
      Number.isFinite(p.nnpa_pct) &&
      (p.nnpa_pct as number) > (p.gnpa_pct as number) + 0.01
    ) {
      issues.push({
        severity: "warning",
        field: `periods[${i}].nnpa_pct`,
        period_end: periodEnd,
        message: `NNPA ${p.nnpa_pct}% > GNPA ${p.gnpa_pct}% — definitionally impossible`,
      });
    }
    // Tier-1 <= CRAR when both present
    if (
      typeof p.tier1_pct === "number" &&
      typeof p.crar_pct === "number" &&
      Number.isFinite(p.tier1_pct) &&
      Number.isFinite(p.crar_pct) &&
      (p.tier1_pct as number) > (p.crar_pct as number) + 0.01
    ) {
      issues.push({
        severity: "warning",
        field: `periods[${i}].tier1_pct`,
        period_end: periodEnd,
        message: `Tier-1 ${p.tier1_pct}% > CRAR ${p.crar_pct}% — definitionally impossible`,
      });
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

// ─── Joining ────────────────────────────────────────────────────────

/**
 * Build a Map<period_end, BankQualityPeriod> for O(1) lookup when
 * joining indicators to bank metrics. Skips invalid records silently —
 * caller should call validateBankQualityIndicators first if it wants
 * to surface schema issues to the user.
 */
export function indexQualityByPeriod(
  indicators: BankQualityIndicators | null | undefined,
): Map<string, BankQualityPeriod> {
  const map = new Map<string, BankQualityPeriod>();
  if (!indicators?.periods) return map;
  for (const p of indicators.periods) {
    if (typeof p?.period_end === "string") {
      map.set(p.period_end, p);
    }
  }
  return map;
}

// ─── Browser loader ─────────────────────────────────────────────────

/**
 * Fetch a sidecar quality_indicators.json from the public data folder.
 * Returns null when the file is absent (404) — quality data is OPTIONAL.
 * Throws on parse errors or schema-version mismatches so the user knows
 * a fixture is malformed rather than silently degrading.
 *
 * @param companyFolder URL-encoded folder name under public/data/companies
 * @param fetchImpl optional fetch override for testing
 */
export async function fetchBankQualityIndicators(
  companyFolder: string,
  fetchImpl: typeof fetch = fetch,
  blobUrl?: string | null | undefined,
): Promise<BankQualityIndicators | null> {
  // Prefer Vercel Blob URL when available (Vercel deploy); fall back to local public/ path.
  const url = blobUrl ?? `/data/companies/${encodeURIComponent(companyFolder).replace(/%26/g, "&")}/quality_indicators.json`;
  const source = blobUrl ? "blob" : "local";
  trace("quality", "fetch:start", { url, source });

  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    // Network error — treat as absent rather than fatal. The bank
    // pipeline still runs without quality data.
    trace("quality", "fetch:error", { url, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    return null;
  }

  // Trace response headers for cache diagnostics
  trace("quality", "fetch:response", {
    status: res.status,
    cacheHit: res.headers.get("X-Vercel-Cache") ?? null,
    age: res.headers.get("Age") ?? null,
    cacheControl: res.headers.get("Cache-Control") ?? null,
    contentLength: res.headers.get("Content-Length") ?? null,
  });

  if (res.status === 404) {
    trace("quality", "fetch:absent", { url }, null, { level: "warn", msg: "Sidecar not found (404)" });
    return null;
  }
  if (!res.ok) {
    trace("quality", "fetch:httpError", { url, status: res.status, statusText: res.statusText }, null, { level: "error" });
    throw new Error(
      `quality_indicators fetch failed: ${res.status} ${res.statusText} for ${url}`,
    );
  }
  // Guard against Vite SPA fallback: a missing static file may return 200 HTML
  // instead of 404 when the dev server rewrites unknown paths to index.html.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("text/json")) {
    // Not JSON — treat as absent (no sidecar for this company).
    trace("quality", "fetch:contentTypeRejected", { url, contentType }, null, { level: "warn" });
    return null;
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    trace("quality", "fetch:jsonParseError", { url, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    throw new Error(
      `quality_indicators JSON parse failed for ${companyFolder}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const validation = validateBankQualityIndicators(payload);
  if (!validation.ok) {
    const errMsgs = validation.issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.field}: ${i.message}`)
      .join("; ");
    trace("quality", "fetch:schemaInvalid", {
      url,
      errorCount: validation.issues.filter((i) => i.severity === "error").length,
      issues: errMsgs.slice(0, 500),
    }, null, { level: "error" });
    throw new Error(
      `quality_indicators schema invalid for ${companyFolder}: ${errMsgs}`,
    );
  }

  const qi = payload as BankQualityIndicators;
  trace("quality", "fetch:success", {
    periods: qi.periods?.length ?? 0,
    hasSubsidiaries: qi.periods?.filter((p: BankQualityPeriod) => p.subsidiaries != null).length ?? 0,
    fields: qi.periods?.length > 0
      ? Object.keys(qi.periods[0]!).filter(k => (qi.periods[0] as unknown as Record<string, unknown>)[k] != null).length
      : 0,
  });
  return qi;
}
