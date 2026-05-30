import { RecastPeriod, SpecFlag, Severity, EngineConfig } from "../types";
import { medianOf, madStddev, flag } from "./shared";

/* ── S-5.1 Dirty Surplus Spike ──────────────────────────────────── */

export interface DirtySurplusResult {
  period_end        : string;
  DS_t              : number;
  ΔCSE              : number;
  CNI_t             : number;
  DividendsPaid     : number;
  DS_pct_CSE        : number;
  flags             : SpecFlag[];
}

export function detectDirtySurplusPerPeriod(
  periods: RecastPeriod[],
  cfg: EngineConfig
): DirtySurplusResult[] {
  const warn_pct  = cfg.DS_warning_pct  ?? 0.05;
  const crit_pct  = cfg.DS_critical_pct ?? 0.10;
  const results: DirtySurplusResult[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur  = periods[i]!;
    const prev = periods[i - 1]!;

    const CSE_t  = cur.bs.CSE;
    const CSE_t1 = prev.bs.CSE;
    const CNI_t  = cur.is.CNI;
    const div    = cur.cf.DividendPaid;

    const ΔCSE   = CSE_t - CSE_t1;
    const DS_t   = ΔCSE - CNI_t + div;
    const abs_DS = Math.abs(DS_t);
    const DS_pct = Math.max(Math.abs(CSE_t1), 1) > 0 ? abs_DS / Math.max(Math.abs(CSE_t1), 1) : 0;

    const threshold_warn = Math.max(
      warn_pct * Math.abs(CSE_t1),
      warn_pct * 0.6 * Math.max(prev.bs.TA, 1)
    );
    const threshold_crit = Math.max(
      crit_pct * Math.abs(CSE_t1),
      crit_pct * 0.6 * Math.max(prev.bs.TA, 1)
    );

    const flags: SpecFlag[] = [];

    if (abs_DS > threshold_crit) {
      flags.push(flag(
        "S-5.1", Severity.CRITICAL, "STRUCTURAL_EVENT",
        `Dirty surplus = ₹${DS_t.toFixed(0)} Cr (${(DS_pct * 100).toFixed(1)}% of CSE). ` +
        `Typically indicates a demerger, buyback, scheme of arrangement, or Ind AS ` +
        `transition adjustment. Period should not anchor terminal value without review.`,
        true, cur.period_end
      ));
    } else if (abs_DS > threshold_warn) {
      flags.push(flag(
        "S-5.1", Severity.WARNING, "CLEAN_SURPLUS_VIOLATED",
        `Dirty surplus = ₹${DS_t.toFixed(0)} Cr (${(DS_pct * 100).toFixed(1)}% of CSE). ` +
        `Likely OCI accumulation, ESOP charges through reserves, or minor equity transaction.`,
        false, cur.period_end
      ));
    }

    results.push({ period_end: cur.period_end, DS_t, ΔCSE, CNI_t, DividendsPaid: div, DS_pct_CSE: DS_pct, flags });
  }
  return results;
}

/* ── S-5.2 Dividend Discrepancy Gate ────────────────────────────── */

export function detectDividendDiscrepancy(
  periods: RecastPeriod[],
  dsSeries: DirtySurplusResult[],
  cfg: EngineConfig
): SpecFlag[] {
  const disc_pct = cfg.div_disc_pct ?? 0.20;
  const warn_pct = cfg.DS_warning_pct ?? 0.05;
  const flags: SpecFlag[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur   = periods[i]!;
    const prev  = periods[i - 1]!;
    const ds    = dsSeries[i - 1]!;
    const disc  = -ds.DS_t; // algebraically disc = −DS
    const abs_d = Math.abs(disc);

    const threshold = Math.max(
      disc_pct * Math.abs(cur.is.CNI),
      warn_pct * Math.abs(prev.bs.CSE)
    );

    if (abs_d > threshold) {
      flags.push(flag(
        "S-5.2", Severity.WARNING, "CAPITAL_TRANSACTION_LIKELY",
        `Dividend discrepancy = ₹${disc.toFixed(0)} Cr ` +
        `(${cur.is.CNI !== 0 ? (disc / cur.is.CNI * 100).toFixed(0) : "∞"}% of CNI). ` +
        `Indicates a capital transaction (demerger, buyback, bonus issue, or equity adjustment) ` +
        `not captured in reported dividends.`,
        true, cur.period_end
      ));
    }
  }
  return flags;
}

/* ── S-5.3 Metric Step-Change Detection ─────────────────────────── */

export interface MetricOutlierResult {
  period_end: string;
  flags: SpecFlag[];
  pm_zscore: number | null;
  rnoa_zscore: number | null;
  roce_zscore: number | null;
  incr_margin: number | null;
}

export function detectMetricStepChanges(
  periods: RecastPeriod[],
  cfg: EngineConfig
): MetricOutlierResult[] {
  const z_warn = cfg.metric_z_warning ?? 2.0;
  const z_crit = cfg.metric_z_critical ?? 3.0;
  const im_upper = cfg.incr_margin_upper ?? 1.00;
  const im_lower = cfg.incr_margin_lower ?? -0.50;

  const pmSeries   = periods.map(p => p.ratios?.PM   ?? null);
  const rnoa_series= periods.map(p => p.ratios?.RNOA  ?? null);
  const roce_series= periods.map(p => p.ratios?.ROCE  ?? null);

  const results: MetricOutlierResult[] = [];

  for (let i = 0; i < periods.length; i++) {
    const cur = periods[i]!;
    const flags: SpecFlag[] = [];
    let pm_z: number|null = null, rnoa_z: number|null = null, roce_z: number|null = null;
    let incr_margin: number|null = null;

    if (i >= 4) {
      // Compute robust z-score using prior periods (excluding current)
      const priorPM   = pmSeries.slice(0, i).filter((v): v is number => v != null && Number.isFinite(v));
      const priorRNOA = rnoa_series.slice(0, i).filter((v): v is number => v != null && Number.isFinite(v) && !(periods[periods.indexOf(periods[i]!)]?.ratios?.noaSmall));
      const priorROCE = roce_series.slice(0, i).filter((v): v is number => v != null && Number.isFinite(v));

      const checkMetric = (
        label: string, val: number|null|undefined,
        prior: number[], specId: string
      ): number | null => {
        if (!prior || prior.length < 4 || val == null) return null;
        const μ = medianOf(prior)!;
        const σ = madStddev(prior);
        const z = (val - μ) / σ;
        if (Math.abs(z) > z_crit) {
          flags.push(flag(specId, Severity.CRITICAL, `${label}_OUTLIER_CRITICAL`,
            `${label} = ${(val * 100).toFixed(1)}% vs median ${(μ * 100).toFixed(1)}% (z = ${z.toFixed(1)}). ` +
            `Exceeds 3σ of historical variability.`,
            true, cur.period_end));
        } else if (Math.abs(z) > z_warn) {
          flags.push(flag(specId, Severity.WARNING, `${label}_OUTLIER_WARNING`,
            `${label} = ${(val * 100).toFixed(1)}% vs median ${(μ * 100).toFixed(1)}% (z = ${z.toFixed(1)}).`,
            false, cur.period_end));
        }
        return z;
      };

      pm_z   = checkMetric("PM",   pmSeries[i],   priorPM,   "S-5.3");
      roce_z = checkMetric("ROCE", roce_series[i], priorROCE, "S-5.3");
      if (!cur.ratios?.noaSmall) {
        rnoa_z = checkMetric("RNOA", rnoa_series[i], priorRNOA, "S-5.3");
      }
    }

    // Incremental margin anomaly
    if (i > 0) {
      const prev = periods[i - 1]!;
      const ΔRev = cur.is.Sales - prev.is.Sales;
      if (ΔRev > 0) {
        const ΔOI = cur.is.OI - prev.is.OI;
        incr_margin = ΔOI / ΔRev;
        if (incr_margin > im_upper || incr_margin < im_lower) {
          flags.push(flag(
            "S-5.3", Severity.CRITICAL, "INCREMENTAL_MARGIN_ANOMALY",
            `Incremental margin = ${(incr_margin * 100).toFixed(0)}% ` +
            `(ΔOI ₹${ΔOI.toFixed(0)} / ΔRev ₹${ΔRev.toFixed(0)}). ` +
            `Values outside [${(im_lower * 100).toFixed(0)}%, ${(im_upper * 100).toFixed(0)}%] ` +
            `suggest one-time income/expense in this period.`,
            true, cur.period_end
          ));
        }
      }
    }

    results.push({ period_end: cur.period_end, flags, pm_zscore: pm_z, rnoa_zscore: rnoa_z, roce_zscore: roce_z, incr_margin });
  }
  return results;
}

/* ── S-5.4 Large Asset/Liability Disappearance ───────────────────── */

export function detectComponentDisappearance(
  periods: RecastPeriod[],
  cfg: EngineConfig
): SpecFlag[] {
  const decline_pct  = cfg.comp_decline_pct ?? 0.15;
  const decline_abs  = cfg.comp_decline_abs_pct ?? 0.02;
  const flags: SpecFlag[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur  = periods[i]!;
    const prev = periods[i - 1]!;
    const TA_prev = Math.max(prev.bs.TA, 1);

    type BSKey = "OA" | "FA" | "OL" | "FO";
    const components: BSKey[] = ["OA", "FA", "OL", "FO"];

    for (const C of components) {
      const prev_val = prev.bs[C];
      const cur_val  = cur.bs[C];
      const ΔC = cur_val - prev_val;
      if (
        ΔC < -(decline_pct * Math.max(prev_val, 1)) &&
        Math.abs(ΔC) > decline_abs * TA_prev
      ) {
        const affects = C === "OA" || C === "FA";
        flags.push(flag(
          "S-5.4", Severity.WARNING, `LARGE_${C}_DECLINE`,
          `Δ${C} = ₹${ΔC.toFixed(0)} Cr (${((ΔC / Math.max(prev_val, 1)) * 100).toFixed(0)}% of prior). ` +
          `Possible divestiture, impairment, or reclassification.`,
          affects, cur.period_end
        ));
      }
    }

    // Sub-component level (OA decomposition)
    const subComponents: Array<{key: keyof RecastPeriod["bs"]; label: string}> = [
      { key: "OA_PPE",           label: "PPE" },
      { key: "OA_Inventory",     label: "Inventory" },
      { key: "OA_TradeReceivables", label: "TradeReceivables" },
      { key: "OA_Goodwill",      label: "Goodwill" },
      { key: "OA_Other",         label: "OtherOA" },
    ];

    for (const { key, label } of subComponents) {
      const prev_val = prev.bs[key] ?? 0;
      const cur_val  = cur.bs[key] ?? 0;
      const Δsub = cur_val - prev_val;
      if (
        Δsub < -(decline_pct * Math.max(prev_val, 1)) &&
        Math.abs(Δsub) > decline_abs * TA_prev
      ) {
        flags.push(flag(
          "S-5.4", Severity.WARNING, `LARGE_${label}_DECLINE`,
          `Δ${label} = ₹${Δsub.toFixed(0)} Cr. May indicate asset disposal or demerger of a business segment.`,
          true, cur.period_end
        ));
      }
    }
  }
  return flags;
}

/* ── S-5.5 Reclassification Detection ───────────────────────────── */

export function detectReclassification(
  periods: RecastPeriod[],
  cfg: EngineConfig
): SpecFlag[] {
  const reclassif_pct = cfg.reclassif_pct ?? 0.10;
  const flags: SpecFlag[] = [];

  for (let i = 1; i < periods.length; i++) {
    const cur  = periods[i]!;
    const prev = periods[i - 1]!;

    const ΔOA = cur.bs.OA - prev.bs.OA;
    const ΔFA = cur.bs.FA - prev.bs.FA;

    const oppDirection = Math.sign(ΔOA) !== Math.sign(ΔFA) && ΔOA !== 0 && ΔFA !== 0;
    const bigOA = Math.abs(ΔOA) > reclassif_pct * Math.max(prev.bs.OA, 1);
    const bigFA = Math.abs(ΔFA) > reclassif_pct * Math.max(prev.bs.FA, 1);

    if (oppDirection && bigOA && bigFA) {
      const dateStr = cur.period_end.slice(0, 10);
      const indASWindow = dateStr >= "2016-03-31" && dateStr <= "2018-03-31";
      flags.push(flag(
        "S-5.5", Severity.CRITICAL, "POTENTIAL_RECLASSIFICATION",
        `₹${Math.min(Math.abs(ΔOA), Math.abs(ΔFA)).toFixed(0)} Cr appears to have moved between OA and FA ` +
        `(ΔOA = ₹${ΔOA.toFixed(0)}, ΔFA = ₹${ΔFA.toFixed(0)}). ` +
        `May reflect an accounting standard transition (Ind AS), reclassification of investments, or demerger. ` +
        `Ratios using NOA as denominator may not be comparable across this boundary.` +
        (indASWindow ? " Period falls within the typical Ind AS transition window (FY2016–2018)." : ""),
        true, cur.period_end
      ));
    }
  }
  return flags;
}

/* ── S-5.6 Payout Ratio Anomaly ─────────────────────────────────── */

export function detectPayoutAnomaly(periods: RecastPeriod[]): SpecFlag[] {
  const flags: SpecFlag[] = [];
  for (const p of periods) {
    const cni = p.is.CNI;
    const div = p.cf.DividendPaid;
    if (cni > 0 && div > 1.10 * cni) {
      flags.push(flag(
        "S-5.6", Severity.WARNING, "EXCESS_PAYOUT",
        `Dividend/CNI = ${(div / cni * 100).toFixed(0)}%. ` +
        `Company distributed more than current earnings, drawing on reserves or retained earnings.`,
        false, p.period_end
      ));
    }
    if (cni < 0 && div > 0) {
      flags.push(flag(
        "S-5.6", Severity.WARNING, "DIVIDEND_DESPITE_LOSS",
        `Dividends of ₹${div.toFixed(0)} Cr paid despite negative CNI of ₹${cni.toFixed(0)} Cr.`,
        false, p.period_end
      ));
    }
  }
  return flags;
}
