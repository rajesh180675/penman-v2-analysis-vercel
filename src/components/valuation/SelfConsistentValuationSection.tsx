import type { SelfConsistentValuationResult } from "../../engine/selfConsistentValuation";
import { fmt } from "./ValuationReport.formatters";
import { StatTile } from "./atoms";

const pct = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const rupees = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Self-consistent ReOI fade valuation (model 2026-09-scv-v1).
 *
 * An independent triangulation point: its own latest-anchored fade forecast,
 * with kw solved on VALUE weights jointly with the value it produces. Shows
 * the book-weighted kw beside it so the difference is inspectable, and the
 * persistence the market price would require.
 */
export default function SelfConsistentValuationSection({ result }: { result: SelfConsistentValuationResult }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Self-consistent ReOI fade valuation</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Independent model: RNOA's spread over kw fades at the firm's own estimated persistence (Nissim–Penman), and
          kw = (ke·(V<sub>E</sub>+MI) + kd·NFO)/V<sub>op</sub> is solved on value weights jointly with the value — not on book weights.
        </p>
      </div>
      {result.status === "skipped" ? (
        <div className="p-6 text-sm text-amber-800 bg-amber-50">Not computed: {result.reason}</div>
      ) : (
        <div className="p-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <StatTile label="Equity value / share" value={result.perShare != null ? `₹${result.perShare.toFixed(2)}` : rupees(result.equityValue)} />
            <StatTile label="Margin of safety" value={pct(result.marginOfSafety)} />
            <StatTile label="kw — value vs book weights" value={`${pct(result.kw.intrinsic, 2)} vs ${pct(result.kw.book, 2)}`} />
            <StatTile
              label="Persistence ω — history vs market"
              value={`${result.fade.omega.toFixed(2)} vs ${result.marketImpliedOmega != null ? result.marketImpliedOmega.toFixed(2) : "—"}`}
            />
          </div>

          <p className="text-xs text-slate-600">
            Anchored at <b>{result.anchorPeriod}</b>. Current core RNOA {pct(result.fade.rnoa0)} against kw {pct(result.kw.intrinsic)}
            {" "}(spread {pct(result.fade.spread0)}) fading at ω = {result.fade.omega.toFixed(2)}
            {result.fade.omegaSource === "company-shrunk"
              ? ` (AR(1) on ${result.fade.observations} years, bias-corrected and shrunk toward 0.7)`
              : " (prior — too little history)"}.
            {" "}kd {pct(result.kw.kd, 2)} ({result.kw.kdSource === "reported-nfe-over-nfo" ? "reported NFE/NFO" : "configured fallback"}),
            {" "}solved in {result.kw.iterations} iterations
            {result.kw.market != null ? `; on market-cap weights kw would be ${pct(result.kw.market, 2)}` : ""}.
            {result.marketImpliedOmega != null
              ? ` The market price requires the spread to persist at ω ≈ ${result.marketImpliedOmega.toFixed(2)} — compare with ${result.fade.omega.toFixed(2)} from history.`
              : result.kw.market != null
                ? " No persistence up to ω = 0.98 reconciles this model to the market price: the price implies more than a fading spread can deliver (or less than even no persistence)."
                : ""}
          </p>

          <div className="grid gap-6 md:grid-cols-2">
            <table className="w-full text-sm">
              <caption className="text-left text-xs font-semibold uppercase text-slate-500 pb-2">Value build (₹ Cr)</caption>
              <tbody className="divide-y divide-slate-100">
                <tr><td className="py-1.5 text-slate-600">Net operating assets (today)</td><td className="py-1.5 text-right font-mono">{rupees(result.decomposition.noa)}</td></tr>
                <tr><td className="py-1.5 text-slate-600">+ PV of explicit ReOI</td><td className="py-1.5 text-right font-mono">{rupees(result.decomposition.pvExplicitReOI)}</td></tr>
                <tr><td className="py-1.5 text-slate-600">+ PV of post-horizon ReOI</td><td className="py-1.5 text-right font-mono">{rupees(result.decomposition.pvTerminalReOI)}</td></tr>
                <tr className="font-semibold"><td className="py-1.5">= Operating value</td><td className="py-1.5 text-right font-mono">{rupees(result.operatingValue)}</td></tr>
                <tr><td className="py-1.5 text-slate-600">− Net financial obligations</td><td className="py-1.5 text-right font-mono">{rupees(result.decomposition.nfo)}</td></tr>
                <tr><td className="py-1.5 text-slate-600">− Minority interest</td><td className="py-1.5 text-right font-mono">{rupees(result.decomposition.minorityInterest)}</td></tr>
                <tr className="font-semibold"><td className="py-1.5">= Common equity value</td><td className="py-1.5 text-right font-mono">{rupees(result.equityValue)}</td></tr>
                <tr><td className="py-1.5 text-slate-500 text-xs">Post-horizon share of operating value</td><td className="py-1.5 text-right font-mono text-xs">{pct(result.decomposition.terminalShare)}</td></tr>
              </tbody>
            </table>

            <table className="w-full text-sm">
              <caption className="text-left text-xs font-semibold uppercase text-slate-500 pb-2">Sensitivity — value / share (kw re-solved per cell)</caption>
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1 text-left">ke \ ω</th>
                  {[...new Set(result.sensitivity.map((c) => c.omega))].map((omega) => (
                    <th key={omega} className="py-1 text-right font-mono">{omega.toFixed(2)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...new Set(result.sensitivity.map((c) => c.ke))].map((ke) => (
                  <tr key={ke}>
                    <td className="py-1.5 font-mono text-xs text-slate-600">{pct(ke)}</td>
                    {result.sensitivity.filter((c) => c.ke === ke).map((cell) => (
                      <td key={`${ke}-${cell.omega}`} className="py-1.5 text-right font-mono">
                        {cell.perShare != null ? `₹${cell.perShare.toFixed(0)}` : cell.equityValue != null ? fmt(cell.equityValue) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.warnings.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
