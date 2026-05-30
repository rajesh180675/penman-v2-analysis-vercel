import { EngineConfig, RecastPeriod } from "../../engine/types";
import { num, pct } from "./AcademicReport.formatters";
import { MiniBox } from "./AcademicUi";
import type { Valuation, V3Bundle, TerminalAnchor, AnchorTable, PeriodDiagnostics } from "./AcademicReport.types";

export function ValuationSynthesisSection(props: {
  ke: number;
  kw: number;
  kwMedian: number | null;
  config: EngineConfig;
  gBase: number;
  valuation: Valuation;
  reoiIdentityGap: number;
  reoiIdentityGapPct: number | null;
  v3Bundle: V3Bundle | null;
  valuationLegacyKw: Valuation;
  explicitHorizonYears: number;
  tvShare: number | null;
  tvGrade: string;
  eq16ResidualPp: number | null;
  eq16Tier: string;
  v3TerminalAnchor: TerminalAnchor;
  data: RecastPeriod[];
  g: number;
  gInput: number;
  bindingGCap: { label: string; value: number };
  tvContaminated: boolean;
  latest: RecastPeriod;
}) {
  const {
    ke, kw, kwMedian, config, gBase, valuation, reoiIdentityGap, reoiIdentityGapPct,
    v3Bundle, valuationLegacyKw, explicitHorizonYears, tvShare, tvGrade, eq16ResidualPp,
    eq16Tier, v3TerminalAnchor, data, g, gInput, bindingGCap, tvContaminated, latest,
  } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6) Valuation Synthesis (Residual Income Framework)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-4">
          <MiniBox label="ke assumption" value={pct(ke, 2)} />
          <MiniBox label="kw (derived, latest)" value={pct(kw, 2)} />
          <MiniBox label="kw (derived, median, historical artifact)" value={pct(kwMedian, 2)} />
          <MiniBox label="kw (legacy rf proxy)" value={pct(config.risk_free_rate, 2)} />
          <MiniBox label="Terminal growth g (effective)" value={pct(gBase, 2)} />
          <MiniBox label="Separation confidence" value={`${valuation.separationScore}/100`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-right">Zero CV</th>
                <th className="px-3 py-2 text-right">No-growth CV</th>
                <th className="px-3 py-2 text-right">Growth CV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-3 py-2">Equity RE (Eq.1/1a)</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_RE_CV1)} Cr</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_RE_CV2)} Cr</td>
                <td className="px-3 py-2 text-right font-semibold text-indigo-700">₹{num(valuation.V_RE_CV3)} Cr</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Operations-only ReOI (Eq.9)</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_ReOI_CV01)} Cr</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_ReOI_CV02)} Cr</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700">₹{num(valuation.V_ReOI_CV03)} Cr</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Interpretation: when separation confidence is low, the RE line should be treated as primary and ReOI as corroborative only. Identity check (CV3): |RE−ReOI| = ₹{num(reoiIdentityGap)} Cr ({pct(reoiIdentityGapPct)}). Gap decomposition — Dirty surplus PV: ₹{num(v3Bundle?.reReoiGapDecomposition.dirty_surplus)} Cr, NFO timing: ₹{num(v3Bundle?.reReoiGapDecomposition.nfo_timing)} Cr, TV divergence: ₹{num(v3Bundle?.reReoiGapDecomposition.tv_divergence)} Cr, Explicit-period discounting: ₹{num(v3Bundle?.reReoiGapDecomposition.explicit_period_discounting)} Cr, Residual: ₹{num(v3Bundle?.reReoiGapDecomposition.residual)} Cr. Primary driver: {v3Bundle?.reReoiGapDecomposition.dominant_driver ?? "—"}. Legacy rf-based ReOI CV3 was ₹{num(valuationLegacyKw.V_ReOI_CV03)} Cr.
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Explicit residual-income horizon used in valuation: <b>{explicitHorizonYears}</b> yearly steps. Terminal-value share of guarded RE CV3: <b>{pct(tvShare, 1)}</b> ({tvGrade}). Eq.16 residual (latest): <b>{eq16ResidualPp != null ? `${eq16ResidualPp.toFixed(2)}pp` : "—"}</b> [{eq16Tier}].
          {v3TerminalAnchor && <> [As-reported TV share: <b>{pct(v3TerminalAnchor.TV_share_raw, 1)}</b> ({v3TerminalAnchor.TV_grade_raw}).]</>}.
          {data[data.length-1]?.ratios?.eq16_diagnosis && (
            <span className="text-amber-700"> §5.7 Eq.16 diagnosis: {data[data.length-1]!.ratios!.eq16_diagnosis}</span>
          )}
        </p>
        {g < gInput && (
          <p className="text-xs text-amber-700 mt-1">
            Terminal growth capped at <b>{pct(g, 2)}</b> (input was {pct(gInput, 2)}). Binding constraint: <b>{bindingGCap.label}</b>.
          </p>
        )}
        {tvContaminated && (
          <p className="text-xs text-amber-700 mt-1">
            ⚠ Terminal period ({latest.period_end.slice(0, 4)}) shows structural-event indicators. Primary valuation uses RE_(T-1)+growth anchor; as-reported anchor is shown for reference.
          </p>
        )}
      </section>
  );
}

export function SensitivityMatrixSection(props: {
  sensitivityG: number[];
  sensitivityMatrix: Array<{ ke: number; values: number[] }>;
  v3TerminalAnchor: TerminalAnchor;
}) {
  const { sensitivityG, sensitivityMatrix, v3TerminalAnchor } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6A) RE sensitivity matrix (ke × g)</h2>
        <p className="text-xs text-slate-500 mb-3">Rows vary cost of equity; columns vary terminal growth. Values are V(RE, CV3) in ₹ Cr using derived kw for ReOI consistency checks.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">ke \ g</th>
                {sensitivityG.map((gCase, idx) => (
                  <th key={idx} className="px-3 py-2 text-right">{pct(gCase, 2)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sensitivityMatrix.map((row) => (
                <tr key={row.ke}>
                  <td className="px-3 py-2">{pct(row.ke, 1)}</td>
                  {row.values.map((v, idx) => (
                    <td key={idx} className="px-3 py-2 text-right">₹{num(v)} Cr</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v3TerminalAnchor && (
          <p className="text-xs text-slate-500 mt-2">
            Matrix uses guarded terminal anchor ({v3TerminalAnchor.label}, RE = ₹{num(v3TerminalAnchor.RE_value)} Cr).
            As-reported anchor (RE_T = ₹{num(v3TerminalAnchor.reference_RE_T)} Cr) would produce values approximately {(v3TerminalAnchor.V_total > 0 ? (v3TerminalAnchor.reference_V / v3TerminalAnchor.V_total) : 1).toFixed(2)}× higher across the grid.
          </p>
        )}
      </section>
  );
}

export function ResidualIncomeStreamSection(props: {
  valuation: Valuation;
  periodDiagnostics: PeriodDiagnostics;
}) {
  const { valuation, periodDiagnostics } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6A.1) Explicit residual-income stream</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">RE</th>
                <th className="px-2 py-1 text-right">ReOI</th>
                <th className="px-2 py-1 text-right">DS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {valuation.reSeries.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">₹{num(row.RE)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.ReOI)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(periodDiagnostics.find((p) => p.period === row.period)?.ds)} Cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );
}

export function TerminalSensitivitySection(props: {
  tvContaminated: boolean;
  anchorTable: AnchorTable;
  v3TerminalAnchor: TerminalAnchor;
  primaryValuation: number | null;
  valuation: Valuation;
}) {
  const { tvContaminated, anchorTable, v3TerminalAnchor, primaryValuation, valuation } = props;
  if (!tvContaminated) return null;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6A.2) Terminal sensitivity (alternate RE anchors)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">RE anchor</th>
                <th className="px-2 py-1 text-right">Value</th>
                <th className="px-2 py-1 text-right">TV share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {anchorTable.map((row) => (
                <tr key={row.label} className={v3TerminalAnchor?.label === row.label ? "bg-indigo-50" : ""}>
                  <td className="px-2 py-1">{row.label}{v3TerminalAnchor?.label === row.label ? " (selected)" : ""}</td>
                  <td className="px-2 py-1 text-right">₹{num(row.V_RE_CV3)} Cr</td>
                  <td className="px-2 py-1 text-right">{pct(row.tv_share, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-2">Primary value (contamination guard): <b>₹{num(primaryValuation)} Cr</b>. Reference as-reported CV3 value: <b>₹{num(v3TerminalAnchor?.reference_V ?? valuation.V_RE_CV3)} Cr</b>.</p>
      </section>
  );
}
