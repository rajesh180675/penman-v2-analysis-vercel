/**
 * V3 Analytics Panel
 * Renders: §6 Dirty Surplus, §11 Terminal Anchoring, §13 Event Flags,
 *          §12 Sensitivity Matrix, §14 Confidence Score
 */
import { useMemo, useState } from "react";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { RecastPeriod, EngineConfig } from "../engine/types";
import { resolveCostOfCapitalFromConfig } from "../engine/costOfCapital";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { detectDistress } from "../engine/distressDetector";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import { SectionHeader } from "./shared/DesignSystem";
import {
  computeV3Analytics,
  computeSensitivityMatrix,
  computeAnchorTable,
  classifyTVShare,
  V3AnalyticsBundle,
} from "../engine/v3Analytics";

import type { ITServicesSignal } from "../engine/itServicesDetector";

import { OverviewSection } from "./v3-analytics/OverviewSection";
import { DirtySurplusSection } from "./v3-analytics/DirtySurplusSection";
import { EventFlagsSection } from "./v3-analytics/EventFlagsSection";
import { TerminalAnchorSection } from "./v3-analytics/TerminalAnchorSection";
import { SensitivitySection } from "./v3-analytics/SensitivitySection";
import { ConfidenceSection } from "./v3-analytics/ConfidenceSection";
import { TriggersSection } from "./v3-analytics/TriggersSection";
import { AccrualsSection } from "./v3-analytics/AccrualsSection";
import { OADecompSection } from "./v3-analytics/OADecompSection";
import { GapDecompSection } from "./v3-analytics/GapDecompSection";
import { Section6BPanel } from "./v3-analytics/Section6BPanel";
import { MoatSection } from "./v3-analytics/MoatSection";
import { CapitalAllocSection } from "./v3-analytics/CapitalAllocSection";
import { EPVSection } from "./v3-analytics/EPVSection";
import { RelativeValSection } from "./v3-analytics/RelativeValSection";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  traceabilitySummary?: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null | undefined;
  /** Phase E3 — IT-services signal for moat scorer awareness. */
  itServices?: ITServicesSignal | null | undefined;
}

export default function V3AnalyticsPanel({ data, config, traceability = null, traceabilitySummary: precomputedTraceabilitySummary = null, itServices = null }: Props) {
  const [activeSection, setActiveSection] = useState<"overview" | "dirty" | "events" | "terminal" | "sensitivity" | "confidence" | "triggers" | "accruals" | "oa_decomp" | "gap_decomp" | "section6b" | "moat" | "capital_alloc" | "epv" | "relative_val">("overview");
  const derivedTraceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(traceability),
    [traceability],
  );
  const traceabilitySummary = precomputedTraceabilitySummary ?? derivedTraceabilitySummary;

  // S-9.4C: one cost-of-equity derivation for the whole app, replacing the
  // parallel `ke_from_config` implementation. `computeV3Analytics` already
  // resolves its own capital cost through the resolver, so this surface was
  // reaching the same number by a second route.
  const ke = resolveCostOfCapitalFromConfig({ config }).ke;

  const { valuation, kw } = useMemo(() => {
    if (data.length < 2) return { valuation: null, kw: ke };
    const cur = data[data.length - 1]!;
    const prev = data[data.length - 2]!;
    const kw_derived = deriveKwFromStructure(cur, prev, ke, config.risk_free_rate, config);
    const g = config.g_terminal_override ?? 0.04;
    // First pass: compute without anchor to get RE series for terminal anchor computation
    const val0 = computeValuation(data, ke, kw_derived, g, config);
    return { valuation: val0, kw: kw_derived };
  }, [data, config, ke]);

  const bundle: V3AnalyticsBundle | null = useMemo(() => {
    if (!valuation) return null;
    const reoiCv03 = valuation.V_ReOI_CV03;
    const primaryAnchor = valuation.V_RE_CV3 ?? reoiCv03;
    if (primaryAnchor == null || reoiCv03 == null) return null;
    return computeV3Analytics(
      data, config,
      // Phase J2: fall back to V_ReOI_CV03 when equity-side is blocked,
      // but skip if the terminal denominator guard also invalidated CV03.
      primaryAnchor,
      reoiCv03,
      config.g_terminal_override,
      kw,
      itServices,
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
      <SectionHeader
        title="V3 Analytics"
        subtitle="Dirty surplus, terminal anchoring, accruals, event flags, and confidence scoring"
        icon="🔬"
      />

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
                className={`rounded-lg border p-3 text-sm ${b.tone === "danger"
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
              className={`px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${activeSection === t.id
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
