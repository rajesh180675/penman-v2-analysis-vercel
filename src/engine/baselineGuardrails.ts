import { computeValuation, deriveKwFromStructure } from "./PenmanNissimEngine";
import { EngineConfig, RecastPeriod, ke_from_config } from "./types";

export interface BenchmarkCompany {
  id: string;
  ticker: string;
  name: string;
  sector: string;
}

export const PHASE0_BENCHMARK_SET: BenchmarkCompany[] = [
  { id: "ITC", ticker: "ITC", name: "ITC Ltd", sector: "Staples/Conglomerate" },
  { id: "HINDUNILVR", ticker: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG" },
  { id: "DABUR", ticker: "DABUR", name: "Dabur India", sector: "FMCG" },
  { id: "MARICO", ticker: "MARICO", name: "Marico", sector: "FMCG" },
  { id: "GODREJCP", ticker: "GODREJCP", name: "Godrej Consumer Products", sector: "FMCG" },
  { id: "BRITANNIA", ticker: "BRITANNIA", name: "Britannia Industries", sector: "Food" },
];

export interface ValuationErrorBand {
  valueLow: number;
  valueBase: number;
  valueHigh: number;
  downsidePct: number;
  upsidePct: number;
}

export interface Phase0Guardrails {
  identityGapPct: number;
  otherOAPct: number | null;
  terminalAnchorStabilityPct: number;
  valuationErrorBand: ValuationErrorBand;
}

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function baseInputs(periods: RecastPeriod[], cfg: EngineConfig) {
  const ke = ke_from_config(cfg);
  const cur = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const kw = deriveKwFromStructure(cur, prev, ke, cfg.risk_free_rate, cfg);
  const g = cfg.g_terminal_override ?? 0.04;
  return { ke, kw, g };
}

function valuationBand(periods: RecastPeriod[], cfg: EngineConfig): ValuationErrorBand {
  const { ke, kw, g } = baseInputs(periods, cfg);
  const base = computeValuation(periods, ke, kw, g, cfg).V_RE_CV3;
  const candidates: number[] = [];
  const keShocks = [-0.01, 0, 0.01];
  const gShocks = [-0.01, 0, 0.01];
  for (const dKe of keShocks) {
    for (const dG of gShocks) {
      const keS = Math.max(cfg.risk_free_rate + 0.005, ke + dKe);
      const gS = Math.max(0, Math.min(keS - 0.005, g + dG));
      candidates.push(computeValuation(periods, keS, kw, gS, cfg).V_RE_CV3);
    }
  }
  const valueLow = Math.min(...candidates);
  const valueHigh = Math.max(...candidates);
  return {
    valueLow,
    valueBase: base,
    valueHigh,
    downsidePct: base !== 0 ? (valueLow - base) / Math.abs(base) : 0,
    upsidePct: base !== 0 ? (valueHigh - base) / Math.abs(base) : 0,
  };
}

function terminalAnchorStability(periods: RecastPeriod[], cfg: EngineConfig): number {
  const { ke, kw, g } = baseInputs(periods, cfg);
  const baseVal = computeValuation(periods, ke, kw, g, cfg);
  const reSeries = baseVal.reSeries.map((r) => r.RE);
  if (!reSeries.length) return 0;

  const latestRE = reSeries[reSeries.length - 1];
  const prior = reSeries.slice(-4, -1);
  const medianRE = median(reSeries.slice(-3));

  let growthMed = 0;
  if (prior.length >= 2) {
    const growths: number[] = [];
    for (let i = 1; i < prior.length; i++) {
      const prev = prior[i - 1];
      if (Math.abs(prev) < 1) continue;
      growths.push((prior[i] - prev) / Math.abs(prev));
    }
    growthMed = median(growths);
  }
  const tMinus1 = reSeries.length > 1 ? reSeries[reSeries.length - 2] : latestRE;
  const grown = tMinus1 * (1 + growthMed);

  const anchors = [latestRE, medianRE, grown];
  const vals = anchors.map((a) => computeValuation(periods, ke, kw, g, cfg, a, null).V_RE_CV3);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const denom = Math.max(Math.abs(baseVal.V_RE_CV3), 1);
  return (hi - lo) / denom;
}

export function computePhase0Guardrails(periods: RecastPeriod[], cfg: EngineConfig): Phase0Guardrails | null {
  if (!periods || periods.length < 2) return null;
  const { ke, kw, g } = baseInputs(periods, cfg);
  const val = computeValuation(periods, ke, kw, g, cfg);
  const identityGap = Math.abs(val.V_RE_CV3 - val.V_ReOI_CV03);
  const identityGapPct = val.V_RE_CV3 !== 0 ? identityGap / Math.abs(val.V_RE_CV3) : 0;
  const latest = periods[periods.length - 1];
  const otherOAPct = latest.bs.OA > 0 ? latest.bs.OA_Other / latest.bs.OA : null;

  return {
    identityGapPct,
    otherOAPct,
    terminalAnchorStabilityPct: terminalAnchorStability(periods, cfg),
    valuationErrorBand: valuationBand(periods, cfg),
  };
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export interface Phase0BaselineSnapshot {
  phase: "phase0-week1-baseline";
  benchmarkUniverse: BenchmarkCompany[];
  companyId: string;
  periods: number;
  latestPeriod: string;
  guardrails: Phase0Guardrails;
  configFingerprint: string;
  snapshotId: string;
}

export function buildPhase0BaselineSnapshot(
  companyId: string,
  periods: RecastPeriod[],
  cfg: EngineConfig,
): Phase0BaselineSnapshot | null {
  const guardrails = computePhase0Guardrails(periods, cfg);
  if (!guardrails || !periods.length) return null;
  const cfgFingerprint = simpleHash(stableStringify({
    ke: cfg.ke,
    kd_pretax: cfg.kd_pretax,
    tax_rate_for_kd: cfg.tax_rate_for_kd,
    risk_free_rate: cfg.risk_free_rate,
    equity_risk_premium: cfg.equity_risk_premium,
    statutory_tax_rate: cfg.statutory_tax_rate,
    tax_rate_mode: cfg.tax_rate_mode,
    g_terminal_override: cfg.g_terminal_override ?? null,
  }));
  const payload = {
    phase: "phase0-week1-baseline",
    benchmarkUniverse: PHASE0_BENCHMARK_SET,
    companyId,
    periods: periods.length,
    latestPeriod: periods[periods.length - 1].period_end,
    guardrails,
    configFingerprint: cfgFingerprint,
  } as const;
  const snapshotId = simpleHash(stableStringify(payload));
  return { ...payload, snapshotId };
}
