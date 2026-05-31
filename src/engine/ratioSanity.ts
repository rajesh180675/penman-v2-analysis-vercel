/**
 * Phase 9 — Anchor ratio bands (economic sanity gates).
 *
 * Reconciliation catches structural integrity failures (TA = Equity + Liab).
 * This catches the next layer up: outputs that reconcile cleanly but produce
 * economically impossible numbers — a "bank" with 60% NIM, an "IT-services"
 * firm with 5% PM, an industrial with 200% ROCE.
 *
 * Each ratio gets:
 *   - normal band   (typical, no flag)
 *   - warning band  (unusual but plausible — surface for review)
 *   - fail band     (economically impossible — blocks "production-ready")
 *
 * Bands are heuristic, sector-typical ranges informed by Indian listed-company
 * norms over roughly the FY2014–FY2025 window. They are hand-set from domain
 * knowledge (and RBI sector aggregates for banks/NBFCs), not derived from a
 * formal NSE-500 percentile study.
 */

import type { CompanyType } from "./types";

export type SanityStatus = "ok" | "warning" | "fail" | "n/a";

export interface SanityBand {
  /** [low, high] — values inside this range are normal. */
  normal: [number, number];
  /** [low, high] — values inside warning but outside normal trigger a warning. */
  warning: [number, number];
}

export interface SanityCheck {
  /** Stable identifier (e.g. "bank.nim", "industrial.rnoa"). */
  key: string;
  /** Human-readable label. */
  label: string;
  /** The observed value. null = not computed, marked "n/a". */
  value: number | null;
  band: SanityBand;
  status: SanityStatus;
  /** Why this status — for surfacing in the UI. */
  detail: string;
}

export interface SanityAssessment {
  companyType: CompanyType;
  /** Overall status — worst of all checks (n/a if no checks ran). */
  status: SanityStatus;
  checks: SanityCheck[];
  warningCount: number;
  failCount: number;
  summary: string;
}

// ─── Bands ──────────────────────────────────────────────────────────────────
//
// Each band is a hand-set, sector-typical range informed by Indian listed-company
// norms over roughly FY2014-FY2025. The "warning" band approximates a plausible
// tail (think ~P5/P95) and "normal" the central range (~P15/P85) — these are
// heuristic anchors, not computed percentiles. Values outside warning are
// economically implausible.
//
// Where banks/NBFCs are concerned, we use stricter regulatory ranges (RBI
// publishes sector aggregates).

const BAND = (normalLow: number, normalHigh: number, warnLow: number, warnHigh: number): SanityBand => ({
  normal: [normalLow, normalHigh],
  warning: [warnLow, warnHigh],
});

const BANDS = {
  // Banks (commercial banks under RBI supervision)
  bank: {
    nim:      BAND(0.020, 0.045,  0.010, 0.060),  // NIM 2.0-4.5% normal, fail outside 1-6%
    roa:      BAND(0.005, 0.020,  0.002, 0.030),  // ROA 0.5-2.0%
    roe:      BAND(0.080, 0.200,  0.040, 0.300),  // ROE 8-20%
    costToIncome: BAND(0.35, 0.55, 0.25, 0.70),   // C/I 35-55%
    creditCost:   BAND(0.001, 0.020, 0.000, 0.060), // 0.1-2.0% normal, fail >6%
  },
  // NBFCs (non-bank financial — Bajaj Finance, Shriram, etc.)
  nbfc: {
    nim:      BAND(0.040, 0.110,  0.020, 0.150),  // NIM 4-11%, NBFCs run higher than banks
    roa:      BAND(0.015, 0.045,  0.005, 0.070),  // ROA 1.5-4.5%
    roe:      BAND(0.100, 0.220,  0.050, 0.350),  // ROE 10-22%
    leverage: BAND(2.5, 7.0,      1.5, 10.0),     // Borrowings/Equity 2.5-7x
    spread:   BAND(0.030, 0.100,  0.010, 0.150),  // Spread 3-10%
    yieldOnAdvances: BAND(0.090, 0.200, 0.060, 0.280),
    costOfBorrowings: BAND(0.060, 0.100, 0.030, 0.150),
  },
  // Industrial (broad — manufacturing, infra, conglomerate)
  industrial: {
    roce:     BAND(0.05, 0.30,   -0.05, 0.60),
    rnoa:     BAND(0.05, 0.35,   -0.10, 0.80),
    pm:       BAND(0.03, 0.20,   -0.05, 0.40),  // Sales PM
    flev:     BAND(0.0, 1.5,     -0.5,  3.0),
  },
  // IT-services (TCS, Infosys, asset-light, human-capital intensive)
  "it-services": {
    pm:       BAND(0.15, 0.30,    0.08, 0.40),  // PM 15-30% normal
    roce:     BAND(0.20, 0.55,    0.10, 0.80),  // ROCE 20-55%
    rnoa:     BAND(0.30, 1.50,    0.15, 3.00),  // Sky-high RNOA — small NOA denominator
  },
  // Consumer / FMCG (ITC, HUL, Asian Paints — high margin, ROCE)
  consumer: {
    pm:       BAND(0.10, 0.25,    0.05, 0.40),
    roce:     BAND(0.15, 0.50,    0.08, 0.80),
    rnoa:     BAND(0.15, 0.80,    0.08, 2.00),
  },
  // Utility / PSU (Power Grid, NTPC — regulated returns)
  utility: {
    roce:     BAND(0.08, 0.18,    0.04, 0.25),  // Regulated, narrow band
    pm:       BAND(0.10, 0.30,    0.05, 0.45),
    rnoa:     BAND(0.05, 0.18,    0.02, 0.25),
  },
  // Telecom (Bharti, Vodafone Idea — capital intensive, often loss-making)
  telecom: {
    pm:       BAND(-0.10, 0.25,  -0.40, 0.40),
    roce:     BAND(-0.05, 0.20,  -0.30, 0.40),
  },
  // Cyclical (metals, mining — wide bands, peak/trough swings)
  cyclical: {
    roce:     BAND(-0.05, 0.30,  -0.20, 0.60),
    pm:       BAND(-0.05, 0.25,  -0.20, 0.40),
    rnoa:     BAND(-0.10, 0.40,  -0.30, 0.80),
  },
} as const;

function classify(value: number, band: SanityBand): SanityStatus {
  if (value >= band.normal[0] && value <= band.normal[1]) return "ok";
  if (value >= band.warning[0] && value <= band.warning[1]) return "warning";
  return "fail";
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatBand(b: SanityBand, asPercent = true): string {
  const fmt = asPercent ? pct : (n: number) => n.toFixed(2) + "x";
  return `normal ${fmt(b.normal[0])}–${fmt(b.normal[1])}, warn ${fmt(b.warning[0])}–${fmt(b.warning[1])}`;
}

function check(
  key: string,
  label: string,
  value: number | null | undefined,
  band: SanityBand,
  asPercent = true,
): SanityCheck {
  if (value == null || !Number.isFinite(value)) {
    return {
      key, label, value: null, band, status: "n/a",
      detail: `${label}: not computed`,
    };
  }
  const status = classify(value, band);
  const fmt = asPercent ? pct : (n: number) => n.toFixed(2) + "x";
  const detail = status === "ok"
    ? `${label} = ${fmt(value)} (within normal band)`
    : status === "warning"
      ? `${label} = ${fmt(value)} — outside normal band but plausible (${formatBand(band, asPercent)})`
      : `${label} = ${fmt(value)} — economically implausible (${formatBand(band, asPercent)})`;
  return { key, label, value, band, status, detail };
}

export interface SanityInput {
  companyType: CompanyType;
  // Bank/NBFC metrics (latest period)
  bank?: {
    nim?: number | null | undefined;
    roa?: number | null | undefined;
    roe?: number | null | undefined;
    costToIncome?: number | null | undefined;
    creditCost?: number | null | undefined;
    leverage?: number | null | undefined;
    spread?: number | null | undefined;
    yieldOnAdvances?: number | null | undefined;
    costOfBorrowings?: number | null | undefined;
  };
  // Industrial metrics (latest period)
  industrial?: {
    ROCE?: number | null | undefined;
    RNOA?: number | null | undefined;
    PM?: number | null | undefined;
    SalesPM?: number | null | undefined;
    FLEV?: number | null | undefined;
  };
}

/**
 * Run economic sanity checks for the given company type and metrics.
 * Returns "n/a" status when the company type doesn't have bands defined
 * (e.g. insurance — those use a different framework entirely) or when
 * no metrics were provided.
 */
export function evaluateRatioSanity(input: SanityInput): SanityAssessment {
  const ct = input.companyType;
  const checks: SanityCheck[] = [];

  if (ct === "bank" && input.bank) {
    const b = input.bank;
    checks.push(check("bank.nim", "NIM", b.nim, BANDS.bank.nim));
    checks.push(check("bank.roa", "ROA", b.roa, BANDS.bank.roa));
    checks.push(check("bank.roe", "ROE", b.roe, BANDS.bank.roe));
    if (b.costToIncome != null) checks.push(check("bank.cti", "Cost-to-Income", b.costToIncome, BANDS.bank.costToIncome));
    if (b.creditCost != null) checks.push(check("bank.credit-cost", "Credit Cost", b.creditCost, BANDS.bank.creditCost));
  } else if (ct === "nbfc" && input.bank) {
    const b = input.bank;
    checks.push(check("nbfc.nim", "NIM", b.nim, BANDS.nbfc.nim));
    checks.push(check("nbfc.roa", "ROA", b.roa, BANDS.nbfc.roa));
    checks.push(check("nbfc.roe", "ROE", b.roe, BANDS.nbfc.roe));
    if (b.leverage != null) checks.push(check("nbfc.leverage", "Leverage", b.leverage, BANDS.nbfc.leverage, false));
    if (b.spread != null) checks.push(check("nbfc.spread", "Spread", b.spread, BANDS.nbfc.spread));
    if (b.yieldOnAdvances != null) checks.push(check("nbfc.yield", "Yield on Advances", b.yieldOnAdvances, BANDS.nbfc.yieldOnAdvances));
    if (b.costOfBorrowings != null) checks.push(check("nbfc.cob", "Cost of Borrowings", b.costOfBorrowings, BANDS.nbfc.costOfBorrowings));
  } else if (ct === "industrial" || ct === "auto" || !ct) {
    const i = input.industrial;
    if (i) {
      checks.push(check("industrial.roce", "ROCE", i.ROCE, BANDS.industrial.roce));
      checks.push(check("industrial.rnoa", "RNOA", i.RNOA, BANDS.industrial.rnoa));
      checks.push(check("industrial.pm", "PM", i.PM ?? i.SalesPM, BANDS.industrial.pm));
      if (i.FLEV != null) checks.push(check("industrial.flev", "FLEV", i.FLEV, BANDS.industrial.flev, false));
    }
  } else if (ct === "it-services" && input.industrial) {
    const i = input.industrial;
    checks.push(check("it.pm", "PM", i.PM ?? i.SalesPM, BANDS["it-services"].pm));
    checks.push(check("it.roce", "ROCE", i.ROCE, BANDS["it-services"].roce));
    checks.push(check("it.rnoa", "RNOA", i.RNOA, BANDS["it-services"].rnoa));
  } else if (ct === "consumer" && input.industrial) {
    const i = input.industrial;
    checks.push(check("consumer.pm", "PM", i.PM ?? i.SalesPM, BANDS.consumer.pm));
    checks.push(check("consumer.roce", "ROCE", i.ROCE, BANDS.consumer.roce));
    checks.push(check("consumer.rnoa", "RNOA", i.RNOA, BANDS.consumer.rnoa));
  } else if (ct === "utility" && input.industrial) {
    const i = input.industrial;
    checks.push(check("utility.roce", "ROCE", i.ROCE, BANDS.utility.roce));
    checks.push(check("utility.pm", "PM", i.PM ?? i.SalesPM, BANDS.utility.pm));
    checks.push(check("utility.rnoa", "RNOA", i.RNOA, BANDS.utility.rnoa));
  } else if (ct === "telecom" && input.industrial) {
    const i = input.industrial;
    checks.push(check("telecom.pm", "PM", i.PM ?? i.SalesPM, BANDS.telecom.pm));
    checks.push(check("telecom.roce", "ROCE", i.ROCE, BANDS.telecom.roce));
  } else if (ct === "cyclical" && input.industrial) {
    const i = input.industrial;
    checks.push(check("cyclical.roce", "ROCE", i.ROCE, BANDS.cyclical.roce));
    checks.push(check("cyclical.pm", "PM", i.PM ?? i.SalesPM, BANDS.cyclical.pm));
    checks.push(check("cyclical.rnoa", "RNOA", i.RNOA, BANDS.cyclical.rnoa));
  }

  const warningCount = checks.filter(c => c.status === "warning").length;
  const failCount = checks.filter(c => c.status === "fail").length;

  let status: SanityStatus = "n/a";
  if (checks.length > 0) {
    if (failCount > 0) status = "fail";
    else if (warningCount > 0) status = "warning";
    else status = "ok";
  }

  const summary = checks.length === 0
    ? `No sanity bands defined for company_type=${ct}.`
    : status === "fail"
      ? `${failCount} ratio(s) outside plausible range — review data integrity or company classification.`
      : status === "warning"
        ? `${warningCount} ratio(s) outside normal band but within plausible range.`
        : `All ${checks.length} ratios within normal economic bands for ${ct}.`;

  return {
    companyType: ct ?? "auto",
    status,
    checks,
    warningCount,
    failCount,
    summary,
  };
}
