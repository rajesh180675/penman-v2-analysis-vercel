import type { MoatScoreResult } from "../../engine/moatScoring";
import type { CapAllocScoreResult } from "../../engine/capitalAllocationScoring";
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
  const moatAdj = pickWord(moat?.compositeScore, ["wide and durable", "narrow but real", "thin", "essentially absent"]);
  const moatVerb = moat?.moatTrend === "strengthening" ? "strengthening" :
                   moat?.moatTrend === "eroding" ? "eroding" : "stable";
  const rnoaTxt = moat?.medianRNOA != null ? `${(moat.medianRNOA * 100).toFixed(1)}%` : "—";
  const spreadTxt = moat?.medianSPREAD != null ? `${(moat.medianSPREAD * 100).toFixed(1)}%` : "—";
  const periodsAboveCoC = moat ? `${moat.periodsAboveCostOfCapital} of ${moat.totalPeriods}` : "—";

  let businessQuality = `${companyId} shows a ${moatAdj} economic moat, currently ${moatVerb}. `;
  if (moat) {
    businessQuality += `Median RNOA over ${moat.totalPeriods} periods is ${rnoaTxt}, with the company earning above its cost of capital in ${periodsAboveCoC} years (median spread ${spreadTxt}). `;
    if (moat.cap.years != null) {
      businessQuality += `Competitive advantage period (CAP) estimated at ~${moat.cap.years} years (${moat.cap.confidence} confidence). `;
    }
    if (!moat.dataSufficient && moat.skipReason) {
      businessQuality += `Note: ${moat.skipReason} `;
    }
  } else {
    businessQuality += `Insufficient periods to assess moat width reliably. `;
  }

  // ── Capital Allocation paragraph ──
  const capAdj = pickWord(capAlloc?.compositeScore, ["disciplined and value-creating", "competent", "average", "questionable"]);
  let capitalAllocation = `Management's capital allocation looks ${capAdj}`;
  if (capAlloc) {
    capitalAllocation += ` (Grade ${capAlloc.grade}, score ${capAlloc.compositeScore}/100, ${capAlloc.trend}). `;
    if (capAlloc.medianFCFConversion != null) {
      capitalAllocation += `FCF conversion runs at ${(capAlloc.medianFCFConversion * 100).toFixed(0)}% of net income`;
    }
    if (capAlloc.medianIncrementalROIC != null) {
      capitalAllocation += `, and incremental ROIC on new NOA averages ${(capAlloc.medianIncrementalROIC * 100).toFixed(1)}%. `;
    } else {
      capitalAllocation += `. `;
    }
    if (capAlloc.buybacksValueAccretive > 0) {
      capitalAllocation += `Buybacks were value-accretive in ${capAlloc.buybacksValueAccretive} period(s) — done when SPREAD was positive. `;
    }
    if (capAlloc.dilutiveIssuances > 0) {
      capitalAllocation += `⚠ ${capAlloc.dilutiveIssuances} dilutive issuance(s) detected — equity raised when SPREAD was negative. `;
    }
    if (!capAlloc.dataSufficient && capAlloc.skipReason) {
      capitalAllocation += `Caveat: ${capAlloc.skipReason} `;
    }
  } else {
    capitalAllocation += `, but data is insufficient to score it formally. `;
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
    if (latest.is.Sales > 0 && latest.is.PAT) {
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
