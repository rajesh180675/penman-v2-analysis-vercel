/**
 * Analytics workbook sheets (Ratios, Forecast, Valuation, Quality)  extracted verbatim from excelExport.ts.
 */
import type { EngineConfig, ForecastScenario, RecastPeriod, ValuationResult } from "../types";
import { NP_BENCHMARKS } from "../types";
import type { WorkSheet } from "./xlsx";
import {
  cell,
  setCell,
  updateRef,
  HEADER_BLUE,
  SUBHEADER,
  LABEL,
  LABEL_BOLD,
  NUM_INR,
  NUM_PCT,
  NUM_2DP,
  RED_NUM,
  GREEN_FILL,
  AMBER_FILL,
} from "./xlsx";
import type { WorkbookExportMetadata } from "./sheetsCore";

// ── Sheet 3: Ratios ─────────────────────────────────────────────────────────────
export function buildRatioSheet(recastData: RecastPeriod[]): WorkSheet {
  const ws: WorkSheet = {};
  const periods = recastData.map(p => p.period_end.slice(0, 7));
  let row = 0;

  setCell(ws, row, 0, cell("N&P RATIO DECOMPOSITION — Nissim & Penman (2001), Eq.1–16", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  setCell(ws, row, periods.length + 1, cell("N&P Benchmark (p25)", SUBHEADER));
  setCell(ws, row, periods.length + 2, cell("N&P Median", SUBHEADER));
  setCell(ws, row, periods.length + 3, cell("N&P p75", SUBHEADER));
  row++;

  const ratioRows: [string, (p: RecastPeriod) => number | null, string | undefined, boolean][] = [
    ["§5.1 PROFITABILITY", () => null, undefined, true],
    ["ROCE = CNI / avg(CSE)  [Eq.1]", p => p.ratios?.ROCE ?? null, "ROCE", false],
    ["RNOA = OI / avg(NOA)  [Eq.2]", p => p.ratios?.RNOA ?? null, "RNOA", false],
    ["NBC = NFE / avg(NFO)", p => p.ratios?.NBC ?? null, "NBC", false],
    ["SPREAD = RNOA − NBC  [Eq.3]", p => p.ratios?.SPREAD ?? null, "SPREAD", false],
    ["", () => null, undefined, true],
    ["§5.2 LEVERAGE", () => null, undefined, true],
    ["FLEV = NFO / CSE  [Eq.4]", p => p.ratios?.FLEV ?? null, "FLEV", false],
    ["OLLEV = OL / avg(NOA)  [Eq.5]", p => p.ratios?.OLLEV ?? null, "OLLEV", false],
    ["OLSPREAD = ROOA − io  [Eq.6]", p => p.ratios?.OLSPREAD ?? null, "OLSPREAD", false],
    ["", () => null, undefined, true],
    ["§5.3 OPERATING EFFICIENCY", () => null, undefined, true],
    ["PM = OI / Sales  [Eq.7]", p => p.ratios?.PM ?? null, "PM", false],
    ["ATO = Sales / avg(NOA)  [Eq.8]", p => p.ratios?.ATO ?? null, "ATO", false],
    ["Core Sales PM = Core OI / Sales", p => p.ratios?.CoreSalesPM ?? null, "PM", false],
    ["Sales Growth", p => p.ratios?.Sales_growth ?? null, "Sales_growth", false],
    ["NOA Growth", p => p.ratios?.NOA_growth ?? null, "NOA_growth", false],
    ["", () => null, undefined, true],
    ["§5.4 WORKING CAPITAL", () => null, undefined, true],
    ["Days Receivable (DSO)", p => p.ratios?.days_receivable ?? null, undefined, false],
    ["Days Payable (DPO)", p => p.ratios?.days_payable ?? null, undefined, false],
    ["Days Inventory (DIO)", p => p.ratios?.days_inventory ?? null, undefined, false],
    ["Cash Conversion Cycle (CCC)", p => p.ratios?.cash_conversion_cycle ?? null, undefined, false],
    ["Current Ratio", p => p.ratios?.current_ratio ?? null, undefined, false],
    ["", () => null, undefined, true],
    ["§5.5 ACCOUNTING QUALITY", () => null, undefined, true],
    ["Accrual Ratio (B/S method)", p => p.ratios?.accrual_ratio_bs ?? null, undefined, false],
    ["Accrual Ratio (C/F method)", p => p.ratios?.accrual_ratio_cf ?? null, undefined, false],
    ["Cash Conversion Ratio (CFO/OI)", p => p.ratios?.cash_conversion_ratio ?? null, undefined, false],
    ["Interest Coverage", p => p.ratios?.interest_coverage ?? null, undefined, false],
    ["ROCE Bridge Residual (Eq.16 error)", p => p.ratios?.ROCE_eq16_error ?? null, undefined, false],
  ];

  const pctKeys = new Set(["ROCE", "RNOA", "NBC", "SPREAD", "PM", "OLLEV", "OLSPREAD", "Sales_growth", "NOA_growth",
    "accrual_ratio_bs", "accrual_ratio_cf", "cash_conversion_ratio", "CoreSalesPM", "ROCE_eq16_error",
    "FLEV", "ATO"]);

  for (const [label, fn, benchKey, isSectionHeader] of ratioRows) {
    if (isSectionHeader) {
      setCell(ws, row, 0, cell(label, { font: { bold: true, sz: 10, color: { rgb: "4472C4" } } }));
      row++;
      continue;
    }
    setCell(ws, row, 0, cell(label, LABEL));
    const isPct = benchKey && pctKeys.has(benchKey);
    const isDays = label.includes("Days") || label.includes("CCC") || label.includes("Coverage");
    recastData.forEach((p, c) => {
      const v = fn(p);
      const style = isPct ? NUM_PCT : isDays ? NUM_2DP : NUM_2DP;
      setCell(ws, row, c + 1, cell(v, style));
    });
    if (benchKey && NP_BENCHMARKS[benchKey]) {
      const bm = NP_BENCHMARKS[benchKey];
      const s = isPct ? NUM_PCT : NUM_2DP;
      setCell(ws, row, periods.length + 1, cell(bm.p25, s));
      setCell(ws, row, periods.length + 2, cell(bm.median, { ...s, fill: { fgColor: { rgb: "FFF2CC" } } }));
      setCell(ws, row, periods.length + 3, cell(bm.p75, s));
    }
    row++;
  }

  ws["!cols"] = [{ wch: 42 }, ...recastData.map(() => ({ wch: 13 })), { wch: 16 }, { wch: 16 }, { wch: 16 }];
  updateRef(ws);
  return ws;
}

// ── Sheet 4: Forecast ──────────────────────────────────────────────────────────
export function buildForecastSheet(scenarios: ForecastScenario[]): WorkSheet {
  const ws: WorkSheet = {};
  let row = 0;

  setCell(ws, row, 0, cell("FORECAST MODEL — Fade-Based Pro Forma (N&P 2001, §4)", HEADER_BLUE));
  row++;

  for (const sc of scenarios) {
    if (!sc.periods?.length) continue;
    row++;
    setCell(ws, row, 0, cell(`SCENARIO: ${sc.name.toUpperCase()} (P = ${(sc.probability * 100).toFixed(0)}%)`,
      { fill: { fgColor: { rgb: sc.name === "bull" ? "E2EFDA" : sc.name === "bear" ? "FCE4D6" : "DDEEFF" } }, font: { bold: true, sz: 10 } }));
    row++;

    const headers = ["Driver / Period", ...sc.periods.map(p => p.period_label)];
    headers.forEach((h, c) => setCell(ws, row, c, cell(h, SUBHEADER)));
    row++;

    const fRows: [string, (p: NonNullable<ForecastScenario["periods"]>[number]) => number][] = [
      ["Sales Growth Assumption", p => p.sales_growth_assumption],
      ["Core Sales PM", p => p.core_sales_pm_assumption],
      ["Asset Turnover (ATO)", p => p.ato_assumption],
      ["Material / Sales", p => p.material_cost_ratio_assumption ?? 0],
      ["Employee / Sales", p => p.employee_cost_ratio_assumption ?? 0],
      ["Depreciation / Sales", p => p.depreciation_ratio_assumption ?? 0],
      ["SG&A / Sales", p => p.sga_ratio_assumption ?? 0],
      ["Other Opex / Sales", p => p.other_opex_ratio_assumption ?? 0],
      ["Other Op Income / Sales", p => p.other_operating_income_ratio_assumption ?? 0],
      ["Forecast Sales (₹ Cr)", p => p.Sales_f],
      ["Forecast Gross Profit (₹ Cr)", p => p.GrossProfit_f ?? 0],
      ["Forecast Material Cost (₹ Cr)", p => p.MaterialCost_f ?? 0],
      ["Forecast Employee Cost (₹ Cr)", p => p.EmployeeCost_f ?? 0],
      ["Forecast Depreciation (₹ Cr)", p => p.Depreciation_f ?? 0],
      ["Forecast SG&A (₹ Cr)", p => p.SGA_f ?? 0],
      ["Forecast Other Opex (₹ Cr)", p => p.OtherOperatingExpense_f ?? 0],
      ["Forecast Other Op Income (₹ Cr)", p => p.OtherOperatingIncome_f ?? 0],
      ["Forecast Core OI Bridge (₹ Cr)", p => p.CoreOI_bridge_f ?? p.OI_f],
      ["Forecast NOA (₹ Cr)", p => p.NOA_f],
      ["Forecast OI (₹ Cr)", p => p.OI_f],
      ["Forecast CNI (₹ Cr)", p => p.CNI_f],
      ["Forecast ΔNOA (₹ Cr)", p => p.ΔNOA_f],
      ["Free Cash Flow (₹ Cr)", p => p.FCF_f],
      ["Residual Earnings RE (₹ Cr)", p => p.RE_f],
      ["Residual Op. Income ReOI (₹ Cr)", p => p.ReOI_f],
    ];
    const pctRowLabels = new Set([
      "Sales Growth Assumption",
      "Core Sales PM",
      "Asset Turnover (ATO)",
      "Material / Sales",
      "Employee / Sales",
      "Depreciation / Sales",
      "SG&A / Sales",
      "Other Opex / Sales",
      "Other Op Income / Sales",
    ]);

    for (const [label, fn] of fRows) {
      setCell(ws, row, 0, cell(label, LABEL));
      sc.periods.forEach((p, c) => {
        const v = fn(p);
        const style = pctRowLabels.has(label) ? NUM_PCT : (label.includes("RE") || label.includes("ReOI") ? (v >= 0 ? GREEN_FILL : { ...RED_NUM, numFmt: "#,##0" }) : NUM_INR);
        setCell(ws, row, c + 1, cell(v, style));
      });
      row++;
    }

    if (sc.valuationResult) {
      const vr = sc.valuationResult;
      row++;
      setCell(ws, row, 0, cell(`Valuation (${sc.name}) — ke=${(sc.drivers.ke * 100).toFixed(1)}%, kw=${(sc.drivers.kw * 100).toFixed(1)}%, g=${(sc.drivers.g_terminal * 100).toFixed(1)}%`, LABEL_BOLD));
      row++;
      [
        ["V_RE_CV3 (Equity Value)", vr.V_RE_CV3],
        ["V_ReOI_CV03 (Equity Value)", vr.V_ReOI_CV03],
      ].forEach(([label, v]) => {
        setCell(ws, row, 0, cell(label as string, LABEL));
        setCell(ws, row, 1, cell(v as number, GREEN_FILL));
        row++;
      });
    }
  }

  ws["!cols"] = [{ wch: 36 }, ...Array(10).fill({ wch: 14 })];
  updateRef(ws);
  return ws;
}

// ── Sheet 5: Valuation Summary ─────────────────────────────────────────────────
export function buildValuationSheet(valuation: ValuationResult, config: EngineConfig, metadata?: WorkbookExportMetadata): WorkSheet {
  const valuationBlocked = metadata?.valuationStatus === "guarded";
  const ws: WorkSheet = {};
  let row = 0;
  const versions = metadata?.policyVersions;

  setCell(ws, row, 0, cell("VALUATION SUMMARY — Model Triangulation", HEADER_BLUE));
  row++;
  setCell(ws, row, 0, cell("Audit Run ID", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.auditRunId ?? "—", LABEL));
  row++;
  setCell(ws, row, 0, cell("Valuation Status", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationStatus ?? "production-ready", LABEL));
  row++;
  setCell(ws, row, 0, cell("Anchor Period", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationAnchorPeriod ?? "—", LABEL));
  row++;
  setCell(ws, row, 0, cell("Latest Source Period", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationSourcePeriod ?? "—", LABEL));
  row++;
  setCell(ws, row, 0, cell("Status Note", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationReasons?.[0] ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } }));
  row++;
  setCell(ws, row, 0, cell("Policy Versions", LABEL_BOLD));
  setCell(
    ws,
    row,
    1,
    cell(
      versions
        ? `engine=${versions.engineVersion}; mapping-spec=${versions.mappingSpecVersion}; mapping-policy=${versions.mappingPolicyVersion}; anomaly=${versions.anomalyPolicyVersion}; valuation=${versions.valuationPolicyVersion}`
        : "—",
      { font: { sz: 8 }, alignment: { wrapText: true } },
    ),
  );
  row += 2;

  setCell(ws, row, 0, cell("Assumptions", LABEL_BOLD));
  row++;
  [
    ["Cost of Equity (ke)", valuation.ke, true],
    ["WACC (kw)", valuation.kw, true],
    ["Terminal Growth (g)", valuation.g, true],
  ].forEach(([l, v, isPct]) => {
    setCell(ws, row, 0, cell(l as string, LABEL));
    setCell(ws, row, 1, cell(v as number, isPct ? NUM_PCT : NUM_2DP));
    row++;
  });

  row++;
  setCell(ws, row, 0, cell("MODEL OUTPUTS (₹ Crores)", HEADER_BLUE));
  row++;
  setCell(ws, row, 0, cell("Model", SUBHEADER));
  setCell(ws, row, 1, cell("Equity Value (₹ Cr)", SUBHEADER));
  setCell(ws, row, 2, cell("Per Share", SUBHEADER));
  setCell(ws, row, 3, cell("Notes", SUBHEADER));
  row++;

  const models: [string, number | null | undefined, number | null | undefined, string][] = valuationBlocked
    ? [
        ["RE (CV3 — Gordon Growth)", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["ReOI (CV03 — Gordon Growth)", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["FCFF", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["FCFE", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["DDM", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["AEG (Ohlson-Juettner)", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
      ]
    : [
        ["RE (CV3 — Gordon Growth)", valuation.V_RE_CV3, valuation.perShare?.intrinsic_re_per_share, "N&P Eq.(1a) — Clean surplus accounting"],
        ["ReOI (CV03 — Gordon Growth)", valuation.V_ReOI_CV03, valuation.perShare?.intrinsic_reoi_per_share, "N&P Eq.(9) — Operating focus; EV − NFO"],
        ["FCFF", valuation.fcf?.EV_FCFF != null ? valuation.fcf.EV_FCFF - valuation.NFO_latest : null, valuation.perShare?.intrinsic_fcff_per_share, "FCFF = NOPAT − ΔNOA; EV at WACC; less NFO"],
        ["FCFE", valuation.fcf?.V_FCFE, valuation.perShare?.intrinsic_fcfe_per_share, "FCFE = CNI − ΔCSE; discounted at ke"],
        ["DDM", valuation.perShare?.intrinsic_ddm_per_share != null && config.shares_outstanding ? valuation.perShare.intrinsic_ddm_per_share * config.shares_outstanding : null, valuation.perShare?.intrinsic_ddm_per_share, "Gordon DDM; requires stable dividend payout"],
        ["AEG (Ohlson-Juettner)", valuation.aeg?.V_AEG, valuation.perShare?.intrinsic_aeg_per_share, "OJ (2005) abnormal earnings growth model"],
      ];

  models.forEach(([name, equity, perShare, note]) => {
    setCell(ws, row, 0, cell(name, LABEL_BOLD));
    setCell(ws, row, 1, cell(equity ?? null, equity != null ? GREEN_FILL : LABEL));
    setCell(ws, row, 2, cell(perShare ?? null, perShare != null ? NUM_2DP : LABEL));
    setCell(ws, row, 3, cell(note, { font: { sz: 8 } }));
    row++;
  });

  row++;
  row++;
  if (valuationBlocked) {
    setCell(ws, row, 0, cell("VALUATION SENSITIVITY AND REVERSE DCF", HEADER_BLUE));
    row++;
    setCell(ws, row, 0, cell("Guarded mode", LABEL_BOLD));
    setCell(ws, row, 1, cell("Sensitivity grids and reverse DCF are suppressed until the valuation anchor is clean enough for terminal-value work.", { font: { sz: 8 }, alignment: { wrapText: true } }));
  } else {
    setCell(ws, row, 0, cell("SENSITIVITY TABLE — V_RE_CV3 vs ke × g", HEADER_BLUE));
    row++;

    const kes = [0.08, 0.10, 0.12, 0.14];
    const gs = [0.02, 0.03, 0.04, 0.05, 0.06];
    setCell(ws, row, 0, cell("ke \\ g →", SUBHEADER));
    gs.forEach((g, c) => setCell(ws, row, c + 1, cell(`${(g * 100).toFixed(0)}%`, SUBHEADER)));
    row++;

    kes.forEach(ke => {
      setCell(ws, row, 0, cell(`ke = ${(ke * 100).toFixed(0)}%`, LABEL_BOLD));
      gs.forEach((g, c) => {
        if (ke - g > 0.001 && valuation.pvRE != null) {
          const cv = (valuation.reSeries.length ? valuation.reSeries[valuation.reSeries.length - 1]!.RE : 0) * (1 + g) / (ke - g);
          const T = valuation.reSeries.length;
          const disc = Math.pow(1 + ke, T);
          const v = valuation.CSE0 + valuation.pvRE + cv / disc;
          const isBase = Math.abs(ke - valuation.ke) < 0.001 && Math.abs(g - valuation.g) < 0.001;
          setCell(ws, row, c + 1, cell(v, isBase ? { ...GREEN_FILL, font: { bold: true, sz: 9 } } : NUM_INR));
        } else {
          setCell(ws, row, c + 1, cell("N/A", LABEL));
        }
      });
      row++;
    });

    if (valuation.perShare?.implied_growth_rate != null) {
      row++;
      setCell(ws, row, 0, cell("Reverse DCF — Implied Growth Rate (RE vs Market Price)", LABEL_BOLD));
      setCell(ws, row, 1, cell(valuation.perShare.implied_growth_rate, { ...AMBER_FILL, numFmt: "0.0%" }));
      row++;
      setCell(ws, row, 0, cell("Margin of Safety (RE-CV3 vs Market Price)", LABEL_BOLD));
      setCell(ws, row, 1, cell(valuation.perShare.margin_of_safety_re, { numFmt: "0.0%", font: { sz: 9 } }));
    }
  }

  ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 50 }];
  updateRef(ws);
  return ws;
}

// ── Sheet 6: Quality Scores ────────────────────────────────────────────────────
export function buildQualitySheet(recastData: RecastPeriod[]): WorkSheet {
  const ws: WorkSheet = {};
  const periods = recastData.map(p => p.period_end.slice(0, 7));
  let row = 0;

  setCell(ws, row, 0, cell("EARNINGS & ACCOUNTING QUALITY SCORES", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  row += 2;

  const qRows: [string, (p: RecastPeriod) => number | null | boolean | undefined, string][] = [
    ["PIOTROSKI F-SCORE (0–9; ≥ 7 = strong)", p => p.quality?.piotroski_total ?? null, "Total F-Score"],
    ["  — ROA > 0", p => p.quality?.piotroski_roa, ""],
    ["  — ΔROA > 0", p => p.quality?.piotroski_delta_roa, ""],
    ["  — CFO > 0", p => p.quality?.piotroski_cfo, ""],
    ["  — Accrual quality", p => p.quality?.piotroski_accrual, ""],
    ["  — Leverage ↓", p => p.quality?.piotroski_leverage, ""],
    ["  — Liquidity ↑", p => p.quality?.piotroski_liquidity, ""],
    ["  — No dilution", p => p.quality?.piotroski_dilution, ""],
    ["  — Gross margin ↑", p => p.quality?.piotroski_margin, ""],
    ["  — Asset turnover ↑", p => p.quality?.piotroski_turnover, ""],
    ["BENEISH M-SCORE (< −1.78 = low manipulation risk)", p => p.quality?.beneish_mscore ?? null, ""],
    ["ALTMAN Z'-SCORE (> 2.9 = safe; < 1.23 = distress)", p => p.quality?.altman_zprime ?? null, ""],
    ["ZMIJEWSKI X-SCORE (< 0 = low distress risk)", p => p.quality?.zmijewski_xscore ?? null, ""],
    ["  — P(Distress) Zmijewski", p => p.quality?.zmijewski_prob_distress ?? null, ""],
    ["OHLSON O-SCORE (< 0 = low distress risk)", p => p.quality?.ohlson_oscore ?? null, ""],
    ["  — P(Distress) Ohlson", p => p.quality?.ohlson_prob_distress ?? null, ""],
    ["SLOAN ACCRUALS — Total", p => p.quality?.sloan_total_accruals ?? null, ""],
    ["  — WC Accruals", p => p.quality?.sloan_wc_accruals ?? null, ""],
    ["  — LT Accruals", p => p.quality?.sloan_lt_accruals ?? null, ""],
    ["Accrual Reliability (0=low, 1=high)", p => p.quality?.accrual_reliability_score ?? null, ""],
    ["Cash Earnings Quality Index (CEQI = CFO/PAT)", p => p.quality?.cash_earnings_quality_index ?? null, ""],
    ["Operating Leverage (DOL)", p => p.quality?.operating_leverage ?? null, ""],
  ];

  const pctFields = new Set(["P(Distress) Zmijewski", "P(Distress) Ohlson", "Accrual Reliability"]);
  const bigFonts = new Set(["PIOTROSKI", "BENEISH", "ALTMAN", "ZMIJEWSKI", "OHLSON", "SLOAN"]);

  for (const [label, fn] of qRows) {
    const isBig = [...bigFonts].some(s => label.toUpperCase().startsWith(s));
    setCell(ws, row, 0, cell(label, isBig ? LABEL_BOLD : LABEL));
    recastData.forEach((p, c) => {
      const v = fn(p);
      const numV = typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null);
      const style = pctFields.has(label.replace("  — ", "")) ? NUM_PCT : NUM_2DP;
      setCell(ws, row, c + 1, cell(numV, style));
    });
    row++;
  }

  ws["!cols"] = [{ wch: 48 }, ...recastData.map(() => ({ wch: 13 }))];
  updateRef(ws);
  return ws;
}
