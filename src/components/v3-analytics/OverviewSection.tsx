/* ── Overview ─────────────────────────────────────────────────── */
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { classifyTVShare, V3AnalyticsBundle } from "../../engine/v3Analytics";
import { pct, cr, CONF_COLORS, GRADE_COLORS } from "./v3Formatters";
import { MetricCard, InfoBlock, InfoRow } from "./SharedUI";

export function OverviewSection({ bundle, valuation, tvClass }: {
  bundle: V3AnalyticsBundle;
  valuation: ReturnType<typeof computeValuation>;
  tvClass: ReturnType<typeof classifyTVShare>;
}) {
  const { confidence, anchorResult, dirtySurplus, periodFlags } = bundle;
  const totalFlags = periodFlags.reduce((s, p) => s + p.flags.length, 0);
  // Phase J2: V_RE_CV3 may be null on negative-equity companies. Use
  // V_ReOI_CV03 as the identity-gap reference when equity-side is blocked
  // so the panel stays renderable instead of crashing the overview.
  const reoiCv03 = valuation.V_ReOI_CV03;
  const reAnchor = valuation.V_RE_CV3 ?? reoiCv03;
  const identityGap = reAnchor != null && reoiCv03 != null ? Math.abs(reAnchor - reoiCv03) : null;
  const identityGapPct = reAnchor != null && reAnchor !== 0 && identityGap != null ? identityGap / Math.abs(reAnchor) : 0;
  const identityFlag = identityGap == null ? "WARNING" : identityGapPct < 0.05 ? "CONVERGED" : identityGapPct < 0.15 ? "WARNING" : "CRITICAL";

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
          color={CONF_COLORS[confidence.classification]!}
        />
        <MetricCard
          label="TV Share (RE CV3)"
          value={pct(tvClass.tv_share)}
          badge={tvClass.tv_grade}
          color={GRADE_COLORS[tvClass.tv_grade]!}
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
