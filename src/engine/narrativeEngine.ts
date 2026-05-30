/**
 * Narrative Engine — auto-generates plain-English insight sentences
 * for each tab based on engine output. Business-language, not accounting-language.
 */
import type { RecastPeriod, EngineConfig } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

function mult(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(d)}×`;
}

function inr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function cagr(first: number | null, last: number | null, years: number): number | null {
  if (first == null || last == null || first <= 0 || last <= 0 || years < 2) return null;
  return Math.pow(last / first, 1 / (years - 1)) - 1;
}

function decileLabel(value: number, thresholds: [number, string][]): string {
  for (const [t, label] of thresholds) {
    if (value >= t) return label;
  }
  return thresholds[thresholds.length - 1]?.[1] ?? "";
}

// ─── Dashboard Narrative ─────────────────────────────────────────────────────

export function generateDashboardNarrative(
  data: RecastPeriod[],
  config: EngineConfig,
): string {
  if (!data || data.length < 2) return "";
  const latest = data[data.length - 1]!;
  const r = latest.ratios;
  if (!r) return "";

  const ticker = config.ticker ?? config.quality_data_folder ?? "This company";
  const type = config.company_type ?? "industrial";
  const sentences: string[] = [];

  // ROCE context
  const roce = r.ROCE;
  if (roce != null) {
    const ranking = decileLabel(roce, [
      [0.30, "top decile"],
      [0.20, "top quartile"],
      [0.12, "above median"],
      [0.08, "median"],
      [0, "below median"],
    ]);
    sentences.push(
      `${ticker} earns ${pct(roce)} on equity, placing it in the ${ranking} of Indian ${type === "industrial" ? "industrials" : type + "s"}.`,
    );
  }

  // Driver attribution
  const pm = r.PM;
  const ato = r.ATO;
  if (pm != null && ato != null) {
    let driver: string;
    if (pm > 0.20 && ato > 2.0) driver = "both strong margins and high capital efficiency";
    else if (pm > 0.20) driver = `high margins (${pct(pm, 0)})`;
    else if (ato > 2.0) driver = `high asset turnover (${mult(ato)})`;
    else driver = `balanced margins (${pct(pm, 0)}) and turnover (${mult(ato)})`;
    sentences.push(`Returns are driven by ${driver}.`);
  }

  // Leverage context
  const flev = r.FLEV;
  const spread = r.SPREAD;
  if (flev != null) {
    if (flev < -0.05) {
      const drag = spread != null ? Math.abs(flev * spread) : null;
      sentences.push(
        `The company is net-cash${drag != null ? ` — financial leverage drags ROCE by ${pct(drag, 1)}` : ""}.`,
      );
    } else if (flev > 1.5) {
      sentences.push(`Significant leverage (${mult(flev)}) amplifies operating returns but adds risk.`);
    } else if (flev > 0.5) {
      sentences.push(`Moderate leverage (${mult(flev)}) provides a useful boost to equity returns.`);
    }
  }

  // Revenue growth
  const revGrowth = cagr(data[0]!.is.Sales, latest.is.Sales, data.length);
  if (revGrowth != null) {
    sentences.push(
      `Revenue has compounded at ${pct(revGrowth)} over ${data.length - 1} years.`,
    );
  }

  return sentences.join(" ");
}

// ─── Ratios Narrative ────────────────────────────────────────────────────────

export function generateRatiosNarrative(
  data: RecastPeriod[],
  config: EngineConfig,
): string {
  if (!data || data.length < 2) return "";
  const latest = data[data.length - 1]!;
  const r = latest.ratios;
  if (!r) return "";

  const ticker = config.ticker ?? "This company";
  const sentences: string[] = [];

  const roce = r.ROCE;
  const pm = r.PM;
  const ato = r.ATO;
  const flev = r.FLEV;
  const spread = r.SPREAD;

  if (roce != null && pm != null && ato != null) {
    sentences.push(
      `${ticker} earns ${pct(roce)} on equity. This comes from a ${pct(pm, 0)} profit margin × ${mult(ato)} asset turns`,
    );
    if (flev != null && spread != null) {
      const levEffect = flev * spread;
      if (Math.abs(levEffect) > 0.005) {
        sentences[0] += `, ${levEffect > 0 ? "boosted" : "offset"} by ${Math.abs(levEffect * 100).toFixed(1)}pp from financial leverage.`;
      } else {
        sentences[0] += `. Leverage has negligible impact.`;
      }
    } else {
      sentences[0] += `.`;
    }
  }

  // Trend commentary
  if (data.length >= 5) {
    const fiveYearAgo = data[data.length - 5];
    const roceOld = fiveYearAgo?.ratios?.ROCE;
    if (roce != null && roceOld != null) {
      const delta = roce - roceOld;
      if (Math.abs(delta) > 0.03) {
        sentences.push(
          `Over 5 years, ROCE has ${delta > 0 ? "improved" : "declined"} by ${Math.abs(delta * 100).toFixed(1)}pp${delta < 0 ? " — investigate margin erosion or capital bloat" : ""}.`,
        );
      } else {
        sentences.push(`ROCE has been stable over 5 years (±${Math.abs(delta * 100).toFixed(1)}pp).`);
      }
    }
  }

  return sentences.join(" ");
}

// ─── Quality Narrative ───────────────────────────────────────────────────────

export interface QualityNarrativeInput {
  parserScore: number | null;
  reconciliationPass: boolean;
  ratioSanityPass: boolean;
  mappingCoverage: number | null;
  marketDataFresh: boolean;
  totalChecks: number;
  passedChecks: number;
}

export function generateQualityNarrative(input: QualityNarrativeInput): string {
  const { totalChecks, passedChecks, parserScore, reconciliationPass, marketDataFresh } = input;
  const sentences: string[] = [];

  const ratio = totalChecks > 0 ? passedChecks / totalChecks : 0;
  if (ratio >= 0.9) {
    sentences.push(
      `Data quality is high — ${passedChecks}/${totalChecks} quality gates pass.`,
    );
    sentences.push(`Valuation outputs are reliable for decision-making.`);
  } else if (ratio >= 0.6) {
    sentences.push(
      `Data quality is moderate — ${passedChecks}/${totalChecks} gates pass.`,
    );
    sentences.push(`Valuation outputs should be treated as directional, not precise.`);
  } else {
    sentences.push(
      `Data quality is low — only ${passedChecks}/${totalChecks} gates pass.`,
    );
    sentences.push(`Valuation outputs may be unreliable. Investigate parser or data issues.`);
  }

  if (parserScore != null && parserScore < 80) {
    sentences.push(`Parser fidelity (${parserScore}/100) suggests some data may be incorrectly extracted.`);
  }

  if (!reconciliationPass) {
    sentences.push(`Balance sheet does not reconcile — structural data issue likely.`);
  }

  if (!marketDataFresh) {
    sentences.push(`Market price data is stale — valuation anchors may be outdated.`);
  }

  return sentences.join(" ");
}

// ─── Valuation Narrative ─────────────────────────────────────────────────────

export interface ValuationNarrativeInput {
  ticker: string;
  price: number | null;
  intrinsicFloor: number | null;
  intrinsicCeiling: number | null;
  intrinsicMid: number | null;
  frameworkCount: number;
  convergenceSigma: number | null;
  marginOfSafety: number | null;
}

export function generateValuationNarrative(input: ValuationNarrativeInput): string {
  const { price, intrinsicFloor, intrinsicCeiling, intrinsicMid, frameworkCount, convergenceSigma, marginOfSafety } = input;
  const sentences: string[] = [];

  if (intrinsicFloor != null && intrinsicCeiling != null && frameworkCount >= 2) {
    sentences.push(
      `${frameworkCount} frameworks converge between ${inr(intrinsicFloor)}–${inr(intrinsicCeiling)}${convergenceSigma != null ? ` (σ = ${inr(convergenceSigma)})` : ""}.`,
    );
  }

  if (price != null && intrinsicMid != null && marginOfSafety != null) {
    if (marginOfSafety > 0.25) {
      sentences.push(
        `At ${inr(price)}, the stock trades at a ${pct(marginOfSafety, 0)} discount to midpoint (${inr(intrinsicMid)}). This represents an attractive entry point.`,
      );
    } else if (marginOfSafety > 0.05) {
      sentences.push(
        `At ${inr(price)}, there is a modest ${pct(marginOfSafety, 0)} margin of safety vs intrinsic (${inr(intrinsicMid)}).`,
      );
    } else if (marginOfSafety > -0.10) {
      sentences.push(
        `At ${inr(price)}, the stock trades near fair value (${inr(intrinsicMid)}). Limited margin of safety.`,
      );
    } else {
      sentences.push(
        `At ${inr(price)}, the stock is ${pct(Math.abs(marginOfSafety), 0)} above intrinsic value (${inr(intrinsicMid)}). Consider risk of capital loss.`,
      );
    }
  }

  return sentences.join(" ");
}

// ─── Bank/NBFC Narrative ─────────────────────────────────────────────────────

export interface BankNarrativeInput {
  ticker: string;
  nim: number | null;
  costToIncome: number | null;
  gnpa: number | null;
  nnpa: number | null;
  pcr: number | null;
  roa: number | null;
  roe: number | null;
  crar: number | null;
  leverageMultiple: number | null;
}

export function generateBankNarrative(input: BankNarrativeInput): string {
  const { ticker, nim, costToIncome, gnpa, pcr, roa, roe, crar, leverageMultiple } = input;
  const sentences: string[] = [];

  if (nim != null) {
    const nimQuality = nim > 3.5 ? "strong pricing power" : nim > 2.5 ? "adequate" : "thin";
    sentences.push(`${ticker}'s NIM of ${pct(nim / 100, 1)} reflects ${nimQuality} on advances.`);
  }

  if (costToIncome != null) {
    const efficiency = costToIncome < 42 ? "best-in-class" : costToIncome < 52 ? "efficient" : "needs improvement";
    sentences.push(`Cost-to-income at ${costToIncome.toFixed(0)}% is ${efficiency}.`);
  }

  if (gnpa != null && pcr != null) {
    const assetQuality = gnpa < 1.5 ? "conservative" : gnpa < 3.0 ? "acceptable" : "stressed";
    sentences.push(`GNPA at ${gnpa.toFixed(1)}% (PCR ${pcr.toFixed(0)}%) indicates ${assetQuality} provisioning.`);
  }

  if (roa != null && leverageMultiple != null && roe != null) {
    sentences.push(
      `ROA of ${pct(roa / 100, 1)} × ${mult(leverageMultiple, 0)} leverage = ${pct(roe / 100, 1)} ROE.`,
    );
  }

  if (crar != null) {
    const buffer = crar > 16 ? "well above" : crar > 12 ? "comfortably above" : "near";
    sentences.push(`CRAR at ${crar.toFixed(1)}% is ${buffer} regulatory minimum.`);
  }

  return sentences.join(" ");
}
