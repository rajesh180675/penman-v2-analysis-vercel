import { computeRatios, computeValuation } from "./PenmanNissimEngine";
import { runIdentityAssertions } from "./identityTests";
import { CapitalineMappingSpec as M } from "./mappingSpec";
import { buildPhase0BaselineSnapshot, Phase0BaselineSnapshot } from "./baselineGuardrails";
import { EngineConfig, RawPeriodData, RecastPeriod, ke_from_config } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

function pick(data: RawPeriodData, keys: readonly string[], stmt: "BalanceSheet" | "ProfitLoss" | "CashFlow"): number {
  const rv = data.raw_metric_values;
  for (const key of keys) {
    const composite = rv[`${key}__${stmt}`];
    if (composite != null && Number.isFinite(composite)) return composite;
    const base = rv[key];
    if (base != null && Number.isFinite(base)) return base;
    const nk = norm(key);
    let best: number | null = null;
    let pBest = -1;
    for (const [k, v] of Object.entries(rv)) {
      if (v == null || !Number.isFinite(v)) continue;
      const i = k.lastIndexOf("__");
      const baseKey = i >= 0 ? k.slice(0, i) : k;
      const st = i >= 0 ? k.slice(i + 2) : "";
      if (norm(baseKey) !== nk) continue;
      const p = st === stmt ? 10 : st === "BalanceSheet" ? 3 : st === "ProfitLoss" ? 2 : st === "CashFlow" ? 1 : 0;
      if (p > pBest) {
        pBest = p;
        best = v;
      }
    }
    if (best != null) return best;
  }
  return 0;
}

function deriveKw(periods: RecastPeriod[], cfg: EngineConfig): number {
  if (periods.length < 2) return cfg.risk_free_rate;
  const cur = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const ke = ke_from_config(cfg);
  const avgFO = (Math.abs(cur.bs.FO) + Math.abs(prev.bs.FO)) / 2;
  const avgFA = (Math.abs(cur.bs.FA) + Math.abs(prev.bs.FA)) / 2;
  const avgNOA = Math.abs((cur.bs.NOA + prev.bs.NOA) / 2);
  const kdPretax = avgFO > 1 ? Math.max(0, cur.is.FinanceCost / avgFO) : Math.max(cfg.risk_free_rate * 1.1, 0.04);
  const kdAfterTax = kdPretax * (1 - cur.is.taxRate);
  const ki = avgFA > 1 ? Math.max(0, cur.is.FinanceIncome / avgFA) : cfg.risk_free_rate;
  const kwRaw = avgNOA > 1
    ? (ke * Math.abs(cur.bs.CSE) + kdAfterTax * avgFO - ki * avgFA) / avgNOA
    : ke;
  return Math.max(cfg.risk_free_rate, Math.min(ke, kwRaw));
}

function buildLegacyEmulation(raw: RawPeriodData[], after: RecastPeriod[], cfg: EngineConfig): RecastPeriod[] {
  const out: RecastPeriod[] = [];
  for (let i = 0; i < after.length; i++) {
    const p = after[i];
    const r = raw[i];
    if (!r) continue;

    const TA = p.bs.TA;
    const CSE = p.bs.CSE;
    const MI = p.bs.MI;
    const totalLiab = TA - (CSE + MI);

    // Legacy FA overlaps
    const curInv = pick(r, ["Current Investments"], "BalanceSheet") ||
      pick(r, ["Investments Carried at Fair Value Through Profit Or Loss (FVTPL)"], "BalanceSheet");
    const ltDirect = pick(r, ["Investments - Long-term", "Non-current Investments"], "BalanceSheet");
    const totalInv = pick(r, ["Total Investments"], "BalanceSheet");
    const ltLegacy = ltDirect > 0 ? ltDirect : totalInv; // buggy legacy behavior

    const otherFaLt = pick(r, ["Others Financial Assets - Long-term"], "BalanceSheet");
    const otherFaSt = pick(r, ["Others Financial Assets - Short-term"], "BalanceSheet");
    const interestRec = pick(r, ["Total Interest Receivable", "Interest Receivable"], "BalanceSheet");
    const divRec = pick(r, ["Dividend Receivable"], "BalanceSheet");
    const derivRec = pick(r, ["Derivative Receivables / Forward Contract Receivable", "Forward Contract Receivable"], "BalanceSheet");
    const otherFaLegacy = (otherFaLt + otherFaSt) + interestRec + divRec + derivRec; // parent+child double count

    const cashBank = pick(r, M.balanceSheet.financialAssets.cashAndBank, "BalanceSheet");
    const depRes = M.balanceSheet.financialAssets.depositsAndRestricted
      .reduce((s, k) => s + pick(r, [k], "BalanceSheet"), 0);
    const FA_legacy = cashBank + curInv + ltLegacy + depRes + otherFaLegacy;

    // Legacy lease heuristic
    const longBorrow = pick(r, ["Long Term Borrowings"], "BalanceSheet");
    const shortBorrow = pick(r, ["Short Term Borrowings"], "BalanceSheet");
    const lease = pick(r, ["Lease Liabilities"], "BalanceSheet");
    const otherFinLiab = pick(r, ["Others Financial Liabilities - Long-term"], "BalanceSheet") + pick(r, ["Others Financial Liabilities - Short-term"], "BalanceSheet");
    const hybrid = cfg.hybrid_perpetual_as_debt ? pick(r, ["Hybrid Perpetual Securities"], "BalanceSheet") : 0;
    const leaseDropped = lease > 0 && otherFinLiab >= lease ? 0 : lease;
    const FO_legacy = longBorrow + shortBorrow + otherFinLiab + hybrid + leaseDropped;

    const OA_legacy = TA - FA_legacy;
    const OL_legacy = Math.max(0, totalLiab - FO_legacy);
    const NOA_legacy = OA_legacy - OL_legacy;
    const NFO_legacy = FO_legacy - FA_legacy;

    // Legacy finance-income rung 3 gate
    const financeCost = p.is.FinanceCost;
    let fiLegacy = pick(r, M.profitLoss.financeIncomeDirect, "ProfitLoss");
    if (!fiLegacy) {
      fiLegacy = Math.abs(pick(r, ["Interest Received"], "CashFlow")) + Math.abs(pick(r, ["Dividend Received"], "CashFlow"));
    }
    if (!fiLegacy) {
      const intNet = pick(r, ["Interest (Net)"], "CashFlow");
      if (intNet < 0) fiLegacy = Math.max(0, -intNet + financeCost);
    }
    if (!fiLegacy) {
      const oi = pick(r, ["Other Income"], "ProfitLoss");
      const faRatio = TA > 0 ? Math.max(0.2, Math.min(0.85, FA_legacy / TA)) : 0.2;
      fiLegacy = oi * faRatio;
    }
    const nfeLegacy = (financeCost - fiLegacy) * (1 - p.is.taxRate) + p.is.PreferredDividend + p.cu.UFE;

    const TCI = pick(r, ["Total Comprehensive Income for the Year"], "ProfitLoss");
    const CNI = p.is.CNI;
    const OI_legacy = (TCI !== 0
      ? (TCI - p.is.PreferredDividend)
      : (p.is.PAT + p.is.OCI - p.is.PreferredDividend)
    ) + nfeLegacy;
    const MII_legacy = OI_legacy - (CNI + nfeLegacy);

    const clone: RecastPeriod = {
      ...p,
      bs: {
        ...p.bs,
        FA: FA_legacy,
        FO: FO_legacy,
        OA: OA_legacy,
        OL: OL_legacy,
        NOA: NOA_legacy,
        NFO: NFO_legacy,
      },
      is: {
        ...p.is,
        FinanceIncome: fiLegacy,
        NFE: nfeLegacy,
        OI: OI_legacy,
        MII: MII_legacy,
      },
      cf: {
        ...p.cf,
      },
    };
    out.push(clone);
  }

  // Recompute derived parts that depend on prev-year values
  for (let i = 0; i < out.length; i++) {
    if (i > 0) {
      const prev = out[i - 1];
      const cur = out[i];
      const dNOA = cur.bs.NOA - prev.bs.NOA;
      const dNFO = cur.bs.NFO - prev.bs.NFO;
      cur.cf.FCF_accounting = cur.is.OI - dNOA;
      cur.cf.d_t_formula = cur.cf.FCF_accounting - cur.is.NFE + dNFO;
      cur.cf.d_t_discrepancy = cur.cf.d_t - cur.cf.d_t_formula;
      cur.ratios = computeRatios(cur, prev, cfg);
    }
  }

  return out;
}

export interface RegressionHarnessReport {
  latestPeriod: string;
  ratioDelta: {
    ROCE_before: number | null;
    ROCE_after: number | null;
    RNOA_before: number | null;
    RNOA_after: number | null;
    NBC_before: number | null;
    NBC_after: number | null;
  };
  identityPass: {
    before: { passed: number; total: number; rate: number };
    after: { passed: number; total: number; rate: number };
    byAssertion: Record<string, { beforePass: number; beforeTotal: number; afterPass: number; afterTotal: number }>;
  };
  valuationDelta: {
    ke: number;
    kw_before: number;
    kw_after: number;
    V_RE_CV3_before: number;
    V_RE_CV3_after: number;
    V_ReOI_CV03_before: number;
    V_ReOI_CV03_after: number;
  };
  bugImpactTable: Array<{ bugClass: string; metric: string; before: number; after: number; delta: number }>;
}

export interface Phase0BaselineReport {
  snapshot: Phase0BaselineSnapshot;
  regression: RegressionHarnessReport;
}

export function runRegressionHarness(rawData: RawPeriodData[], afterPeriods: RecastPeriod[], cfg: EngineConfig): RegressionHarnessReport | null {
  if (!rawData.length || afterPeriods.length < 2) return null;
  const rawSorted = [...rawData].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const afterSorted = [...afterPeriods].sort((a, b) => a.period_end.localeCompare(b.period_end));

  const beforePeriods = buildLegacyEmulation(rawSorted, afterSorted, cfg);
  const afterId = runIdentityAssertions(afterSorted);
  const beforeId = runIdentityAssertions(beforePeriods);

  const latestAfter = afterSorted[afterSorted.length - 1];
  const latestBefore = beforePeriods[beforePeriods.length - 1];

  const ke = ke_from_config(cfg);
  const kwAfter = deriveKw(afterSorted, cfg);
  const kwBefore = cfg.risk_free_rate;
  const g = 0.05;
  const vAfter = computeValuation(afterSorted, ke, kwAfter, g, cfg);
  const vBefore = computeValuation(beforePeriods, ke, kwBefore, g, cfg);

  const ids = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
  const byAssertion: RegressionHarnessReport["identityPass"]["byAssertion"] = {};
  for (const id of ids) {
    const bRows = beforeId.results.filter((r) => r.id === id);
    const aRows = afterId.results.filter((r) => r.id === id);
    byAssertion[id] = {
      beforePass: bRows.filter((r) => r.pass).length,
      beforeTotal: bRows.length,
      afterPass: aRows.filter((r) => r.pass).length,
      afterTotal: aRows.length,
    };
  }

  const bugImpactTable = [
    {
      bugClass: "WACC weighting (C1)",
      metric: "V_ReOI_CV03",
      before: computeValuation(afterSorted, ke, kwBefore, g, cfg).V_ReOI_CV03,
      after: vAfter.V_ReOI_CV03,
      delta: vAfter.V_ReOI_CV03 - computeValuation(afterSorted, ke, kwBefore, g, cfg).V_ReOI_CV03,
    },
    {
      bugClass: "Finance-income rung3 gate (C3)",
      metric: "NBC (latest)",
      before: latestBefore.ratios?.NBC ?? 0,
      after: latestAfter.ratios?.NBC ?? 0,
      delta: (latestAfter.ratios?.NBC ?? 0) - (latestBefore.ratios?.NBC ?? 0),
    },
    {
      bugClass: "FA overlap + lease FO heuristic (C6/M1)",
      metric: "RNOA (latest)",
      before: latestBefore.ratios?.RNOA ?? 0,
      after: latestAfter.ratios?.RNOA ?? 0,
      delta: (latestAfter.ratios?.RNOA ?? 0) - (latestBefore.ratios?.RNOA ?? 0),
    },
    {
      bugClass: "Forecast NFO inversion (H6) proxy",
      metric: "V_RE_CV3",
      before: vBefore.V_RE_CV3,
      after: vAfter.V_RE_CV3,
      delta: vAfter.V_RE_CV3 - vBefore.V_RE_CV3,
    },
  ];

  return {
    latestPeriod: latestAfter.period_end,
    ratioDelta: {
      ROCE_before: latestBefore.ratios?.ROCE ?? null,
      ROCE_after: latestAfter.ratios?.ROCE ?? null,
      RNOA_before: latestBefore.ratios?.RNOA ?? null,
      RNOA_after: latestAfter.ratios?.RNOA ?? null,
      NBC_before: latestBefore.ratios?.NBC ?? null,
      NBC_after: latestAfter.ratios?.NBC ?? null,
    },
    identityPass: {
      before: {
        passed: beforeId.passed,
        total: beforeId.total,
        rate: beforeId.total > 0 ? beforeId.passed / beforeId.total : 0,
      },
      after: {
        passed: afterId.passed,
        total: afterId.total,
        rate: afterId.total > 0 ? afterId.passed / afterId.total : 0,
      },
      byAssertion,
    },
    valuationDelta: {
      ke,
      kw_before: kwBefore,
      kw_after: kwAfter,
      V_RE_CV3_before: vBefore.V_RE_CV3,
      V_RE_CV3_after: vAfter.V_RE_CV3,
      V_ReOI_CV03_before: vBefore.V_ReOI_CV03,
      V_ReOI_CV03_after: vAfter.V_ReOI_CV03,
    },
    bugImpactTable,
  };
}

export function runPhase0BaselineReport(
  rawData: RawPeriodData[],
  recastData: RecastPeriod[],
  cfg: EngineConfig,
): Phase0BaselineReport | null {
  if (!rawData?.length || !recastData?.length) return null;
  const regression = runRegressionHarness(rawData, recastData, cfg);
  const snapshot = buildPhase0BaselineSnapshot(rawData[0].company_id, recastData, cfg);
  if (!regression || !snapshot) return null;
  return { snapshot, regression };
}
