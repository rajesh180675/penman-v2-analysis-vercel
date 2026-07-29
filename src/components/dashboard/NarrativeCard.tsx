import { decisiveMoat, type MoatScoreResult } from "../../engine/moatScoring";
import { decisiveCapAlloc, type CapAllocScoreResult } from "../../engine/capitalAllocationScoring";
import type { DistressAssessment } from "../../engine/distressDetector";
import type { RecastPeriod } from "../../engine/types";

interface Props {
  data: RecastPeriod[];
  companyId: string;
  moat: MoatScoreResult | null;
  capAlloc: CapAllocScoreResult | null;
  distress: DistressAssessment | null;
  marginOfSafety: number | null;
  revenueGrowth: number | null;
  fcfYield: number | null;
}

function pickWord(score: number | null | undefined, words: [string, string, string, string]): string {
  if (score == null) return words[2];
  if (score >= 75) return words[0];
  if (score >= 60) return words[1];
  if (score >= 40) return words[2];
  return words[3];
}

function generateNarrative(props: Props): { businessQuality: string; capitalAllocation: string; valuationAndOutlook: string } {
  const { data, companyId, moat, capAlloc, distress, marginOfSafety, revenueGrowth, fcfYield } = props;

  const latest = data[data.length - 1];
  const periods = data.length;

  // ── Business Quality paragraph ──
  //
  // The width adjective IS the claim in this paragraph, so it has to come from
  // a score the scorer stands behind. `decisiveMoat` is null when
  // `dataSufficient` is false — a loss-maker, or an IT-services company whose
  // RNOA is inflated by a NOA denominator near zero — and the scorer still
  // returns an ordinary-looking 0-100 in that case, which is what made "wide
  // and durable" reachable on a score its own author had just disowned.
  //
  // The caveat used to be appended after the claim. A note at the end of a
  // paragraph does not retract the sentence that opened it: by then the reader
  // has read the conclusion. So when the score is not decisive the reason
  // replaces the classification rather than following it.
  const decisive = decisiveMoat(moat);
  const moatVerb = decisive?.moatTrend === "strengthening" ? "strengthening" :
                   decisive?.moatTrend === "eroding" ? "eroding" : "stable";
  const rnoaTxt = moat?.medianRNOA != null ? `${(moat.medianRNOA * 100).toFixed(1)}%` : "—";
  const spreadTxt = moat?.medianSPREAD != null ? `${(moat.medianSPREAD * 100).toFixed(1)}%` : "—";
  // "X of Y years" put two bases side by side: `periodsAboveCostOfCapital` is
  // counted over `spreadValues` (moatScoring/industrial.ts:85-90) while
  // `totalPeriods` is every period analysed, so the difference read as years the
  // company failed to clear kw when some of them had no SPREAD to compare. The
  // oldest period never does — `pipeline.ts:285` computes ratios from i > 0 — and
  // neither does any period of an effectively debt-free company, since SPREAD is
  // null when |avgNFO| <= 1 (ratiosResidual.ts:32-33).
  const cocClause = moat && moat.spreadMeasuredPeriods > 0
    ? `, with the company earning above its cost of capital in ${moat.periodsAboveCostOfCapital} of ${moat.spreadMeasuredPeriods} years carrying a computable spread (median spread ${spreadTxt})`
    : ", though no year carried a computable spread to measure against cost of capital";

  let businessQuality: string;
  if (decisive) {
    const moatAdj = pickWord(decisive.compositeScore, ["wide and durable", "narrow but real", "thin", "essentially absent"]);
    businessQuality = `${companyId} shows a ${moatAdj} economic moat, currently ${moatVerb}. `;
    businessQuality += `Median RNOA over ${decisive.totalPeriods} periods is ${rnoaTxt}${cocClause}. `;
    if (decisive.cap.years != null) {
      businessQuality += `Competitive advantage period (CAP) estimated at ~${decisive.cap.years} years (${decisive.cap.confidence} confidence). `;
    }
  } else if (moat) {
    businessQuality = `Moat width is not classified for ${companyId}: ${moat.skipReason ?? "the scorer marked its own classification unreliable"} `;
    // The medians stay — they are the evidence a reviewer would want — but as
    // reported figures rather than as the basis of a width verdict. CAP is
    // dropped entirely: it is a fade estimate off the same RNOA the scorer just
    // said is distorted, so it would carry the distortion into a year count.
    const cocFragment = moat.spreadMeasuredPeriods > 0
      ? `above cost of capital in ${moat.periodsAboveCostOfCapital} of ${moat.spreadMeasuredPeriods} years carrying a computable spread`
      : "with no year carrying a computable spread";
    businessQuality += `Median RNOA over ${moat.totalPeriods} periods is ${rnoaTxt} and median spread ${spreadTxt}, ${cocFragment} — reported without a width classification. `;
  } else {
    // `pickWord(null, …)` returns its third word, so this branch used to open
    // with "shows a thin economic moat" and then say there was not enough data
    // to assess moat width — a classification drawn from no data at all.
    businessQuality = `Insufficient periods to assess ${companyId}'s moat width reliably. `;
  }

  // ── Capital Allocation paragraph ──
  //
  // Same treatment, same reason: below three profitable periods the scorer sets
  // `dataSufficient: false` and returns a score and a letter grade anyway. The
  // adjective and the grade are the claim here, so both come from
  // `decisiveCapAlloc` — and the skip reason opens the paragraph instead of
  // trailing it as a "Caveat:", which is the position a reader reaches after
  // already having read "disciplined and value-creating".
  const decisiveCapital = decisiveCapAlloc(capAlloc);
  let capitalAllocation: string;
  if (decisiveCapital) {
    const capAdj = pickWord(decisiveCapital.compositeScore, ["disciplined and value-creating", "competent", "average", "questionable"]);
    capitalAllocation = `Management's capital allocation looks ${capAdj} (Grade ${decisiveCapital.grade}, score ${decisiveCapital.compositeScore}/100, ${decisiveCapital.trend}). `;
    if (decisiveCapital.medianFCFConversion != null) {
      capitalAllocation += `FCF conversion runs at ${(decisiveCapital.medianFCFConversion * 100).toFixed(0)}% of net income`;
    }
    if (decisiveCapital.medianIncrementalROIC != null) {
      capitalAllocation += `, and incremental ROIC on new NOA averages ${(decisiveCapital.medianIncrementalROIC * 100).toFixed(1)}%. `;
    } else {
      capitalAllocation += `. `;
    }
  } else if (capAlloc) {
    capitalAllocation = `Capital allocation is not graded for ${companyId}: ${capAlloc.skipReason ?? "the scorer marked its own grade unreliable"} `;
    // FCF conversion and incremental ROIC are both ratios against net income,
    // which is the quantity the skip reason says is missing or negative. They
    // invert sign rather than degrade, so they are dropped here for the reason
    // CAP is dropped from the moat paragraph — not omitted for brevity.
  } else {
    // `pickWord(null, …)` returns its third word, so this branch used to open
    // with "looks average" and then admit there was nothing to score.
    capitalAllocation = `Capital allocation is not scored for ${companyId} — insufficient data. `;
  }
  if (capAlloc) {
    // Event counts, not ratios off net income: these are periods in which a
    // buyback or an issuance coincided with a positive or negative SPREAD, so
    // they survive an unprofitable stretch and stay reportable either way.
    if (capAlloc.buybacksValueAccretive > 0) {
      capitalAllocation += `Buybacks were value-accretive in ${capAlloc.buybacksValueAccretive} period(s) — done when SPREAD was positive. `;
    }
    if (capAlloc.dilutiveIssuances > 0) {
      capitalAllocation += `⚠ ${capAlloc.dilutiveIssuances} dilutive issuance(s) detected — equity raised when SPREAD was negative. `;
    }
  }

  // ── Valuation & Outlook paragraph ──
  let valuationAndOutlook = "";

  // Distress check first
  if (distress?.equityModelsBlocked || distress?.severity === "severe" || distress?.severity === "critical") {
    valuationAndOutlook = `⚠ Financial distress signal detected: ${distress.reasons.join(", ")}. Equity-side valuation models are unreliable in this state — the company should be treated as speculative until equity is replenished. `;
  } else {
    // Growth + valuation
    if (revenueGrowth != null) {
      const growthDesc = revenueGrowth > 0.15 ? "strong" : revenueGrowth > 0.07 ? "healthy" : revenueGrowth > 0.0 ? "modest" : "negative";
      valuationAndOutlook += `Revenue has compounded at ${(revenueGrowth * 100).toFixed(1)}% annually over ${periods - 1} years — ${growthDesc} for an Indian listed company. `;
    }

    if (fcfYield != null) {
      valuationAndOutlook += `Trailing FCF yield is ${(fcfYield * 100).toFixed(1)}%`;
      if (fcfYield > 0.06) valuationAndOutlook += ", which provides a real cash buffer at current prices. ";
      else if (fcfYield > 0.03) valuationAndOutlook += ", consistent with a growth-stage business. ";
      else if (fcfYield > 0) valuationAndOutlook += ", thin but positive — pricing in significant future expansion. ";
      else valuationAndOutlook += ", currently negative — the market is paying for future cash flows that don't yet exist. ";
    }

    if (marginOfSafety != null) {
      const mosPct = marginOfSafety * 100;
      if (mosPct > 30) valuationAndOutlook += `The intrinsic value calculation suggests ${mosPct.toFixed(0)}% upside to fair value — a meaningful margin of safety. `;
      else if (mosPct > 10) valuationAndOutlook += `Implied upside to intrinsic value is ${mosPct.toFixed(0)}% — fair price, but no significant cushion. `;
      else if (mosPct > -10) valuationAndOutlook += `Price is roughly at intrinsic value (${mosPct >= 0 ? "+" : ""}${mosPct.toFixed(0)}%). The market is pricing it efficiently. `;
      else valuationAndOutlook += `Price is ${Math.abs(mosPct).toFixed(0)}% above intrinsic value — the market is pricing in a more optimistic scenario than the financials support. `;
    }

    // Sales/PAT context
    if (latest && latest.is.Sales > 0 && latest.is.PAT) {
      const netMargin = latest.is.PAT / latest.is.Sales;
      valuationAndOutlook += `Latest period: ₹${(latest.is.Sales / 1000).toFixed(1)}k Cr revenue at ${(netMargin * 100).toFixed(1)}% net margin. `;
    }
  }

  return { businessQuality, capitalAllocation, valuationAndOutlook };
}

export default function NarrativeCard(props: Props) {
  const narrative = generateNarrative(props);

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/40 dark:to-slate-900/20 dark:border-slate-700 p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">📖</span>
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Narrative Summary</h3>
          <p className="text-xs text-slate-500">Plain-English synthesis of the financial signals</p>
        </div>
      </div>

      <div className="space-y-4 text-sm leading-relaxed">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">Business Quality</div>
          <p className="text-slate-700 dark:text-slate-300">{narrative.businessQuality}</p>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-1">Capital Allocation</div>
          <p className="text-slate-700 dark:text-slate-300">{narrative.capitalAllocation}</p>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-1">Valuation &amp; Outlook</div>
          <p className="text-slate-700 dark:text-slate-300">{narrative.valuationAndOutlook}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 italic">
        Auto-generated from moat scorer, capital allocation grade, distress detector, growth, FCF yield, and margin of safety.
        Not investment advice — verify with primary sources before acting.
      </div>
    </div>
  );
}
