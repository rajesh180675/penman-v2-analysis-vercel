/* ================================================================
   v3Analytics decomposition — §15 Auto-Generated Trigger Templates.

   Lifted verbatim from src/engine/v3Analytics.ts. Imports DOWN only:
   RecastPeriod from ../types/recast, EngineConfig from ../types/config,
   event helpers from ./eventFraming, the CanonicalOutputRegistry type
   from ./shared, and numeric helpers from ./mathUtils. No back-edge to
   the parent. v3Analytics.ts re-exports the public surface, leaving
   external import paths (supplementaryPathA.spec) unchanged.
   Behaviour byte-for-byte identical.
================================================================ */

import type { RecastPeriod } from "../types/recast";
import type { EngineConfig } from "../types/config";
import {
  hasCriticalTerminalFlag,
  type PeriodEventFlags,
  type TriggerCalibrationResult,
} from "./eventFraming";
import type { CanonicalOutputRegistry } from "./shared";
import { medianOf, pctStr } from "./mathUtils";

export interface MonitoringTrigger {
  id: string;
  title: string;
  body: string;
}
export function calibrateMonitoringTriggers(
  periods: RecastPeriod[],
  periodFlags: PeriodEventFlags[],
  registry?: CanonicalOutputRegistry | undefined,
  config?: EngineConfig | undefined
): TriggerCalibrationResult {
  const latest = periods[periods.length - 1];
  const cleanPeriod = [...periods].reverse().find((p) => {
    const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
    const hasCritical = hasCriticalTerminalFlag(flags);
    const hasPmOutlier = flags.includes("PM_OUTLIER_CRITICAL") || flags.includes("PM_OUTLIER_WARNING");
    return !hasCritical && !hasPmOutlier && p.ratios?.PM != null;
  });
  const fallbackPms = periods
    .filter((p) => {
      const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
      return !hasCriticalTerminalFlag(flags) && p.ratios?.PM != null;
    })
    .map((p) => p.ratios?.PM as number);
  const pm_base = cleanPeriod?.ratios?.PM
    ?? (fallbackPms.length ? (medianOf(fallbackPms) ?? latest.ratios?.PM ?? 0) : latest.ratios?.PM ?? 0);
  const pm_base_source = cleanPeriod
    ? `${cleanPeriod.period_end.slice(0, 4)} (most recent clean period)`
    : "median of unflagged periods";
  const pm_warning = pm_base * 0.85;
  const pm_critical = pm_base * 0.7;
  const rnoaBase = [...periods].reverse().find((p) => {
    const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
    return !hasCriticalTerminalFlag(flags) && !p.ratios?.noaSmall && p.ratios?.RNOA != null;
  })?.ratios?.RNOA ?? (medianOf(periods.map((p) => p.ratios?.RNOA ?? null).filter((v): v is number => v != null)) ?? 0);
  const ke = config?.ke ?? 0.13;
  const rnoa_threshold = Math.max(ke + 0.05, rnoaBase * 0.5);
  const reBase = [...periods].reverse().find((p) => {
    const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
    return !hasCriticalTerminalFlag(flags) && p.ri?.RE != null;
  })?.ri?.RE ?? (medianOf(periods.map((p) => p.ri?.RE ?? null).filter((v): v is number => v != null)) ?? 0);
  const re_threshold = Math.max(ke * (latest.bs.CSE || 0) * 0.05, reBase * 0.5);
  const div_gap = latest.cf.DividendPaid - latest.cf.FCF_cash;
  const fa_runway = div_gap > 0 && latest.bs.FA > 0 ? latest.bs.FA / div_gap : null;
  const cleanREs = periods
    .filter((p) => {
      const flags = periodFlags.find((f) => f.period_end === p.period_end)?.flags ?? [];
      return !hasCriticalTerminalFlag(flags) && p.ri?.RE != null;
    })
    .map((p) => ({ period_end: p.period_end, RE: p.ri?.RE as number }));
  let consecutive_re_declines = 0;
  let streak = 0;
  let re_peak: number | null = null;
  let re_peak_year: number | null = null;
  for (let i = 1; i < cleanREs.length; i++) {
    if (cleanREs[i].RE < cleanREs[i - 1].RE) {
      streak += 1;
      consecutive_re_declines = Math.max(consecutive_re_declines, streak);
    } else streak = 0;
    if (re_peak == null || cleanREs[i].RE > re_peak) {
      re_peak = cleanREs[i].RE;
      re_peak_year = Number.parseInt(cleanREs[i].period_end.slice(0, 4), 10);
    }
  }
  registry?.register("pm_calibration_base", pm_base, "S-14.2");
  registry?.register("pm_calibration_source", pm_base_source, "S-14.2");
  registry?.register("pm_warning_threshold", pm_warning, "S-14.2");
  registry?.register("pm_critical_threshold", pm_critical, "S-14.2");
  registry?.register("rnoa_threshold", rnoa_threshold, "S-14.2");
  registry?.register("re_threshold", re_threshold, "S-14.2");
  return {
    pm_base,
    pm_base_source,
    pm_warning,
    pm_critical,
    rnoa_threshold,
    re_threshold,
    div_gap,
    fa_runway,
    consecutive_re_declines,
    re_peak,
    re_peak_year,
  };
}
export function generateMonitoringTriggers(
  periods: RecastPeriod[],
  companyId: string,
  ke: number,
  periodFlags: PeriodEventFlags[],
  _registry?: CanonicalOutputRegistry | undefined,
  config?: EngineConfig | undefined
): MonitoringTrigger[] {
  const latest = periods[periods.length - 1];
  // S-14.2: Do NOT pass registry here — calibrateMonitoringTriggers was already called
  // with registry in computeV3Analytics. Passing it again causes double registration.
  const c = calibrateMonitoringTriggers(periods, periodFlags, undefined, { ...(config ?? {}), ke } as EngineConfig);
  const triggers: MonitoringTrigger[] = [];
  triggers.push({
    id: "TRIGGER_PM",
    title: `${companyId}-specific trigger — PM path`,
    body: `PM is currently ${pctStr(latest.ratios?.PM)}. Calibration base: ${pctStr(c.pm_base)} (${c.pm_base_source}). If PM falls below ${pctStr(c.pm_warning)}, re-underwrite with ke stress and steeper fade; below ${pctStr(c.pm_critical)}, valuation approaches lower sensitivity bounds.`,
  });
  if (c.div_gap > 0 && c.fa_runway != null) {
    triggers.push({
      id: "TRIGGER_DIVIDEND",
      title: `${companyId}-specific trigger — dividend sustainability`,
      body: `Dividend vs cash FCF gap is ₹${c.div_gap.toFixed(0)} Cr (FA runway ~${c.fa_runway.toFixed(1)} years at current gap).`,
    });
  } else {
    triggers.push({
      id: "TRIGGER_DIVIDEND",
      title: `${companyId}-specific trigger — dividend sustainability`,
      body: `Cash FCF covers dividend with ₹${Math.abs(c.div_gap).toFixed(0)} Cr surplus.`,
    });
  }
  triggers.push({
    id: "TRIGGER_RNOA",
    title: `${companyId}-specific trigger — RNOA floor`,
    body: `RNOA warning threshold: ${pctStr(c.rnoa_threshold)} (calibrated to clean-period base).`,
  });
  triggers.push({
    id: "TRIGGER_RE",
    title: `${companyId}-specific trigger — RE trajectory`,
    body: `RE warning threshold: ₹${c.re_threshold.toFixed(0)} Cr. Clean-period decline streak: ${c.consecutive_re_declines}.`,
  });
  return triggers;
}
