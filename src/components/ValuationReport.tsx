import { RecastPeriod, EngineConfig } from "../engine/types";
import { useState, useMemo } from "react";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { ke_from_config } from "../engine/types";
import { resolveValuationReadiness } from "../engine/valuationPolicy";
import { resolveShareBasis, toPerShare } from "../engine/shareCountTools";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell } from "recharts";

interface Props { data: RecastPeriod[]; config: EngineConfig }

type CVMethod = "CV1" | "CV2" | "CV3";

export default function ValuationReport({ data, config }: Props) {
  // S-9.4: ke from config (prefer explicit config.ke over rf+erp)
  const keFromConfig = ke_from_config(config);
  const valuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);
  const [keOverride, setKeOverride] = useState<number | null>(null);
  const [g, setG] = useState(config.g_terminal_override != null ? config.g_terminal_override * 100 : 4.0);
  const [cv, setCv] = useState<CVMethod>("CV3");

  if (data.length < 2) {
    return <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
      <p className="font-semibold text-amber-800 text-lg">Need ≥ 2 periods</p>
      <p className="text-amber-600 mt-1 text-sm">Upload more years of data to compute residual-income valuation.</p>
    </div>;
  }

  const ke = keOverride != null ? keOverride / 100 : keFromConfig;
  const gRate = g / 100;
  const shareBasis = useMemo(() => resolveShareBasis(data, config), [data, config]);
  const valuationData = useMemo(
    () => data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1)),
    [data, valuationReadiness.anchorIndex]
  );
  const valuationConfig = useMemo(
    () => shareBasis.valuationConfig,
    [shareBasis]
  );

  // S-9.4: kw ALWAYS derived — never a user input
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const kwDerived = useMemo(() => {
    const cur = valuationData[valuationData.length - 1];
    const prev = valuationData[valuationData.length - 2];
    return deriveKwFromStructure(cur, prev, ke, config.risk_free_rate, config);
  }, [valuationData, ke, config]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const val = useMemo(() =>
    computeValuation(valuationData, ke, kwDerived, gRate, valuationConfig),
    [valuationData, ke, kwDerived, gRate, valuationConfig]
  );

  const cvSel = (v1: number, v2: number, v3: number) => cv === "CV1" ? v1 : cv === "CV2" ? v2 : v3;
  const V_RE   = cvSel(val.V_RE_CV1,   val.V_RE_CV2,   val.V_RE_CV3);
  const V_ReOI = cvSel(val.V_ReOI_CV01, val.V_ReOI_CV02, val.V_ReOI_CV03);

  const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const fmtPerShare = (n: number | null | undefined) => n == null ? "—" : `₹${n.toFixed(2)}`;

  // S-9.8: per-share
  const sharesOut = shareBasis.shares ?? null;

  const barData = val.reSeries.map((r) => ({
    period: r.period.slice(0, 7),
    RE:   +(toPerShare(r.RE, sharesOut) ?? r.RE).toFixed(2),
    ReOI: +(toPerShare(r.ReOI, sharesOut) ?? r.ReOI).toFixed(2),
  }));

  return (
    <div className="space-y-8">
      {/* Inputs — S-9.4: kw is derived, not user input */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-5">Valuation Inputs (§6)</h2>
        <div className="flex flex-wrap gap-6 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cost of Equity ke (%)</label>
            <div className="flex items-center gap-2">
              <input type="number" step={0.5}
                value={keOverride != null ? keOverride : +(keFromConfig * 100).toFixed(1)}
                onChange={(e) => setKeOverride(Number(e.target.value))}
                className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white" />
              {keOverride != null && (
                <button onClick={() => setKeOverride(null)}
                  className="text-xs text-slate-400 hover:text-indigo-600 underline">reset</button>
              )}
            </div>
            {keOverride == null && (
              <p className="text-xs text-slate-400 mt-0.5">
                {config.ke > 0 ? `explicit: ${(config.ke*100).toFixed(1)}%` : `rf+erp = ${(keFromConfig*100).toFixed(1)}%`}
              </p>
            )}
          </div>

          {/* S-9.4: kw DERIVED — read-only */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">WACC kw — derived (S-9.4)</label>
            <div className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-700 font-mono font-semibold">
              {(kwDerived * 100).toFixed(2)}%
            </div>
            <p className="text-xs text-slate-400 mt-0.5">NOA-weighted · kd_at=kd×(1−τ)</p>
          </div>

          <NumInput label="Growth g (%)" value={g} onChange={setG} />

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Continuing Value</label>
            <select value={cv} onChange={(e) => setCv(e.target.value as CVMethod)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="CV1">CV1 — Zero (conservative)</option>
              <option value="CV2">CV2 — Perpetuity, no growth</option>
              <option value="CV3">CV3 — Gordon growth</option>
            </select>
          </div>
        </div>

        {sharesOut != null && (
          <div className="mt-3 text-xs text-slate-500 space-y-1">
            <div>Share basis: <b>{sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares</b></div>
            <div>Source: <b>{shareBasis.source}</b> · Confidence: <b>{shareBasis.confidence}</b></div>
          </div>
        )}

        {val.lowConfidence && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            ⚠ Separation Confidence Score = {val.separationScore}/100 &lt; threshold.
            Operating/Financing separation may be unreliable. Prefer RE approach (not ReOI).
          </div>
        )}

        {valuationReadiness.status !== "production-ready" && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <b>Guarded valuation mode.</b> {valuationReadiness.reasons[0]}
            <div className="mt-1">
              Anchor period: <b>{valuationReadiness.anchorPeriod?.slice(0, 10) ?? "n/a"}</b>
              {" "}· Latest source period: <b>{valuationReadiness.latestPeriod?.slice(0, 10) ?? "n/a"}</b>
            </div>
          </div>
        )}
      </div>

      {/* Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ValCard color="indigo" title={`V (RE · ${cv})`} subtitle="Eq.(1a) · Clean surplus" value={V_RE}
          items={[
            { l: "CSE₀ (base book value)", v: val.CSE0 },
            { l: "PV of RE series", v: val.pvRE },
            { l: `CV PV (${cv})`, v: V_RE - val.CSE0 - val.pvRE },
          ]} fmt={fmt}
          perShare={toPerShare(V_RE, sharesOut)}
        />
        <ValCard color="emerald" title={`V (ReOI · ${cv === "CV1" ? "CV01" : cv === "CV2" ? "CV02" : "CV03"})`}
          subtitle="Eq.(9) · Ops-only · EV−NFO" value={V_ReOI}
          items={[
            { l: "EV (NOA₀ + PV ReOI + CV)", v: val.EV_ReOI },
            { l: "Less: NFO (latest)", v: -val.NFO_latest },
            { l: "PV ReOI", v: val.pvReOI },
          ]} fmt={fmt}
          perShare={toPerShare(V_ReOI, sharesOut)}
        />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">All CV Methods — RE</div>
          {[
            { label: "CV1 (zero)", v: val.V_RE_CV1 },
            { label: "CV2 (perp.)", v: val.V_RE_CV2 },
            { label: "CV3 (growth)", v: val.V_RE_CV3 },
          ].map((row) => (
            <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
              <span className="text-slate-600">{row.label}</span>
              <span className="font-mono font-semibold text-indigo-700">
                {sharesOut ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share` : `₹${fmt(row.v)} Cr`}
              </span>
            </div>
          ))}
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-3">All CV Methods — ReOI</div>
          {[
            { label: "CV01 (zero)", v: val.V_ReOI_CV01 },
            { label: "CV02 (perp.)", v: val.V_ReOI_CV02 },
            { label: "CV03 (growth)", v: val.V_ReOI_CV03 },
          ].map((row) => (
            <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
              <span className="text-slate-600">{row.label}</span>
              <span className="font-mono font-semibold text-emerald-700">
                {sharesOut ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share` : `₹${fmt(row.v)} Cr`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Triangulation */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Valuation Triangulation (v3)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Per-share value is primary. Company totals remain as context in ₹ Cr.</p>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Model</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Per Share (₹)</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Value (₹ Cr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["RE (CV3)", val.V_RE_CV3, val.perShare?.intrinsic_re_per_share ?? null],
                ["ReOI (CV03)", val.V_ReOI_CV03, val.perShare?.intrinsic_reoi_per_share ?? null],
                ["FCFF", val.fcf?.EV_FCFF != null ? (val.fcf.EV_FCFF - val.NFO_latest) : null, val.perShare?.intrinsic_fcff_per_share ?? null],
                ["FCFE", val.fcf?.V_FCFE ?? null, val.perShare?.intrinsic_fcfe_per_share ?? null],
                ["DDM", val.perShare?.intrinsic_ddm_per_share != null && sharesOut ? val.perShare.intrinsic_ddm_per_share * sharesOut : null, val.perShare?.intrinsic_ddm_per_share ?? null],
                ["AEG", val.aeg?.V_AEG ?? null, val.perShare?.intrinsic_aeg_per_share ?? null],
              ].map(([name, v, ps]) => (
                <tr key={name as string}>
                  <td className="px-3 py-2 text-slate-700">{name as string}</td>
                  <td className="px-3 py-2 text-right font-mono">{typeof ps === "number" ? `₹${ps.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{typeof v === "number" ? `₹${fmt(v)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {val.perShare?.implied_growth_rate != null && (
            <p className="text-xs text-slate-500 mt-3">
              Reverse DCF implied growth: <b>{(val.perShare.implied_growth_rate * 100).toFixed(2)}%</b>
            </p>
          )}
        </div>
      </div>

      {/* OJ / AEG */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">OJ / AEG Integration (A-05)</h2>
        </div>
        <div className="p-6">
          {val.aeg?.aeg_series?.length ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {[
                  { l: "V_AEG", v: sharesOut ? `${fmtPerShare(toPerShare(val.aeg.V_AEG, sharesOut))} / share` : `₹${fmt(val.aeg.V_AEG)} Cr` },
                  { l: "Implied P/E", v: val.aeg.implied_pe != null ? `${val.aeg.implied_pe.toFixed(2)}x` : "—" },
                  { l: "Normalised P/E", v: val.aeg.normalised_pe != null ? `${val.aeg.normalised_pe.toFixed(2)}x` : "—" },
                ].map(({ l, v }) => (
                  <div key={l} className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                    <div className="text-xs uppercase text-slate-500">{l}</div>
                    <div className="text-xl font-bold text-slate-800">{v}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Period</th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">CNI</th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">AEG</th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">PV(AEG)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {val.aeg.aeg_series.map((r) => (
                      <tr key={r.period}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.period.slice(0, 7)}</td>
                        <td className="px-3 py-2 text-right font-mono">{sharesOut ? fmtPerShare(toPerShare(r.CNI, sharesOut)) : fmt(r.CNI)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${r.AEG >= 0 ? "text-emerald-700" : "text-red-700"}`}>{sharesOut ? fmtPerShare(toPerShare(r.AEG, sharesOut)) : fmt(r.AEG)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${r.PV_AEG >= 0 ? "text-emerald-700" : "text-red-700"}`}>{sharesOut ? fmtPerShare(toPerShare(r.PV_AEG, sharesOut)) : fmt(r.PV_AEG)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={val.aeg.aeg_series.map((r) => ({ period: r.period.slice(0, 7), AEG: +r.AEG.toFixed(0), PV: +r.PV_AEG.toFixed(0) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Bar dataKey="AEG" fill="#7c3aed" />
                  <Bar dataKey="PV" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="text-sm text-slate-500">Insufficient periods for AEG series (needs at least 3 periods).</div>
          )}
        </div>
      </div>

      {/* Residual Income Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Residual Income Series</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            RE = CNI − ke×CSE₍t−1₎  |  ReOI = OI − kw×NOA₍t−1₎  |  §6.1–6.2
            {sharesOut ? ` · Rendered on a per-share basis using ${sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares.` : " · Rendered in ₹ Cr until a share basis is available."}
          </p>
        </div>
        <div className="p-6">
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b">
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Period</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "CNI / share" : "CNI"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "ke×CSE₋₁ / share" : "ke×CSE₋₁"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-indigo-500 uppercase">{sharesOut ? "RE / share" : "RE"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "OI / share" : "OI"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "kw×NOA₋₁ / share" : "kw×NOA₋₁"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-emerald-500 uppercase">{sharesOut ? "ReOI / share" : "ReOI"}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {val.reSeries.map((r, i) => {
                  const cur  = data[i + 1];
                  const prev = data[i];
                  if (!cur || !prev) return null;
                  const cni = toPerShare(cur.is.CNI, sharesOut) ?? cur.is.CNI;
                  const equityCharge = toPerShare(ke * prev.bs.CSE, sharesOut) ?? (ke * prev.bs.CSE);
                  const re = toPerShare(r.RE, sharesOut) ?? r.RE;
                  const oi = toPerShare(cur.is.OI, sharesOut) ?? cur.is.OI;
                  const noaCharge = toPerShare(kwDerived * prev.bs.NOA, sharesOut) ?? (kwDerived * prev.bs.NOA);
                  const reoi = toPerShare(r.ReOI, sharesOut) ?? r.ReOI;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-600 text-sm">{r.period.slice(0, 7)}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{sharesOut ? fmtPerShare(cni) : cur.is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{sharesOut ? fmtPerShare(equityCharge) : (ke * prev.bs.CSE).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-indigo-700 text-sm">{sharesOut ? fmtPerShare(re) : fmt(r.RE)}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{sharesOut ? fmtPerShare(oi) : cur.is.OI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{sharesOut ? fmtPerShare(noaCharge) : (kwDerived * prev.bs.NOA).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700 text-sm">{sharesOut ? fmtPerShare(reoi) : fmt(r.ReOI)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { key: "RE" as const, label: "Residual Earnings (RE)", color: "#6366f1" },
                { key: "ReOI" as const, label: "Residual Op. Income (ReOI)", color: "#10b981" },
              ].map(({ key, label, color }) => (
                <div key={key} className="border border-slate-100 rounded-xl p-4">
                  <div className="text-xs font-semibold text-slate-500 mb-3 uppercase">{label} {sharesOut ? "(₹ / share)" : "(₹ Cr)"}</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <Bar dataKey={key}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={entry[key] >= 0 ? color : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* S-9.7: Sensitivity Grid — columns strictly ascending by g */}
      <SensitivityGrid ke={ke} gRate={gRate} val={val} sharesOut={sharesOut} fmt={fmt} />

      {/* CV formulae + kw note */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-sm">
        <h3 className="font-semibold text-slate-800 mb-3">Continuing Value Formulae (§6.1–6.2)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs mb-3">
          {[
            { t: "CV1 / CV01 — Zero", f: "CV = 0", d: "Conservative. No terminal value." },
            { t: "CV2 / CV02 — Perpetuity", f: "CV = RE₍T₎ / (ρ−1)", d: "Steady state, zero growth." },
            { t: "CV3 / CV03 — Gordon Growth", f: "CV = RE₍T₎×(1+g) / (ρ−1−g)", d: `g = ${g.toFixed(1)}%` },
          ].map((c) => (
            <div key={c.t} className="bg-white p-3 rounded-lg border border-slate-100">
              <div className="font-bold text-slate-700 mb-1 font-sans text-xs">{c.t}</div>
              <div className="text-indigo-600">{c.f}</div>
              <div className="text-slate-400 mt-1 font-sans">{c.d}</div>
            </div>
          ))}
        </div>
        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
          <b>S-9.4 — kw derivation:</b> kw = (NOA/EV)×ke + (NFO/EV)×kd_aftertax, where kd_aftertax = kd_pretax×(1−τ_kd).
          Derived kw = <b>{(kwDerived * 100).toFixed(2)}%</b>. kw is never a user input.
        </div>
      </div>
    </div>
  );
}

/** S-9.7: Sensitivity grid with columns strictly sorted ascending by g */
function SensitivityGrid({
  ke, gRate, val, sharesOut, fmt
}: {
  ke: number; gRate: number;
  val: ReturnType<typeof computeValuation>;
  sharesOut: number | null;
  fmt: (n: number) => string;
}) {
  // S-9.7: columns must be monotonically ascending by g
  const KES = [0.08, 0.10, 0.12, 0.14, 0.16];
  const GS  = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]; // already ascending
  const T   = val.reSeries.length;
  const lastRE = T > 0 ? val.reSeries[T - 1].RE : 0;

  const computeV = (keV: number, gv: number): number | null => {
    if (keV - gv <= 0.001) return null;
    const cv3 = lastRE * (1 + gv) / (keV - gv);
    const disc = Math.pow(1 + keV, T);
    return val.CSE0 + val.pvRE + cv3 / disc;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">Sensitivity Grid — V_RE_CV3 (S-9.7)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {sharesOut != null
            ? "Per-share values across ke × g using the resolved share basis. Company totals are shown below for context."
            : "₹ Cr across ke × g. Columns strictly ascending by g (S-9.7). Base highlighted."}
        </p>
      </div>
      <div className="p-6 overflow-x-auto space-y-5">
        {sharesOut != null && sharesOut > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Per Share (₹) — {sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares</div>
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-left border">ke ↓ / g →</th>
                  {GS.map(gv => (
                    <th key={gv} className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-right border">{(gv*100).toFixed(0)}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KES.map(keV => (
                  <tr key={keV}>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600 border bg-slate-50">ke={(keV*100).toFixed(0)}%</td>
                    {GS.map(gv => {
                      const v = computeV(keV, gv);
                      const ps = toPerShare(v, sharesOut);
                      const isBase = Math.abs(keV - ke) < 0.005 && Math.abs(gv - gRate) < 0.005;
                      if (ps == null) return <td key={gv} className="px-3 py-2 text-center text-xs text-slate-400 border">—</td>;
                      return (
                        <td key={gv} className={`px-3 py-2 text-right font-mono text-xs border ${isBase ? "bg-indigo-100 font-bold text-indigo-800" : "text-slate-700"}`}>
                          ₹{ps.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Value (₹ Cr)</div>
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-left border">ke ↓ / g →</th>
                {GS.map(gv => (
                  <th key={gv} className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-right border">{(gv*100).toFixed(0)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KES.map(keV => (
                <tr key={keV}>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600 border bg-slate-50">ke={(keV*100).toFixed(0)}%</td>
                  {GS.map(gv => {
                    const v = computeV(keV, gv);
                    const isBase = Math.abs(keV - ke) < 0.005 && Math.abs(gv - gRate) < 0.005;
                    if (v == null) return <td key={gv} className="px-3 py-2 text-center text-xs text-slate-400 border">—</td>;
                    return (
                      <td key={gv} className={`px-3 py-2 text-right font-mono text-xs border ${isBase ? "bg-indigo-100 font-bold text-indigo-800" : v > 0 ? "text-slate-700" : "text-red-500"}`}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type="number" step={0.5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white" />
    </div>
  );
}

function ValCard({ color, title, subtitle, value, items, fmt, perShare }: {
  color: "indigo" | "emerald"; title: string; subtitle: string; value: number;
  items: Array<{ l: string; v: number }>; fmt: (n: number) => string;
  perShare?: number | null;
}) {
  const bg  = color === "indigo" ? "bg-indigo-50 border-indigo-200" : "bg-emerald-50 border-emerald-200";
  const hdr = color === "indigo" ? "bg-indigo-100 text-indigo-900" : "bg-emerald-100 text-emerald-900";
  const vc  = color === "indigo" ? "text-indigo-700" : "text-emerald-700";
  return (
    <div className={`rounded-2xl border ${bg} overflow-hidden`}>
      <div className={`px-5 py-4 ${hdr}`}>
        <h3 className="font-bold">{title}</h3>
        <p className="text-xs opacity-70 mt-0.5">{subtitle}</p>
      </div>
      <div className="p-5">
        {perShare != null ? (
          <>
            <div className={`text-3xl font-bold ${vc} mb-1`}>₹{perShare.toFixed(2)} / share</div>
            <div className="text-sm text-slate-500 mb-3">₹{fmt(value)} Cr total equity value</div>
          </>
        ) : (
          <div className={`text-3xl font-bold ${vc} mb-3`}>₹{fmt(value)} Cr</div>
        )}
        {items.map((b, i) => (
          <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600 text-xs">{b.l}</span>
            <span className="font-mono font-semibold text-slate-800">{fmt(b.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
