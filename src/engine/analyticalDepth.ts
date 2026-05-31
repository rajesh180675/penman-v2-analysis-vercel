/* ================================================================
   Plan 5 keystone — analyticalDepth enricher (schema v18).

   Pure function: reads the four valuation-depth analytics that
   ValuationCommandCenterOutput already computes and rolls them into the
   AnalyticalDepthSummary block surfaced in the trust envelope.

   It does NOT compute anything new — it READS:
     - reverseDcf      : implied-growth expectation vs normalized anchor
     - cleanSurplus    : dirty-surplus verdict
     - damodaranCapm   : independent ke cross-check vs the model ke
     - sotp            : sum-of-the-parts presence

   Lives outside buildAnalysisTraceability on purpose: the structural
   builder runs where valuation output is out of scope (useAuditAnalysis),
   so depth is enriched at the surface seam (ValuationReport/DashboardView)
   where both the envelope and the command center coexist.
================================================================ */

import type {
  AnalyticalDepthCheck,
  AnalyticalDepthStatus,
  AnalyticalDepthSummary,
} from "./types/analyticalDepth";
import type { ValuationCommandCenterOutput } from "./valuationCommandCenter";

/** Reverse-DCF: flag "watch" when the implied owner-earnings growth sits
 *  more than this far ABOVE the normalized anchor — i.e. the price embeds an
 *  aggressive growth expectation the history doesn't support. Deeply negative
 *  spreads (pessimistic expectations) are not flagged: for a value lens they
 *  are the opportunity, not the risk. 300 bps. */
const REVERSE_DCF_WATCH_SPREAD = 0.03;

/** Damodaran CAPM: flag "watch" when the independent CAPM ke diverges from the
 *  model ke by more than this (relative). 20%. */
const CAPM_KE_WATCH_REL_DIVERGENCE = 0.2;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function rollUp(checks: AnalyticalDepthCheck[]): {
  status: AnalyticalDepthStatus;
  presentCount: number;
  watchCount: number;
} {
  const presentCount = checks.filter((c) => c.present).length;
  const watchCount = checks.filter((c) => c.present && c.status === "watch").length;
  const status: AnalyticalDepthStatus =
    presentCount === 0 ? "absent" : presentCount === checks.length ? "rich" : "partial";
  return { status, presentCount, watchCount };
}

/**
 * Build the analyticalDepth block from a valuation command-center output.
 *
 * @param commandCenter the valuation output (reverseDcf/cleanSurplus/capm/sotp).
 * @param opts.modelKe  the cost of equity the model actually used, for the
 *                       Damodaran cross-check. When omitted, the CAPM check is
 *                       still "present" (it ran) but cannot flag divergence.
 */
export function evaluateAnalyticalDepth(
  commandCenter: Pick<
    ValuationCommandCenterOutput,
    "reverseDcf" | "cleanSurplus" | "damodaranCapm" | "sotp"
  >,
  opts?: { modelKe?: number | null | undefined },
): AnalyticalDepthSummary {
  const checks: AnalyticalDepthCheck[] = [];

  // ── reverse-DCF ──────────────────────────────────────────────────────────
  // reverseDcf is always present on the output object; "present" here means it
  // actually produced an implied growth (null when valuation was not eligible).
  {
    const rd = commandCenter.reverseDcf;
    const impliedGrowth = rd?.impliedOwnerEarningsGrowth ?? null;
    if (impliedGrowth == null) {
      checks.push({
        key: "reverse-dcf",
        label: "Reverse DCF",
        present: false,
        status: "n/a",
        detail: "Reverse-DCF implied growth not computed (valuation not eligible).",
      });
    } else {
      const anchor = rd.normalizedGrowthAnchor;
      const spread = rd.spreadVsNormalizedGrowth ?? impliedGrowth - anchor;
      const watch = spread > REVERSE_DCF_WATCH_SPREAD;
      checks.push({
        key: "reverse-dcf",
        label: "Reverse DCF",
        present: true,
        status: watch ? "watch" : "ok",
        detail: watch
          ? `Market embeds ${pct(impliedGrowth)} owner-earnings growth — ${pct(spread)} above the ${pct(anchor)} normalized anchor (aggressive).`
          : `Implied owner-earnings growth ${pct(impliedGrowth)} vs ${pct(anchor)} normalized anchor — within plausible band.`,
      });
    }
  }

  // ── clean-surplus ────────────────────────────────────────────────────────
  {
    const cs = commandCenter.cleanSurplus;
    if (cs == null) {
      checks.push({
        key: "clean-surplus",
        label: "Clean surplus",
        present: false,
        status: "n/a",
        detail: "Clean-surplus check not run (needs ≥2 periods).",
      });
    } else {
      const watch = cs.overall === "material-dirty";
      checks.push({
        key: "clean-surplus",
        label: "Clean surplus",
        present: true,
        status: watch ? "watch" : "ok",
        detail: watch
          ? `Material dirty surplus — worst residual ${pct(cs.worstResidualRatio)} of book value bypassed the P&L.`
          : `Clean-surplus verdict: ${cs.overall} (worst residual ${pct(cs.worstResidualRatio)}).`,
      });
    }
  }

  // ── Damodaran CAPM cross-check ─────────────────────────────────────────────
  {
    const capm = commandCenter.damodaranCapm;
    if (capm == null) {
      checks.push({
        key: "damodaran-capm",
        label: "Damodaran CAPM ke",
        present: false,
        status: "n/a",
        detail: "Independent CAPM ke cross-check not available (no industry beta).",
      });
    } else {
      const modelKe = opts?.modelKe ?? null;
      const capmKeVal = capm.ke;
      let watch = false;
      let detail: string;
      if (modelKe != null && Number.isFinite(modelKe) && modelKe > 0) {
        const relDiv = Math.abs(capmKeVal - modelKe) / modelKe;
        watch = relDiv > CAPM_KE_WATCH_REL_DIVERGENCE;
        detail = watch
          ? `Independent CAPM ke ${pct(capmKeVal)} (β ${capm.citation.beta.toFixed(2)}) diverges ${pct(relDiv)} from model ke ${pct(modelKe)}.`
          : `CAPM ke ${pct(capmKeVal)} (β ${capm.citation.beta.toFixed(2)}) agrees with model ke ${pct(modelKe)}.`;
      } else {
        detail = `Independent CAPM ke ${pct(capmKeVal)} (β ${capm.citation.beta.toFixed(2)}).`;
      }
      checks.push({
        key: "damodaran-capm",
        label: "Damodaran CAPM ke",
        present: true,
        status: watch ? "watch" : "ok",
        detail,
      });
    }
  }

  // ── SOTP ───────────────────────────────────────────────────────────────────
  {
    const sotp = commandCenter.sotp;
    checks.push(
      sotp == null
        ? {
            key: "sotp",
            label: "Sum-of-the-parts",
            present: false,
            status: "n/a",
            detail: "No SOTP valuation (single-segment business or no segment data).",
          }
        : {
            key: "sotp",
            label: "Sum-of-the-parts",
            present: true,
            status: "ok",
            detail: `SOTP run across ${sotp.segments.length} segment(s); enterprise value ${sotp.totalEnterpriseValue.toFixed(0)}.`,
          },
    );
  }

  const { status, presentCount, watchCount } = rollUp(checks);
  const summary =
    status === "absent"
      ? "No depth analytics ran for this run."
      : `${presentCount}/4 depth analytics ran${watchCount > 0 ? `, ${watchCount} flagged for review` : ""}.`;

  return { status, summary, presentCount, watchCount, checks };
}
