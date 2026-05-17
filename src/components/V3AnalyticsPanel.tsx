/**
 * V3 Analytics Panel
 * Renders: §6 Dirty Surplus, §11 Terminal Anchoring, §13 Event Flags,
 *          §12 Sensitivity Matrix, §14 Confidence Score
 */
import { useMemo, useState } from "react";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { RecastPeriod, EngineConfig, ke_from_config } from "../engine/types";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { detectDistress } from "../engine/distressDetector";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import {
  computeV3Analytics,
  computeSensitivityMatrix,
  computeAnchorTable,
  classifyTVShare,
  V3AnalyticsBundle,
  DirtySurplusRecord,
  PeriodEventFlags,
  ConfidenceComponent,
  AccrualTableRow,
  Section6BResult,
  OADecompositionResult,
  ReReOIGapDecomposition,
} from "../engine/v3Analytics";
import { MoatScoreResult, MoatDimension } from "../engine/moatScoring";
import { CapAllocScoreResult, CapAllocDimension } from "../engine/capitalAllocationScoring";
import { EPVResult } from "../engine/grahamDoddEPV";
import { RelativeValuationResult, MultipleBand } from "../engine/relativeValuation";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null;
  traceabilitySummary?: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null;
}

const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`;
const cr = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `₹${Math.abs(v) >= 10 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toFixed(1)} Cr`;
const DS_COLORS: Record<string, string> = {
  NEGLIGIBLE: "text-emerald-700 bg-emerald-50",
  MINOR: "text-amber-700 bg-amber-50",
  MATERIAL: "text-orange-700 bg-orange-50",
  CRITICAL: "text-red-700 bg-red-50",
};

const CONF_COLORS: Record<string, string> = {
  HIGH: "text-emerald-700 bg-emerald-50 border-emerald-200",
  MODERATE: "text-blue-700 bg-blue-50 border-blue-200",
  LOW: "text-amber-700 bg-amber-50 border-amber-200",
  VERY_LOW: "text-red-700 bg-red-50 border-red-200",
};

const GRADE_COLORS: Record<string, string> = {
  GRADE_A: "text-emerald-700 bg-emerald-50",
  GRADE_B: "text-blue-700 bg-blue-50",
  GRADE_C: "text-amber-700 bg-amber-50",
  GRADE_D: "text-red-700 bg-red-50",
};

export default function V3AnalyticsPanel({ data, config, traceability = null, traceabilitySummary: precomputedTraceabilitySummary = null }: Props) {
  const [activeSection, setActiveSection] = useState<"overview" | "dirty" | "events" | "terminal" | "sensitivity" | "confidence" | "triggers" | "accruals" | "oa_decomp" | "gap_decomp" | "section6b" | "moat" | "capital_alloc" | "epv" | "relative_val">("overview");
  const derivedTraceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(traceability),
    [traceability],
  );
  const traceabilitySummary = precomputedTraceabilitySummary ?? derivedTraceabilitySummary;

  const ke = ke_from_config(config);

  const { valuation, kw } = useMemo(() => {
    if (data.length < 2) return { valuation: null, kw: ke };
    const cur = data[data.length - 1];
    const prev = data[data.length - 2];
    const kw_derived = deriveKwFromStructure(cur, prev, ke, config.risk_free_rate, config);
    const g = config.g_terminal_override ?? 0.04;
    // First pass: compute without anchor to get RE series for terminal anchor computation
    const val0 = computeValuation(data, ke, kw_derived, g, config);
    return { valuation: val0, kw: kw_derived };
  }, [data, config, ke]);

  const bundle: V3AnalyticsBundle | null = useMemo(() => {
    if (!valuation) return null;
    return computeV3Analytics(
      data, config,
      // Phase J2: fall back to V_ReOI_CV03 / V_RE_CV1 surrogate when
      // equity-side is blocked, so v3 analytics still produce a confidence
      // signal instead of crashing on null. The `equityModelsBlocked`
      // flag carries forward via the valuation object.
      valuation.V_RE_CV3 ?? valuation.V_ReOI_CV03,
      valuation.V_ReOI_CV03,
      config.g_terminal_override,
      kw
    );
  }, [data, config, valuation, kw]);

  // Second pass: recompute with §11 terminal anchor once we have the bundle
  const valuationWithAnchor = useMemo(() => {
    if (!valuation || !bundle) return valuation;
    const g = bundle.anchorResult.g_terminal;
    return computeValuation(
      data, ke, kw, g, config,
      bundle.anchorResult.selected_RE_anchor,
      bundle.anchorResult.selected_ReOI_anchor
    );
  }, [valuation, bundle, data, ke, kw, config]);

  // Effective valuation uses anchor-adjusted result when available
  const effectiveValuation = valuationWithAnchor ?? valuation;

  const sensMatrix = useMemo(() => {
    if (!valuation || !bundle) return [];
    const T = valuation.reSeries.length;
    return computeSensitivityMatrix(
      valuation.CSE0,
      valuation.pvRE,
      valuation.reSeries,
      bundle.anchorResult.selected_RE_anchor,
      ke,
      bundle.anchorResult.g_terminal,
      T,
      config.g_terminal_floor ?? 0.02
    );
  }, [valuation, bundle, ke, config]);

  const anchorTable = useMemo(() => {
    if (!effectiveValuation || !bundle) return [];
    const T = effectiveValuation.reSeries.length;
    return computeAnchorTable(
      effectiveValuation.CSE0, effectiveValuation.pvRE,
      bundle.anchorResult, ke, T
    );
  }, [effectiveValuation, bundle, ke]);

  const tvClassification = useMemo(() => {
    if (!valuation) return null;
    // Phase J2: classifyTVShare requires V_RE_CV3 / V_RE_CV1; both null
    // when latest CSE ≤ 0. Skip rather than show a misleading grade.
    if (valuation.V_RE_CV3 == null || valuation.V_RE_CV1 == null) return null;
    return classifyTVShare(valuation.V_RE_CV3, valuation.V_RE_CV1);
  }, [valuation]);

  if (data.length < 2) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
        <p className="font-semibold">Need ≥ 2 periods for V3 analytics</p>
      </div>
    );
  }

  const tabs: Array<{ id: typeof activeSection; label: string; icon: string }> = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "dirty", label: "Dirty Surplus §6", icon: "🧮" },
    { id: "events", label: "Event Flags §13", icon: "🚩" },
    { id: "terminal", label: "Terminal Anchor §11", icon: "⚓" },
    { id: "sensitivity", label: "Sensitivity §12", icon: "📉" },
    { id: "confidence", label: "Confidence §14", icon: "🎯" },
    { id: "triggers", label: "Triggers §15", icon: "🔔" },
    { id: "accruals", label: "Accruals §5A", icon: "📋" },
    { id: "oa_decomp", label: "OA Decomp §3B", icon: "🏗" },
    { id: "gap_decomp", label: "RE/ReOI Gap §6", icon: "🔍" },
    { id: "section6b", label: "§6B Per-Share", icon: "💹" },
    { id: "moat", label: "Moat Score", icon: "🏰" },
    { id: "capital_alloc", label: "Capital Allocation", icon: "🏦" },
    { id: "epv", label: "EPV (Graham-Dodd)", icon: "📐" },
    { id: "relative_val", label: "Relative Valuation", icon: "⚖️" },
  ];

  return (
    <div className="space-y-4">
      {traceabilitySummary && (
        <TraceabilityTrustPanel
          title="V3 Analytics Trust Gate"
          summary={traceabilitySummary}
          confidenceStatus={traceability?.confidence.status}
          rigorLabel={traceability?.rigor.currentLabel}
          parserStatus={traceability?.parserFidelity.status}
          reconciliationStatus={traceability?.reconciliation.status}
          cautionHeading="Interpret the V3 decomposition, anchor, and confidence sections in the context of these upstream trust limits."
        />
      )}

      {/* Phase I robustness banners — surface skip-with-reason from valuation modules */}
      {bundle && (() => {
        const banners: Array<{ tone: "warn" | "info" | "danger"; title: string; body: string }> = [];

        // Phase J: distress signal (negative net worth, going-concern stress)
        const distress = detectDistress(data);
        if (distress.severity === "critical") {
          banners.push({
            tone: "danger",
            title: "🚨 Critical distress — going-concern stress",
            body: distress.reasons.join(" "),
          });
        } else if (distress.severity === "severe") {
          banners.push({
            tone: "warn",
            title: "⚠️ Negative net worth — equity-side valuation skipped",
            body: `${distress.reasons.join(" ")} Anchor on enterprise-side V_ReOI or FCFF.`,
          });
        } else if (distress.severity === "warning") {
          banners.push({
            tone: "warn",
            title: "⚠ Negative-equity period in history",
            body: distress.reasons.join(" "),
          });
        }

        // Cyclicality
        if (bundle.cyclicality?.classification === "cyclical-peak") {
          banners.push({
            tone: "warn",
            title: "🌡️ Latest period is at peak-cycle",
            body: `${bundle.cyclicality.reason}. Latest ${bundle.cyclicality.metricUsed === "core-pm" ? "operating margin" : "RNOA"}: ${((bundle.cyclicality.latestValue ?? 0) * 100).toFixed(1)}%; cycle median: ${((bundle.cyclicality.medianValue ?? 0) * 100).toFixed(1)}%. Naïve valuation extrapolation will be optimistic; consider median-of-cycle as a sanity anchor.`,
          });
        } else if (bundle.cyclicality?.classification === "cyclical-trough") {
          banners.push({
            tone: "warn",
            title: "🌡️ Latest period is at trough-cycle",
            body: `${bundle.cyclicality.reason}. Latest ${bundle.cyclicality.metricUsed === "core-pm" ? "operating margin" : "RNOA"}: ${((bundle.cyclicality.latestValue ?? 0) * 100).toFixed(1)}%; cycle median: ${((bundle.cyclicality.medianValue ?? 0) * 100).toFixed(1)}%. Naïve valuation extrapolation will be pessimistic; consider median-of-cycle as a sanity anchor.`,
          });
        } else if (bundle.cyclicality?.classification === "cyclical-midcycle") {
          banners.push({
            tone: "info",
            title: "🌡️ Cyclical business, latest near mid-cycle",
            body: bundle.cyclicality.reason,
          });
        }

        // Moat skip-reason
        if (bundle.moatScore && !bundle.moatScore.dataSufficient && bundle.moatScore.skipReason) {
          banners.push({
            tone: "warn",
            title: "🏰 Moat score is low-confidence",
            body: bundle.moatScore.skipReason,
          });
        }

        // Capital allocation skip-reason
        if (bundle.capitalAllocation && !bundle.capitalAllocation.dataSufficient && bundle.capitalAllocation.skipReason) {
          banners.push({
            tone: "warn",
            title: "💼 Capital allocation score is low-confidence",
            body: bundle.capitalAllocation.skipReason,
          });
        }

        // Structural breaks (demerger / M&A / capital raise)
        if (bundle.structuralBreaks?.hasBreaks) {
          const breakSummary = bundle.structuralBreaks.breaks
            .map((b) => `${b.period_end}: ${b.kind} (${(b.yoyChange * 100).toFixed(0)}% YoY)`)
            .join("; ");
          banners.push({
            tone: "warn",
            title: "⚡ Structural break(s) detected in time series",
            body: `${breakSummary}. ${bundle.structuralBreaks.recommendation}`,
          });
        }

        // Loss-maker valuation alternative (Phase I3)
        if (bundle.lossMakerValuation?.isLossMaker) {
          const lmv = bundle.lossMakerValuation;
          const pathSignal = lmv.profitabilityPath.signal;
          const lmvBody = [
            `${lmv.lossYears}/${lmv.totalYears} periods loss-making.`,
            `Revenue-multiple anchor (${lmv.revenueMultiple.source}): ${lmv.revenueMultiple.multiple.toFixed(1)}x ⇒ implied EV ₹${lmv.revenueMultiple.impliedEVCr.toFixed(0)} Cr${lmv.revenueMultiple.perShareValue != null ? ` (₹${lmv.revenueMultiple.perShareValue.toFixed(0)}/share)` : ""}.`,
            lmv.runwayYears != null
              ? `Runway: ~${lmv.runwayYears.toFixed(1)} years at current burn.`
              : null,
            lmv.reverseDCF.impliedRevenueCAGR != null
              ? `Reverse-DCF: market cap implies ${(lmv.reverseDCF.impliedRevenueCAGR * 100).toFixed(0)}% revenue CAGR for 5y.`
              : null,
            `Path-to-profitability: ${pathSignal.toUpperCase()} — ${lmv.profitabilityPath.summary}`,
            `Recommendation: ${lmv.recommendation}`,
          ]
            .filter(Boolean)
            .join(" ");
          banners.push({
            tone: pathSignal === "red" ? "warn" : "info",
            title: `📉 Loss-maker — earnings-based models skipped, alternative anchors below`,
            body: lmvBody,
          });
        }

        if (banners.length === 0) return null;
        return (
          <div className="space-y-2">
            {banners.map((b, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 text-sm ${
                  b.tone === "danger"
                    ? "border-red-300 bg-red-50 text-red-900"
                    : b.tone === "warn"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                <div className="font-semibold mb-0.5">{b.title}</div>
                <div className="text-xs">{b.body}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveSection(t.id)}
              className={`px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                activeSection === t.id
                  ? "border-indigo-600 text-indigo-700 bg-indigo-50"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeSection === "overview" && bundle && effectiveValuation && tvClassification && (
            <OverviewSection bundle={bundle} valuation={effectiveValuation} tvClass={tvClassification} />
          )}
          {activeSection === "dirty" && bundle && (
            <DirtySurplusSection ds={bundle.dirtySurplus} />
          )}
          {activeSection === "events" && bundle && (
            <EventFlagsSection flags={bundle.periodFlags} periods={data} />
          )}
          {activeSection === "terminal" && bundle && effectiveValuation && anchorTable && (
            <TerminalAnchorSection anchor={bundle.anchorResult} anchorTable={anchorTable} valuation={effectiveValuation} ke={ke} />
          )}
          {activeSection === "sensitivity" && sensMatrix.length > 0 && bundle && (
            <SensitivitySection matrix={sensMatrix} baseKe={ke} baseG={bundle.anchorResult.g_terminal} />
          )}
          {activeSection === "confidence" && bundle && (
            <ConfidenceSection conf={bundle.confidence} validation={bundle.validation} />
          )}
          {activeSection === "triggers" && bundle && (
            <TriggersSection triggers={bundle.triggers} fadeParams={bundle.fadeParams} />
          )}
          {activeSection === "accruals" && bundle && (
            <AccrualsSection rows={bundle.accrualTable} />
          )}
          {activeSection === "oa_decomp" && bundle && (
            <OADecompSection decompositions={bundle.oaDecomposition} />
          )}
          {activeSection === "gap_decomp" && bundle && (
            <GapDecompSection gap={bundle.reReoiGapDecomposition} />
          )}
          {activeSection === "section6b" && bundle && (
            <Section6BPanel s6b={bundle.section6B} />
          )}
          {activeSection === "moat" && bundle && (
            <MoatSection moat={bundle.moatScore} />
          )}
          {activeSection === "capital_alloc" && bundle && (
            <CapitalAllocSection ca={bundle.capitalAllocation} />
          )}
          {activeSection === "epv" && bundle && (
            <EPVSection epv={bundle.epv} />
          )}
          {activeSection === "relative_val" && bundle && (
            <RelativeValSection rv={bundle.relativeValuation} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────── */
function OverviewSection({ bundle, valuation, tvClass }: {
  bundle: V3AnalyticsBundle;
  valuation: ReturnType<typeof computeValuation>;
  tvClass: ReturnType<typeof classifyTVShare>;
}) {
  const { confidence, anchorResult, dirtySurplus, periodFlags } = bundle;
  const totalFlags = periodFlags.reduce((s, p) => s + p.flags.length, 0);
  // Phase J2: V_RE_CV3 may be null on negative-equity companies. Use
  // V_ReOI_CV03 as the identity-gap reference when equity-side is blocked
  // so the panel stays renderable instead of crashing the overview.
  const reAnchor = valuation.V_RE_CV3 ?? valuation.V_ReOI_CV03;
  const identityGap = Math.abs(reAnchor - valuation.V_ReOI_CV03);
  const identityGapPct = reAnchor !== 0 ? identityGap / Math.abs(reAnchor) : 0;
  const identityFlag = identityGapPct < 0.05 ? "CONVERGED" : identityGapPct < 0.15 ? "WARNING" : "CRITICAL";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">V3 Analytics — Executive Overview</h3>
        <p className="text-xs text-slate-500">Full implementation of Penman–Nissim V3 specification §6, §9, §11–§15</p>
      </div>

      {/* Key metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Confidence Score"
          value={`${confidence.composite.toFixed(0)}/100`}
          badge={confidence.classification}
          color={CONF_COLORS[confidence.classification]}
        />
        <MetricCard
          label="TV Share (RE CV3)"
          value={pct(tvClass.tv_share)}
          badge={tvClass.tv_grade}
          color={GRADE_COLORS[tvClass.tv_grade]}
        />
        <MetricCard
          label="Anchor Method"
          value={anchorResult.anchor_method}
          badge={anchorResult.terminal_event_flags.length > 0 ? "Adjusted" : "As-reported"}
          color={anchorResult.terminal_event_flags.length > 0 ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50"}
        />
        <MetricCard
          label="RE–ReOI Gap"
          value={pct(identityGapPct)}
          badge={identityFlag}
          color={identityFlag === "CONVERGED" ? "text-emerald-700 bg-emerald-50" : identityFlag === "WARNING" ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50"}
        />
      </div>

      {/* Summary diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoBlock title="Terminal Value">
          <InfoRow label="Terminal growth g" value={pct(anchorResult.g_terminal)} />
          <InfoRow label="g source" value={anchorResult.g_source.slice(0, 60) + (anchorResult.g_source.length > 60 ? "…" : "")} />
          <InfoRow label="Selected anchor" value={cr(anchorResult.selected_RE_anchor)} />
          <InfoRow label="Anchor method" value={anchorResult.anchor_method} />
          <InfoRow label="TV grade" value={tvClass.tv_label} />
        </InfoBlock>
        <InfoBlock title="Data Quality">
          <InfoRow label="Cumulative dirty surplus" value={cr(dirtySurplus.cumulative_dirty_surplus)} />
          <InfoRow label="Dirty surplus % of equity" value={pct(dirtySurplus.cum_ds_pct)} />
          <InfoRow label="Clean surplus compromised" value={dirtySurplus.clean_surplus_compromised ? "⚠ YES" : "✓ No"} />
          <InfoRow label="Total event flags" value={`${totalFlags} across all periods`} />
          <InfoRow label="Terminal period flags" value={anchorResult.terminal_event_flags.length > 0 ? anchorResult.terminal_event_flags.join(", ") : "None"} />
        </InfoBlock>
      </div>

      {/* Validation warnings */}
      {bundle.validation.errors + bundle.validation.warnings > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-2">Data Validation Issues</p>
          {bundle.validation.checks.filter((c) => !c.passed).map((c, i) => (
            <p key={i} className={`text-xs ${c.severity === "ERROR" ? "text-red-700" : "text-amber-700"}`}>
              [{c.severity}] {c.id}: {c.description}{c.period ? ` (${c.period.slice(0, 7)})` : ""}{c.detail ? ` — ${c.detail}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Dirty Surplus §6 ─────────────────────────────────────────── */
function DirtySurplusSection({ ds }: { ds: V3AnalyticsBundle["dirtySurplus"] }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§6 Clean-Surplus Accounting</h3>
        <p className="text-xs text-slate-500 mb-3">Dirty surplus = ΔCSE − CNI + Dividends paid. Material values indicate capital transactions or OCI events not captured in CNI.</p>
      </div>

      {/* Summary banner */}
      <div className={`rounded-lg border p-3 text-sm ${ds.clean_surplus_compromised ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
        <strong>Cumulative dirty surplus:</strong> {cr(ds.cumulative_dirty_surplus)} ({pct(ds.cum_ds_pct)} of latest equity)
        {ds.clean_surplus_compromised && " — ⚠ CLEAN SURPLUS COMPROMISED: Cumulative DS exceeds 20% of equity. RE valuation model reliability is reduced."}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              {["Period", "CSE_t", "CSE_{t-1}", "CNI", "Dividends", "Dirty Surplus", "% of CSE", "Class", "CSE_adj"].map((h) => (
                <th key={h} className="px-2 py-2 text-left text-slate-500 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ds.records.map((r: DirtySurplusRecord) => (
              <tr key={r.period_end} className="hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono">{r.period_end.slice(0, 7)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.CSE_t)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.CSE_t1)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.CNI_t)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.d_reported_t)}</td>
                <td className={`px-2 py-1.5 text-right font-mono font-semibold ${Math.abs(r.dirty_surplus) > 100 ? "text-amber-700" : "text-slate-700"}`}>
                  {cr(r.dirty_surplus)}
                </td>
                <td className="px-2 py-1.5 text-right">{pct(r.DS_pct_of_CSE)}</td>
                <td className="px-2 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DS_COLORS[r.ds_class]}`}>
                    {r.ds_class}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-500">{cr(r.CSE_adj)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        CSE_adj = clean-surplus-adjusted equity enforcing CNI − dividends identity. Divergence from actual CSE accumulates as cumulative dirty surplus.
      </p>
    </div>
  );
}

/* ── Event Flags §13 ──────────────────────────────────────────── */
function EventFlagsSection({ flags, periods }: { flags: PeriodEventFlags[]; periods: RecastPeriod[] }) {
  const flagged = flags.filter((f) => f.flags.length > 0);
  const FLAG_COLORS: Record<string, string> = {
    STRUCTURAL_EVENT_CRITICAL: "bg-red-100 text-red-800",
    STRUCTURAL_EVENT: "bg-orange-100 text-orange-800",
    CAPITAL_TRANSACTION_LIKELY: "bg-purple-100 text-purple-800",
    PM_OUTLIER_CRITICAL: "bg-red-100 text-red-800",
    PM_OUTLIER_WARNING: "bg-amber-100 text-amber-800",
    LARGE_COMPONENT_DECLINE: "bg-amber-100 text-amber-800",
    PAYOUT_EXCEEDS_EARNINGS: "bg-orange-100 text-orange-800",
    IND_AS_116_TRANSITION: "bg-blue-100 text-blue-800",
    SMALL_NOA_DENOMINATOR: "bg-slate-100 text-slate-700",
    ROCE_OUTLIER_CRITICAL: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§13 Period Event Flags</h3>
        <p className="text-xs text-slate-500">
          {flagged.length > 0
            ? `${flagged.length} of ${flags.length} periods have event flags. Terminal period flags affect anchor selection (§11.5).`
            : "No event flags detected across all periods."}
        </p>
      </div>

      {flagged.length === 0 && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm">
          ✓ All periods are clean. Terminal anchor uses as-reported RE.
        </div>
      )}

      {flagged.map((pf) => {
        const period = periods.find((p) => p.period_end === pf.period_end);
        return (
          <div key={pf.period_end} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-sm font-semibold text-slate-700">{pf.period_end.slice(0, 7)}</span>
              {period?.ratios?.PM != null && (
                <span className="text-xs text-slate-500">PM: {pct(period.ratios.PM)} | ROCE: {pct(period.ratios.ROCE)}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {pf.flags.map((flag) => (
                <span key={flag} className={`text-xs px-2 py-0.5 rounded-full font-medium ${FLAG_COLORS[flag] ?? "bg-slate-100 text-slate-700"}`}>
                  {flag}
                </span>
              ))}
            </div>
            {pf.pm_zscore != null && (
              <p className="text-xs text-slate-400 mt-1">PM z-score: {pf.pm_zscore.toFixed(2)} | ΔNOA%: {pf.noa_change_pct != null ? pct(pf.noa_change_pct) : "—"}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Terminal Anchor §11 ──────────────────────────────────────── */
function TerminalAnchorSection({ anchor, anchorTable, valuation, ke }: {
  anchor: V3AnalyticsBundle["anchorResult"];
  anchorTable: ReturnType<typeof computeAnchorTable>;
  valuation: ReturnType<typeof computeValuation>;
  ke: number;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§11 Terminal Value Anchoring</h3>
        <p className="text-xs text-slate-500">Anchor selection: three candidate RE values derived from the explicit series; selection driven by terminal period event flags.</p>
      </div>

      {/* Selected anchor banner */}
      <div className={`rounded-lg border p-3 text-sm ${anchor.terminal_event_flags.length === 0 ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
        <strong>Selected: {anchor.anchor_method}</strong> — RE anchor = {cr(anchor.selected_RE_anchor)}
        {anchor.terminal_event_flags.length > 0 && (
          <span className="ml-2 text-xs">({anchor.terminal_event_flags.join(", ")})</span>
        )}
      </div>

      {/* Terminal g */}
      <div className="bg-slate-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-600 mb-1">Terminal Growth Rate</p>
        <p className="text-lg font-bold text-slate-800">{pct(anchor.g_terminal)}</p>
        <p className="text-xs text-slate-500 mt-1">{anchor.g_source}</p>
        {anchor.g_terminal >= ke - 0.015 && (
          <p className="text-xs text-red-600 mt-1">⚠ g is close to ke ({pct(ke)}). Gordon formula becomes highly sensitive.</p>
        )}
      </div>

      {/* Anchor candidates table */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">§12.2 Anchor Sensitivity Table</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {["Anchor", "RE Level", "V(RE, CV3)", "TV Share"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {anchorTable.map((row) => (
                <tr
                  key={row.label}
                  className={`hover:bg-slate-50 ${row.anchor === anchor.selected_RE_anchor ? "bg-indigo-50 font-semibold" : ""}`}
                >
                  <td className="px-3 py-2 text-slate-700">
                    {row.anchor === anchor.selected_RE_anchor && <span className="text-indigo-600 mr-1">→</span>}
                    {row.label}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{cr(row.anchor)}</td>
                  <td className="px-3 py-2 text-right font-mono">{cr(row.V_RE_CV3)}</td>
                  <td className="px-3 py-2 text-right">{pct(row.tv_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Implied steady-state ROCE */}
      {valuation.CSE0 > 0 && (
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-600 mb-1">§11.7 Implied Steady-State ROCE</p>
          <p className="text-xs text-slate-500">ROCE_ss = ke + RE_anchor / CSE_latest</p>
          <p className="text-base font-bold text-slate-800 mt-1">
            {pct(ke + anchor.selected_RE_anchor / Math.max(valuation.CSE0, 1))}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Sensitivity Matrix §12 ───────────────────────────────────── */
function SensitivitySection({ matrix, baseKe, baseG }: {
  matrix: ReturnType<typeof computeSensitivityMatrix>;
  baseKe: number;
  baseG: number;
}) {
  const keVals = Array.from(new Set(matrix.map((r) => r.ke))).sort((a, b) => a - b);
  const gVals = Array.from(new Set(matrix.map((r) => r.g))).sort((a, b) => a - b);

  const lookup = (ke: number, g: number) =>
    matrix.find((r) => Math.abs(r.ke - ke) < 0.0001 && Math.abs(r.g - g) < 0.0001)?.V_RE_CV3 ?? null;

  const allVals = matrix.map((r) => r.V_RE_CV3);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);

  const heatColor = (v: number | null) => {
    if (v == null) return "bg-slate-100";
    const t = maxV > minV ? (v - minV) / (maxV - minV) : 0.5;
    if (t > 0.75) return "bg-emerald-100 text-emerald-800";
    if (t > 0.5) return "bg-blue-100 text-blue-800";
    if (t > 0.25) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§12.1 RE Sensitivity Matrix</h3>
        <p className="text-xs text-slate-500">V(RE, CV3) in ₹ Cr. Rows = cost of equity (ke); columns = terminal growth (g). Base case highlighted.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left text-slate-500 font-medium">ke \ g</th>
              {gVals.map((g) => (
                <th key={g} className={`px-3 py-2 text-center font-medium ${Math.abs(g - baseG) < 0.0001 ? "text-indigo-700 bg-indigo-50" : "text-slate-500"}`}>
                  {pct(g)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keVals.map((ke_i) => (
              <tr key={ke_i} className={Math.abs(ke_i - baseKe) < 0.0001 ? "bg-indigo-50" : "hover:bg-slate-50"}>
                <td className={`px-3 py-2 font-medium border-r border-slate-200 ${Math.abs(ke_i - baseKe) < 0.0001 ? "text-indigo-700" : "text-slate-600"}`}>
                  {pct(ke_i)}
                </td>
                {gVals.map((g_j) => {
                  const v = lookup(ke_i, g_j);
                  const isBase = Math.abs(ke_i - baseKe) < 0.0001 && Math.abs(g_j - baseG) < 0.0001;
                  return (
                    <td key={g_j} className={`px-3 py-2 text-center font-mono font-semibold ${isBase ? "ring-2 ring-indigo-400 ring-inset" : ""} ${heatColor(v)}`}>
                      {v != null ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Highlighted cell = base case. Heat: green = high, red = low relative to matrix range.</p>
    </div>
  );
}

/* ── Confidence Score §14 ─────────────────────────────────────── */
function ConfidenceSection({ conf, validation }: {
  conf: V3AnalyticsBundle["confidence"];
  validation: V3AnalyticsBundle["validation"];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§14 Composite Confidence Score</h3>
        <p className="text-xs text-slate-500">Weighted across 6 dimensions: separation quality, clean surplus, RE–ReOI convergence, Eq.16 closure, earnings persistence, terminal cleanliness.</p>
      </div>

      {/* Score header */}
      <div className={`rounded-xl border p-4 ${CONF_COLORS[conf.classification]}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold">{conf.composite.toFixed(1)}/100</p>
            <p className="text-sm font-semibold capitalize">{conf.classification.replace("_", " ")}</p>
          </div>
          <div className="text-4xl">
            {conf.classification === "HIGH" ? "✓" : conf.classification === "MODERATE" ? "◎" : conf.classification === "LOW" ? "⚠" : "✗"}
          </div>
        </div>
      </div>

      {/* Component bars */}
      <div className="space-y-3">
        {conf.components.map((c: ConfidenceComponent) => (
          <div key={c.name}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{c.name} <span className="text-slate-400 font-normal">(weight {c.weight})</span></span>
              <span className="text-slate-600 font-mono">{c.score.toFixed(0)}/100</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${c.score >= 80 ? "bg-emerald-500" : c.score >= 60 ? "bg-blue-500" : c.score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.max(2, c.score)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{c.detail}</p>
          </div>
        ))}
      </div>

      {/* Data validation summary */}
      {(validation.errors > 0 || validation.warnings > 0) && (
        <div className="border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">§2.5 Data Validation: {validation.errors} error(s), {validation.warnings} warning(s)</p>
          {validation.checks.filter((c) => !c.passed).map((c, i) => (
            <p key={i} className={`text-xs ${c.severity === "ERROR" ? "text-red-700" : "text-amber-600"}`}>
              • [{c.severity}] {c.description}{c.detail ? `: ${c.detail}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Triggers §15 ─────────────────────────────────────────────── */
function TriggersSection({ triggers, fadeParams }: {
  triggers: V3AnalyticsBundle["triggers"];
  fadeParams: V3AnalyticsBundle["fadeParams"];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§15.3 Monitoring Triggers</h3>
        <p className="text-xs text-slate-500">Auto-generated investment monitoring triggers derived from the analysis.</p>
      </div>

      <div className="space-y-3">
        {triggers.map((t) => (
          <div key={t.id} className="border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-indigo-700 mb-1">{t.title}</p>
            <p className="text-sm text-slate-700">{t.body}</p>
          </div>
        ))}
      </div>

      {/* §9.1 Fade parameter estimates */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">§9.1 Fade Parameter Estimates</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {["Driver", "φ (fade)", "Target", "Source", "R²"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fadeParams.map((fp) => (
                <tr key={fp.driver} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-700">{fp.driver}</td>
                  <td className="px-3 py-2 font-mono">{fp.phi.toFixed(3)}</td>
                  <td className="px-3 py-2 font-mono">{fp.driver === "PM" || fp.driver === "ATO" ? (fp.driver === "PM" ? pct(fp.target) : fp.target.toFixed(2) + "×") : pct(fp.target)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${fp.source === "COMPANY_SPECIFIC" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                      {fp.source === "COMPANY_SPECIFIC" ? "Company AR(1)" : "N&P Default"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-500">{fp.r_squared > 0 ? fp.r_squared.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-1">Company-specific AR(1) estimation requires ≥10 periods and R² &gt; 0.30, φ in (0.50, 0.98).</p>
      </div>
    </div>
  );
}

/* ── Accruals §5A (S-15.3) ────────────────────────────────────── */
function AccrualsSection({ rows }: { rows: AccrualTableRow[] }) {
  const REGIME_COLORS: Record<string, string> = {
    GROWTH_ACCRUAL: "text-blue-700 bg-blue-50",
    QUALITY_ACCRUAL: "text-red-700 bg-red-50",
    ASSET_DISPOSAL: "text-amber-700 bg-amber-50",
    CASH_GENERATION: "text-emerald-700 bg-emerald-50",
    CASH_ACCUMULATION: "text-purple-700 bg-purple-50",
    NORMAL: "text-slate-500 bg-slate-50",
  };
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§5A Accrual Regime Classification (S-15.3)</h3>
        <p className="text-xs text-slate-500">Balance sheet accrual ratios with regime context. Distinguishes growth accruals from quality concerns.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              {["Period", "BS Accrual Ratio", "Flag", "Regime", "Interpretation"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.period_end} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-slate-600">{row.period_end.slice(0, 7)}</td>
                <td className={`px-3 py-2 font-mono font-semibold ${row.bs_accrual_ratio != null && Math.abs(row.bs_accrual_ratio) > 0.10 ? "text-amber-700" : "text-slate-700"}`}>
                  {row.bs_accrual_ratio != null ? `${(row.bs_accrual_ratio * 100).toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2">{row.flag}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${REGIME_COLORS[row.regime] ?? "text-slate-500 bg-slate-50"}`}>
                    {row.regime}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{row.interpretation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">GROWTH_ACCRUAL = NOA expansion with revenue support (not a quality concern). QUALITY_ACCRUAL = elevated accruals without revenue backing (persistence risk).</p>
    </div>
  );
}

/* ── OA Decomposition §3B (S-15.1) ───────────────────────────── */
function OADecompSection({ decompositions }: { decompositions: OADecompositionResult[] }) {
  if (!decompositions.length) {
    return (
      <div className="text-sm text-slate-500 py-4">No OA decomposition periods selected (need ≥2 periods with structural events or terminal period).</div>
    );
  }
  const COMP_LABELS: Record<string, string> = {
    deltaPPE: "ΔPPE", deltaROU: "ΔROU", deltaInventory: "ΔInventory",
    deltaReceivables: "ΔReceivables", deltaGoodwill: "ΔGoodwill",
    deltaIntangibles: "ΔIntangibles", deltaCWIP: "ΔCWIP",
    deltaDTA: "ΔDTA", deltaOtherOA: "ΔOther OA",
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§3B OA Sub-Component Decomposition (S-15.1)</h3>
        <p className="text-xs text-slate-500">Decomposed for all structurally flagged periods and terminal period.</p>
      </div>
      {decompositions.map((d) => (
        <div key={d.period_end} className="border border-slate-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">{d.period_end.slice(0, 7)}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {Object.keys(COMP_LABELS).map((k) => (
                    <th key={k} className={`px-2 py-1 text-center font-medium ${k === "deltaOtherOA" ? "text-amber-600" : "text-slate-500"}`}>
                      {COMP_LABELS[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {Object.keys(COMP_LABELS).map((k) => {
                    const v = d.components[k as keyof typeof d.components];
                    return (
                      <td key={k} className={`px-2 py-1 text-center font-mono ${k === "deltaOtherOA" && Math.abs(v) > 500 ? "font-bold text-amber-700" : "text-slate-700"}`}>
                        {Math.abs(v) >= 1 ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {d.interpretation && (
            <p className="text-xs text-amber-700 mt-2 bg-amber-50 rounded px-2 py-1">{d.interpretation}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── RE/ReOI Gap Decomposition §6 (S-15.2) ───────────────────── */
function GapDecompSection({ gap }: { gap: ReReOIGapDecomposition }) {
  const rows = [
    { label: "Dirty surplus (PV)", value: gap.dirty_surplus },
    { label: "NFO timing", value: gap.nfo_timing },
    { label: "TV divergence (ke vs kw)", value: gap.tv_divergence },
    { label: "Explicit-period discounting", value: gap.explicit_period_discounting },
    { label: "Residual", value: gap.residual },
    { label: "Total gap", value: gap.total, bold: true },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§6 RE ↔ ReOI Gap Decomposition (S-15.2)</h3>
        <p className="text-xs text-slate-500">Exact four-component decomposition of the V_RE − V_ReOI valuation gap.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-slate-500 font-medium">Component</th>
              <th className="px-3 py-2 text-right text-slate-500 font-medium">₹ Crore</th>
              <th className="px-3 py-2 text-right text-slate-500 font-medium">% of total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.label} className={r.bold ? "bg-slate-50 font-semibold" : "hover:bg-slate-50"}>
                <td className={`px-3 py-2 ${r.label === "Dominant driver" || r.label === gap.dominant_driver.replace(/_/g, " ") ? "text-indigo-700" : "text-slate-700"}`}>
                  {r.label}
                  {r.label.replace(/ /g, "_").toLowerCase() === gap.dominant_driver ? " ★" : ""}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.value != null ? `₹${r.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">
                  {gap.total !== 0 && r.value != null ? `${((r.value / gap.total) * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-indigo-700">Primary driver: <span className="font-bold">{gap.dominant_driver.replace(/_/g, " ")}</span></p>
        <p className="text-xs text-indigo-600 mt-1">
          Under clean surplus, V_RE ≡ V_ReOI. The gap arises from: dirty surplus (OCI bypass), NFO timing,
          different discount rates (ke vs kw) in terminal and explicit periods.
        </p>
      </div>
    </div>
  );
}

/* ── Section 6B Per-Share (S-16.3) ───────────────────────────── */
function Section6BPanel({ s6b }: { s6b: Section6BResult }) {
  const fmt = (v: number | null) => v != null ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : "—";
  const pctFmt = (v: number | null) => v != null ? `${(v * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§6B Per-Share &amp; Market-Implied Checks (S-16.1–16.3)</h3>
        <p className="text-xs text-slate-500">
          {s6b.status === "empty" && "Share count unavailable from canonical data. Provide shares_outstanding in config."}
          {s6b.status === "partial" && `Shares derived: ${s6b.shares?.toLocaleString("en-IN")} Cr (${s6b.shares_source}). Provide market_price in config for full analytics.`}
          {s6b.status === "full" && `Full market-implied analytics. Shares: ${s6b.shares?.toLocaleString("en-IN")} Cr.`}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-slate-500 font-medium">Metric</th>
              <th className="px-3 py-2 text-right text-slate-500 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr><td className="px-3 py-2 text-slate-700">Shares outstanding</td><td className="px-3 py-2 text-right font-mono">{s6b.shares != null ? `${s6b.shares.toLocaleString("en-IN")} Cr` : "—"}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Share count source</td><td className="px-3 py-2 text-right text-xs text-slate-500 max-w-xs">{s6b.shares_source || "—"}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Share count confidence</td><td className="px-3 py-2 text-right"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s6b.shares_confidence === "HIGH" ? "bg-emerald-50 text-emerald-700" : s6b.shares_confidence === "MEDIUM" ? "bg-blue-50 text-blue-700" : s6b.shares_confidence === "LOW" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{s6b.shares_confidence}</span></td></tr>
            <tr className="font-semibold bg-indigo-50"><td className="px-3 py-2 text-indigo-700">RE intrinsic per share</td><td className="px-3 py-2 text-right font-mono text-indigo-800">{fmt(s6b.intrinsic_per_share)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Market price</td><td className="px-3 py-2 text-right font-mono">{fmt(s6b.market_price)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Market capitalisation</td><td className="px-3 py-2 text-right font-mono">{s6b.market_cap != null ? `₹${s6b.market_cap.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : "—"}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Margin of safety</td><td className={`px-3 py-2 text-right font-mono font-semibold ${s6b.margin_of_safety != null && s6b.margin_of_safety > 0 ? "text-emerald-700" : "text-red-700"}`}>{pctFmt(s6b.margin_of_safety)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">V(primary) / Market cap</td><td className="px-3 py-2 text-right font-mono">{pctFmt(s6b.v_primary_over_mcap)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Implied terminal growth g*</td><td className="px-3 py-2 text-right font-mono">{pctFmt(s6b.implied_g)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Implied ke</td><td className="px-3 py-2 text-right font-mono">{pctFmt(s6b.implied_ke)}</td></tr>
          </tbody>
        </table>
      </div>

      {s6b.mos_interpretation && (
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">{s6b.mos_interpretation}</div>
      )}
      {s6b.implied_g_note && (
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">{s6b.implied_g_note}</div>
      )}
      {s6b.implied_ke_note && (
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">{s6b.implied_ke_note}</div>
      )}
      {s6b.dilution_note && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          <span className="font-semibold">Dilution note: </span>{s6b.dilution_note}
        </div>
      )}
      {s6b.status !== "full" && (
        <div className="bg-slate-100 rounded-lg p-3 text-xs text-slate-500">
          To complete this section, set <code className="bg-white px-1 rounded">market_price</code> in analysis configuration.
        </div>
      )}
    </div>
  );
}

/* ── Moat Score ───────────────────────────────────────────────── */
function MoatSection({ moat }: { moat: MoatScoreResult | null }) {
  if (!moat) return <NullState message="Insufficient data for moat scoring (need ≥ 3 periods with RNOA)." />;

  const MOAT_COLORS: Record<string, string> = {
    wide: "text-emerald-700 bg-emerald-50 border-emerald-200",
    narrow: "text-blue-700 bg-blue-50 border-blue-200",
    none: "text-red-700 bg-red-50 border-red-200",
    "insufficient-data": "text-slate-500 bg-slate-50 border-slate-200",
  };
  const TREND_COLORS: Record<string, string> = {
    strengthening: "text-emerald-700",
    stable: "text-blue-700",
    eroding: "text-red-700",
    "insufficient-data": "text-slate-500",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Economic Moat Score</h3>
        <p className="text-xs text-slate-500">Buffett/Munger moat analysis operationalized through Penman-Nissim ratios. No qualitative inputs — the numbers speak for themselves.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Composite Score"
          value={`${moat.compositeScore}/100`}
          badge={moat.moatWidth.toUpperCase()}
          color={MOAT_COLORS[moat.moatWidth]}
        />
        <MetricCard
          label="Moat Trend"
          value={moat.moatTrend.replace("-", " ")}
          badge={`${moat.periodsAboveCostOfCapital}/${moat.totalPeriods} periods above kw`}
          color={TREND_COLORS[moat.moatTrend] + " bg-slate-50"}
        />
        <MetricCard
          label="Median RNOA"
          value={moat.medianRNOA != null ? pct(moat.medianRNOA) : "—"}
          badge={`SPREAD: ${moat.medianSPREAD != null ? pct(moat.medianSPREAD) : "—"}`}
          color="text-slate-700 bg-slate-50"
        />
        <MetricCard
          label="CAP Estimate"
          value={moat.cap.years != null ? `${moat.cap.years.toFixed(1)} yrs` : "—"}
          badge={moat.cap.confidence.toUpperCase()}
          color={moat.cap.confidence === "high" ? "text-emerald-700 bg-emerald-50" : moat.cap.confidence === "medium" ? "text-amber-700 bg-amber-50" : "text-slate-500 bg-slate-50"}
        />
      </div>

      {/* CAP detail */}
      <InfoBlock title="Competitive Advantage Period (CAP)">
        <InfoRow label="Method" value={moat.cap.method} />
        <InfoRow label="AR(1) phi" value={moat.cap.phi != null ? moat.cap.phi.toFixed(3) : "—"} />
        <InfoRow label="Latest RNOA" value={moat.cap.latestRNOA != null ? pct(moat.cap.latestRNOA) : "—"} />
        <InfoRow label="Fade target (kw)" value={pct(moat.cap.kw)} />
        <InfoRow label="Strong SPREAD periods (>5%)" value={`${moat.periodsWithStrongSpread} / ${moat.totalPeriods}`} />
      </InfoBlock>

      {/* Dimension breakdown */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">Dimension Scores</p>
        <div className="space-y-3">
          {moat.dimensions.map((dim: MoatDimension) => (
            <div key={dim.name} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">{dim.name}</span>
                <span className="text-xs font-bold text-slate-800">{dim.score.toFixed(0)}/100 <span className="text-slate-400 font-normal">(wt {(dim.weight * 100).toFixed(0)}%)</span></span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                <div
                  className={`h-1.5 rounded-full ${dim.score >= 70 ? "bg-emerald-500" : dim.score >= 40 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${dim.score}%` }}
                />
              </div>
              {dim.evidence.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">{e}</p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {moat.notes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {moat.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}

/* ── Capital Allocation ───────────────────────────────────────── */
function CapitalAllocSection({ ca }: { ca: CapAllocScoreResult | null }) {
  if (!ca) return <NullState message="Insufficient data for capital allocation scoring (need ≥ 3 periods)." />;

  const GRADE_BG: Record<string, string> = {
    A: "text-emerald-700 bg-emerald-50 border-emerald-200",
    B: "text-blue-700 bg-blue-50 border-blue-200",
    C: "text-amber-700 bg-amber-50 border-amber-200",
    D: "text-red-700 bg-red-50 border-red-200",
  };
  const TREND_COLOR: Record<string, string> = {
    improving: "text-emerald-700",
    stable: "text-blue-700",
    deteriorating: "text-red-700",
    "insufficient-data": "text-slate-500",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Capital Allocation Quality</h3>
        <p className="text-xs text-slate-500">Scores how well management deploys retained earnings — reinvestment returns, payout discipline, buyback timing, and dilution avoidance.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Composite Score"
          value={`${ca.compositeScore}/100`}
          badge={`Grade ${ca.grade}`}
          color={GRADE_BG[ca.grade]}
        />
        <MetricCard
          label="Trend"
          value={ca.trend.replace("-", " ")}
          badge={`${ca.totalPeriods} periods`}
          color={TREND_COLOR[ca.trend] + " bg-slate-50"}
        />
        <MetricCard
          label="Median FCF Conversion"
          value={ca.medianFCFConversion != null ? pct(ca.medianFCFConversion) : "—"}
          badge="FCF / CNI"
          color="text-slate-700 bg-slate-50"
        />
        <MetricCard
          label="Incremental ROIC"
          value={ca.medianIncrementalROIC != null ? pct(ca.medianIncrementalROIC) : "—"}
          badge="on new NOA"
          color="text-slate-700 bg-slate-50"
        />
      </div>

      <InfoBlock title="Payout & Issuance">
        <InfoRow label="Median payout ratio" value={ca.medianPayoutRatio != null ? pct(ca.medianPayoutRatio) : "—"} />
        <InfoRow label="Value-accretive buybacks" value={`${ca.buybacksValueAccretive} periods`} />
        <InfoRow label="Dilutive issuances" value={`${ca.dilutiveIssuances} periods`} />
      </InfoBlock>

      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">Dimension Scores</p>
        <div className="space-y-3">
          {ca.dimensions.map((dim: CapAllocDimension) => (
            <div key={dim.name} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">{dim.name}</span>
                <span className="text-xs font-bold text-slate-800">{dim.score.toFixed(0)}/100 <span className="text-slate-400 font-normal">(wt {(dim.weight * 100).toFixed(0)}%)</span></span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                <div
                  className={`h-1.5 rounded-full ${dim.score >= 70 ? "bg-emerald-500" : dim.score >= 40 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${dim.score}%` }}
                />
              </div>
              {dim.evidence.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">{e}</p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {ca.notes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {ca.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}

/* ── EPV (Graham-Dodd) ────────────────────────────────────────── */
function EPVSection({ epv }: { epv: EPVResult | null }) {
  if (!epv) return <NullState message="EPV requires ≥ 3 periods and market price + shares outstanding in config." />;

  const INTERP_COLORS: Record<string, string> = {
    "strong-franchise": "text-emerald-700 bg-emerald-50 border-emerald-200",
    "franchise": "text-blue-700 bg-blue-50 border-blue-200",
    "competitive": "text-amber-700 bg-amber-50 border-amber-200",
    "depressed-earnings": "text-orange-700 bg-orange-50 border-orange-200",
    "insufficient-data": "text-slate-500 bg-slate-50 border-slate-200",
  };
  const CONF_COLOR: Record<string, string> = {
    high: "text-emerald-700 bg-emerald-50",
    medium: "text-amber-700 bg-amber-50",
    low: "text-red-700 bg-red-50",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Earnings Power Value (Graham-Dodd)</h3>
        <p className="text-xs text-slate-500">EPV = Normalized NOPAT / WACC. Franchise value = EPV − Asset value. A strong franchise earns above its reproduction cost.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="EPV (Enterprise)"
          value={cr(epv.V_EPV)}
          badge={epv.interpretation.replace(/-/g, " ")}
          color={INTERP_COLORS[epv.interpretation]}
        />
        <MetricCard
          label="Asset Value (NOA)"
          value={cr(epv.V_A)}
          badge="Reproduction cost proxy"
          color="text-slate-700 bg-slate-50"
        />
        <MetricCard
          label="Franchise Value"
          value={cr(epv.franchiseValue)}
          badge={`${pct(epv.franchisePct)} of EPV`}
          color={epv.franchiseValue > 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}
        />
        <MetricCard
          label="Confidence"
          value={epv.confidence.toUpperCase()}
          badge={`WACC: ${pct(epv.kw)}`}
          color={CONF_COLOR[epv.confidence]}
        />
      </div>

      {(epv.epvPerShare != null || epv.marginOfSafety != null) && (
        <InfoBlock title="Per-Share & Market Comparison">
          {epv.epvPerShare != null && <InfoRow label="EPV per share" value={`₹${epv.epvPerShare.toFixed(1)}`} />}
          {epv.priceToEPV != null && <InfoRow label="Price / EPV" value={`${epv.priceToEPV.toFixed(2)}×`} />}
          {epv.marginOfSafety != null && <InfoRow label="Margin of safety" value={pct(epv.marginOfSafety)} />}
        </InfoBlock>
      )}

      <InfoBlock title="Normalization Details">
        <InfoRow label="Periods used" value={`${epv.normalization.periodsUsed}`} />
        <InfoRow label="Median CoreOI margin" value={pct(epv.normalization.medianCoreOIMargin)} />
        <InfoRow label="Normalized NOPAT" value={cr(epv.normalization.normalizedNOPAT)} />
        <InfoRow label="Median tax rate" value={pct(epv.normalization.medianTaxRate)} />
        <InfoRow label="Latest sales base" value={cr(epv.normalization.latestSales)} />
        <InfoRow label="Margin range" value={`${pct(epv.normalization.marginRange[0])} – ${pct(epv.normalization.marginRange[1])}`} />
        <InfoRow label="High confidence" value={epv.normalization.highConfidence ? "✓ Yes" : "⚠ No"} />
      </InfoBlock>

      {epv.confidenceNotes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {epv.confidenceNotes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}

/* ── Relative Valuation ───────────────────────────────────────── */
function RelativeValSection({ rv }: { rv: RelativeValuationResult | null }) {
  if (!rv) return <NullState message="Relative valuation requires market_price and shares_outstanding in config." />;

  const SIGNAL_COLORS: Record<string, string> = {
    cheap: "text-emerald-700 bg-emerald-50",
    fair: "text-blue-700 bg-blue-50",
    expensive: "text-red-700 bg-red-50",
    unknown: "text-slate-500 bg-slate-50",
  };

  function bandSignal(band: MultipleBand): string {
    if (band.currentPercentile == null) return "unknown";
    if (band.currentPercentile <= 25) return "cheap";
    if (band.currentPercentile >= 75) return "expensive";
    return "fair";
  }

  function BandRow({ band }: { band: MultipleBand }) {
    const signal = bandSignal(band);
    return (
      <div className="bg-slate-50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700">{band.metric}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SIGNAL_COLORS[signal]}`}>{signal.toUpperCase()}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs text-center">
          <div><p className="text-slate-400">Min</p><p className="font-medium text-slate-700">{band.min != null ? band.min.toFixed(1) : "—"}×</p></div>
          <div><p className="text-slate-400">Median</p><p className="font-medium text-slate-700">{band.median != null ? band.median.toFixed(1) : "—"}×</p></div>
          <div><p className="text-slate-400">Current</p><p className="font-bold text-slate-800">{band.current != null ? band.current.toFixed(1) : "—"}×</p></div>
          <div><p className="text-slate-400">Max</p><p className="font-medium text-slate-700">{band.max != null ? band.max.toFixed(1) : "—"}×</p></div>
        </div>
        {band.currentPercentile != null && (
          <div className="mt-2">
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${band.currentPercentile}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{band.currentPercentile}th percentile of history</p>
          </div>
        )}
        {band.sectorMedian != null && (
          <p className="text-xs text-slate-500 mt-1">
            Sector median: {band.sectorMedian.toFixed(1)}×
            {band.premiumToSector != null && ` (${band.premiumToSector > 0 ? "+" : ""}${pct(band.premiumToSector)} vs sector)`}
          </p>
        )}
        {band.impliedFairValue != null && (
          <p className="text-xs text-slate-500">Implied fair value: {cr(band.impliedFairValue)}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Relative Valuation</h3>
        <p className="text-xs text-slate-500">Historical multiple bands + sector comparison. Current multiple vs own history and sector peers.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Company Type"
          value={rv.companyType.toUpperCase()}
          badge="Metric selection basis"
          color="text-slate-700 bg-slate-50"
        />
        {rv.impliedFairValueComposite != null && (
          <MetricCard
            label="Composite Implied Value"
            value={cr(rv.impliedFairValueComposite)}
            badge={rv.marginOfSafety != null ? `MoS: ${pct(rv.marginOfSafety)}` : "No market price"}
            color={rv.marginOfSafety != null && rv.marginOfSafety > 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}
          />
        )}
      </div>

      {rv.primary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Primary Multiples</p>
          <div className="space-y-2">
            {rv.primary.map((b: MultipleBand) => <BandRow key={b.metric} band={b} />)}
          </div>
        </div>
      )}

      {rv.secondary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Secondary Multiples</p>
          <div className="space-y-2">
            {rv.secondary.map((b: MultipleBand) => <BandRow key={b.metric} band={b} />)}
          </div>
        </div>
      )}

      {rv.notes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {rv.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}

/* ── Null state helper ────────────────────────────────────────── */
function NullState({ message }: { message: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}

/* ── Shared subcomponents ─────────────────────────────────────── */
function MetricCard({ label, value, badge, color }: { label: string; value: string; badge: string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800 mb-1 truncate">{value}</p>
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{badge}</span>
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs font-semibold text-slate-600 mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}
