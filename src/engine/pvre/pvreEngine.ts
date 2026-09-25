/**
 * PVRE engine (Milestone A).
 *
 * Given the command-center base scenario plus the latest recast period, re-run
 * the SAME valuation the base card used — buildScenario →
 * buildValuationPeriodsFromForecast → computeValuation — but with the point
 * drivers replaced by samples from explicit distributions.
 *
 * Why a sidecar and not a new model: the valuation math is already correct and
 * tested; what was missing is uncertainty around the inputs. We re-run the
 * existing engine rather than re-implement it, so PVRE can never disagree with
 * the base valuation except via its sampled inputs.
 */
import { buildScenario, buildValuationPeriodsFromForecast } from "../forecastingEngine/scenarios";
import { computeValuation } from "../PenmanNissimEngine";
import type { ForecastScenario } from "../types/forecast";
import type { RecastPeriod } from "../types";
import type { EngineConfig } from "../types";
import type { ValuationScenarioCard } from "../valuationCommandCenter/types";
import { mulberry32, quantileSummary, sampleDrivers } from "./sampler";
import { trace } from "../../lib/traceLogger";
import type {
  DistributionSpec,
  PvreCrossModelDisagreement,
  PvreDriverDistributions,
  PvreModelDistribution,
  PvreOutput,
  PvreResult,
  PvreSample,
} from "./types";

export interface PvreRunInput {
  readonly latest: RecastPeriod;
  readonly baseScenario: ValuationScenarioCard;
  readonly config: EngineConfig;
  /** Optional richer config used for computeValuation inside the loop. When
   * present this should be the share-basis-resolved valuation config (with
   * shares_outstanding etc.) — the exact thing the command center passes into
   * its own computeValuation call. If absent, falls back to `config`. */
  readonly scenarioConfig?: EngineConfig | undefined;
  readonly seed: number;
  readonly iterations: number;
  readonly marketPrice: number | null;
  /** Safety guardrails: clamp sampled drivers to keep every run economically sane. */
  readonly bounds: {
    readonly keMin: number;
    readonly keMax: number;
    /** Floor only: kw is derived from the clamped ke, so ke's band bounds it. */
    readonly kwMin: number;
    readonly gTerminalMin: number;
    readonly gTerminalMax: number;
    readonly salesGrowthMin: number;
    readonly salesGrowthMax: number;
    readonly corePmMin: number;
    readonly corePmMax: number;
  };
}

const DEFAULT_SIGMA = {
  keSd: 0.015, // ~150bps around ke
  gSd: 0.005, // terminal growth is a policy band, keep tight
  salesGrowthSdRel: 0.5, // 50% of point estimate as sd, floored
  corePmSdRel: 0.25,
} as const;

export const PVRE_DEFAULT_BOUNDS: PvreRunInput["bounds"] = {
  keMin: 0.05,
  keMax: 0.25,
  kwMin: 0.03,
  gTerminalMin: -0.02,
  gTerminalMax: 0.08,
  salesGrowthMin: -0.3,
  salesGrowthMax: 0.6,
  corePmMin: -0.4,
  corePmMax: 0.8,
};

/** Build distributions centered on the base-scenario point values. These are
 * the inputs — replacing them with calibrated per-company distributions is a
 * later milestone; the mechanism (not the params) is what's delivered here. */
export function buildDefaultDriverDistributions(
  base: ValuationScenarioCard,
): PvreDriverDistributions {
  const a = base.assumptions;
  const normal = (mean: number, sd: number): DistributionSpec => ({
    family: "normal",
    parameters: { mean, sd: Math.max(sd, 1e-6) },
  });
  return {
    ke: normal(a.ke, DEFAULT_SIGMA.keSd),
    gTerminal: normal(a.g, DEFAULT_SIGMA.gSd),
    salesGrowthYear1: normal(
      a.salesGrowthYear1,
      Math.max(Math.abs(a.salesGrowthYear1) * DEFAULT_SIGMA.salesGrowthSdRel, 0.02),
    ),
    corePmYear1: normal(
      a.corePmYear1,
      Math.max(Math.abs(a.corePmYear1) * DEFAULT_SIGMA.corePmSdRel, 0.01),
    ),
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function scenarioDraws(scenario: ForecastScenario, draws: {
  ke: number;
  kw: number;
  gTerminal: number;
  salesGrowthYear1: number;
  corePmYear1: number;
}): ForecastScenario {
  const d = scenario.drivers;
  const replaceYear1 = (arr: readonly number[] | undefined, v: number): number[] => {
    const xs = (arr ?? [v]).slice();
    if (xs.length === 0) xs.push(v);
    else xs[0] = v;
    return xs as number[];
  };
  return {
    ...scenario,
    drivers: {
      ...d,
      ke: draws.ke,
      kw: draws.kw,
      g_terminal: draws.gTerminal,
      sales_growth: replaceYear1(d.sales_growth, draws.salesGrowthYear1),
      core_sales_pm: replaceYear1(d.core_sales_pm, draws.corePmYear1),
    },
  };
}

function evaluateOneDraw(
  input: PvreRunInput,
  draws: Parameters<typeof scenarioDraws>[1],
): { intrinsicPerShare: number | null; modelValues: Record<string, number | null> } {
  const base = input.baseScenario;
  const sampled = scenarioDraws(base.scenario, draws);
  const periods = buildScenario(sampled, input.latest);
  const valuationPeriods = buildValuationPeriodsFromForecast(input.latest, periods);
  const valuation = computeValuation(
    valuationPeriods,
    draws.ke,
    draws.kw,
    draws.gTerminal,
    // The command center passes shareBasis.valuationConfig into this call so
    // perShare.* is populated. Mirror that here: inherit the base scenario's
    // own config (which for the base scenario does resolve share basis) via a
    // scenarioConfig passthrough the caller wires in.
    input.scenarioConfig ?? input.config,
  );
  const re = valuation.perShare?.intrinsic_re_per_share ?? null;
  const reoi = valuation.perShare?.intrinsic_reoi_per_share ?? null;
  const vals = [re, reoi].filter((v): v is number => v != null && Number.isFinite(v));
  const intrinsic = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  return {
    intrinsicPerShare: intrinsic,
    modelValues: {
      "residual-income": re,
      "residual-operating-income": reoi,
    },
  };
}

/**
 * kw for a draw: the base kw moved by the equity weight times the ke shock.
 * From kw = ke·(CSE+MI)/NOA + kd·NFO/NOA (deriveKwFromStructure), dkw/dke is
 * the equity weight; kd is held at its base. Net-cash firms have a weight
 * above 1, so their kw moves MORE than ke — as the structural formula says.
 */
export function structuralKwForKe(ke: number, base: { ke: number; kw: number }, latest: RecastPeriod): number {
  const noa = Math.abs(latest.bs.NOA);
  const equityWeight = noa > 0 ? (latest.bs.CSE + (latest.bs.MI ?? 0)) / noa : 1;
  const weight = Number.isFinite(equityWeight) ? clamp(equityWeight, 0, 3) : 1;
  return base.kw + weight * (ke - base.ke);
}

function relativeGap(a: number, b: number): number | null {
  const scale = (Math.abs(a) + Math.abs(b)) / 2;
  return scale > 0 ? Math.abs(a - b) / scale : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function disagreementGate(disagreementRatio: number | null): PvreCrossModelDisagreement["gate"] {
  if (disagreementRatio == null) return "guarded";
  // RE and ReOI value the same forecast; beyond a few percent the gap is a
  // recast or discount-rate inconsistency, not a matter of opinion.
  if (disagreementRatio > 0.25) return "blocked";
  if (disagreementRatio > 0.10) return "guarded";
  return "pass";
}

export function runPvre(input: PvreRunInput): PvreResult {
  const t0 = performance.now();
  trace("valuation", "pvre:start", {
    seed: input.seed,
    iterations: input.iterations,
    companyType: input.config.company_type ?? null,
  });
  if (!Number.isFinite(input.seed) || input.iterations < 40) {
    trace("valuation", "pvre:skip", { reason: "bad-seed-or-iterations" }, null, { level: "warn" });
    return { status: "skipped", reason: "seed must be finite and iterations >= 40" };
  }
  const rng = mulberry32(input.seed);
  const dists = buildDefaultDriverDistributions(input.baseScenario);
  const samples: PvreSample[] = [];
  const baseRates = { ke: input.baseScenario.assumptions.ke, kw: input.baseScenario.assumptions.kw };
  for (let i = 0; i < input.iterations; i++) {
    const draws = sampleDrivers(dists, rng);
    const ke = clamp(draws.ke, input.bounds.keMin, input.bounds.keMax);
    const safe = {
      ke,
      // kw is affine in the (already clamped) ke, so the ke band bounds it.
      // Only the floor applies: a fixed 0.20 kw ceiling used to clamp
      // EVERY draw below a base case whose structural kw is higher (ITC's is
      // ~0.30), so PVRE never valued the scenario the base card valued.
      kw: Math.max(structuralKwForKe(ke, baseRates, input.latest), input.bounds.kwMin),
      gTerminal: clamp(draws.gTerminal, input.bounds.gTerminalMin, input.bounds.gTerminalMax),
      salesGrowthYear1: clamp(draws.salesGrowthYear1, input.bounds.salesGrowthMin, input.bounds.salesGrowthMax),
      corePmYear1: clamp(draws.corePmYear1, input.bounds.corePmMin, input.bounds.corePmMax),
    };
    // never allow terminal growth to meet/exceed the discount rate
    const gTerminal = Math.min(safe.gTerminal, Math.min(safe.ke, safe.kw) - 0.005);
    const evald = evaluateOneDraw(input, { ...safe, gTerminal });
    samples.push({ index: i, draws: { ...safe, gTerminal }, ...evald });
  }

  const intrinsicVals = samples
    .map((s) => s.intrinsicPerShare)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const intrinsic = quantileSummary(intrinsicVals);

  const modelNames = ["residual-income", "residual-operating-income"] as const;
  const perModel: PvreModelDistribution[] = modelNames.map((name) => {
    const vals = samples
      .map((s) => s.modelValues[name] ?? null)
      .filter((v): v is number => v != null && Number.isFinite(v));
    return {
      model: name,
      summary: quantileSummary(vals),
      finiteShare: samples.length ? vals.length / samples.length : 0,
    };
  });
  const contributing = perModel.filter((m) => m.finiteShare > 0.5).map((m) => m.model);

  // Disagreement is measured WITHIN each draw — both models on the same
  // assumptions — then summarized across draws.
  const perDrawGaps = samples
    .map((sample) => {
      const re = sample.modelValues["residual-income"];
      const reoi = sample.modelValues["residual-operating-income"];
      return re != null && reoi != null && Number.isFinite(re) && Number.isFinite(reoi) ? relativeGap(re, reoi) : null;
    })
    .filter((gap): gap is number => gap != null);
  const disagreementRatio = contributing.length >= 2 ? median(perDrawGaps) : null;
  const disagreement: PvreCrossModelDisagreement = {
    disagreementRatio,
    contributingModels: contributing,
    gate: disagreementGate(disagreementRatio),
    reason: contributing.length < 2
      ? "fewer than two models computed on a majority of draws"
      : `median |V_RE − V_ReOI| / mean across ${perDrawGaps.length} draws on identical assumptions`,
  };
  const uncertaintyWidthRatio = intrinsic && intrinsic.q50 !== 0
    ? (intrinsic.q95 - intrinsic.q05) / Math.abs(intrinsic.q50)
    : null;

  const p = input.marketPrice;
  const probabilityUndervalued =
    p != null && p > 0 && intrinsicVals.length >= 10
      ? intrinsicVals.filter((v) => v > p).length / intrinsicVals.length
      : null;

  const output: PvreOutput = {
    status: "ok",
    seed: input.seed,
    iterations: input.iterations,
    intrinsic,
    perModel,
    disagreement,
    probabilityUndervalued,
    uncertaintyWidthRatio,
    referencePrice: p ?? null,
    meta: {
      // kw is derived per draw from ke (structuralKwForKe), not sampled.
      sampledKeys: ["ke", "gTerminal", "salesGrowthYear1", "corePmYear1"],
      constrainedTo: "configured-ranges-and-bands",
      companiesType: input.config.company_type ?? null,
    },
  };
  trace(
    "valuation",
    "pvre:complete",
    { seed: input.seed, iterations: input.iterations },
    {
      intrinsicMedian: output.intrinsic?.q50 ?? null,
      intrinsicQ05: output.intrinsic?.q05 ?? null,
      intrinsicQ95: output.intrinsic?.q95 ?? null,
      disagreementGate: output.disagreement?.gate ?? null,
      disagreementRatio: output.disagreement?.disagreementRatio ?? null,
      uncertaintyWidthRatio: output.uncertaintyWidthRatio,
      probabilityUndervalued: output.probabilityUndervalued,
    },
    { duration_ms: Math.round(performance.now() - t0) },
  );
  return output;
}
