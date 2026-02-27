import { RecastPeriod, EngineConfig } from "../engine/types";
import { useState, useMemo } from "react";
import { computeValuation } from "../engine/PenmanNissimEngine";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell } from "recharts";

interface Props { data: RecastPeriod[]; config: EngineConfig }

type CVMethod = "CV1" | "CV2" | "CV3";

export default function ValuationReport({ data, config }: Props) {
  const [Ke, setKe] = useState(10.0);
  const [Kw, setKw] = useState(8.0);
  const [g,  setG]  = useState(3.0);
  const [cv, setCv] = useState<CVMethod>("CV3");

  if (data.length < 2) {
    return <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
      <p className="font-semibold text-amber-800 text-lg">Need ≥ 2 periods</p>
      <p className="text-amber-600 mt-1 text-sm">Upload more years of data to compute residual-income valuation.</p>
    </div>;
  }

  const ke = Ke / 100, kw = Kw / 100, gRate = g / 100;

  const val = useMemo(() =>
    computeValuation(data, ke, kw, gRate, config),
    [data, ke, kw, gRate, config]
  );

  const cvSel = (v1: number, v2: number, v3: number) => cv === "CV1" ? v1 : cv === "CV2" ? v2 : v3;
  const V_RE   = cvSel(val.V_RE_CV1,   val.V_RE_CV2,   val.V_RE_CV3);
  const V_ReOI = cvSel(val.V_ReOI_CV01, val.V_ReOI_CV02, val.V_ReOI_CV03);

  const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  const barData = val.reSeries.map((r) => ({
    period: r.period.slice(0, 7),
    RE:   +r.RE.toFixed(0),
    ReOI: +r.ReOI.toFixed(0),
  }));

  return (
    <div className="space-y-8">
      {/* Inputs */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-5">Valuation Inputs (§6)</h2>
        <div className="flex flex-wrap gap-6 items-end">
          <NumInput label="Cost of Equity ke (%)" value={Ke} onChange={setKe} />
          <NumInput label="WACC kw (%)"           value={Kw} onChange={setKw} />
          <NumInput label="Growth g (%)"          value={g}  onChange={setG}  />
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
        {val.lowConfidence && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            ⚠ Separation Confidence Score = {val.separationScore}/100 &lt; threshold.
            Operating/Financing separation may be unreliable. Prefer RE approach (not ReOI).
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
          ]} fmt={fmt} />
        <ValCard color="emerald" title={`V (ReOI · ${cv === "CV1" ? "CV01" : cv === "CV2" ? "CV02" : "CV03"})`}
          subtitle="Eq.(9) · Ops-only · EV−NFO" value={V_ReOI}
          items={[
            { l: "EV (NOA₀ + PV ReOI + CV)", v: val.EV_ReOI },
            { l: "Less: NFO (latest)", v: -val.NFO_latest },
            { l: "PV ReOI", v: val.pvReOI },
          ]} fmt={fmt} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">All CV Methods — RE</div>
          {[
            { label: "CV1 (zero)", v: val.V_RE_CV1 },
            { label: "CV2 (perp.)", v: val.V_RE_CV2 },
            { label: "CV3 (growth)", v: val.V_RE_CV3 },
          ].map((row) => (
            <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
              <span className="text-slate-600">{row.label}</span>
              <span className="font-mono font-semibold text-indigo-700">₹{fmt(row.v)}</span>
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
              <span className="font-mono font-semibold text-emerald-700">₹{fmt(row.v)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Residual Income Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Residual Income Series</h2>
          <p className="text-xs text-slate-500 mt-0.5">RE = CNI − ke×CSE₍t−1₎  |  ReOI = OI − kw×NOA₍t−1₎  |  §6.1–6.2</p>
        </div>
        <div className="p-6">
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b">
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Period</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">CNI</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">ke×CSE₋₁</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-indigo-500 uppercase">RE</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">OI</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">kw×NOA₋₁</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-emerald-500 uppercase">ReOI</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {val.reSeries.map((r, i) => {
                  const cur  = data[i + 1];
                  const prev = data[i];
                  if (!cur || !prev) return null;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-600 text-sm">{r.period.slice(0, 7)}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{cur.is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{(ke * prev.bs.CSE).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-indigo-700 text-sm">{fmt(r.RE)}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{cur.is.OI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{(kw * prev.bs.NOA).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700 text-sm">{fmt(r.ReOI)}</td>
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
                <div className="text-xs font-semibold text-slate-500 mb-3 uppercase">{label} (₹ Cr)</div>
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

      {/* CV formulae */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-sm">
        <h3 className="font-semibold text-slate-800 mb-3">Continuing Value Formulae (paper §6.1–6.2)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          {[
            { t: "CV1 / CV01 — Zero", f: "CV = 0", d: "Conservative. No terminal value." },
            { t: "CV2 / CV02 — Perpetuity", f: "CV = RE₍T₎ / (ρ−1)", d: "Steady state, zero growth." },
            { t: "CV3 / CV03 — Gordon Growth", f: "CV = RE₍T₎×(1+g) / (ρ−1−g)", d: `g = ${g}% | Sensitive to g.` },
          ].map((c) => (
            <div key={c.t} className="bg-white p-3 rounded-lg border border-slate-100">
              <div className="font-bold text-slate-700 mb-1 font-sans text-xs">{c.t}</div>
              <div className="text-indigo-600">{c.f}</div>
              <div className="text-slate-400 mt-1 font-sans">{c.d}</div>
            </div>
          ))}
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

function ValCard({ color, title, subtitle, value, items, fmt }: {
  color: "indigo" | "emerald"; title: string; subtitle: string; value: number;
  items: Array<{ l: string; v: number }>; fmt: (n: number) => string;
}) {
  const bg  = color === "indigo" ? "bg-indigo-50 border-indigo-200" : "bg-emerald-50 border-emerald-200";
  const hdr = color === "indigo" ? "bg-indigo-100 text-indigo-900" : "bg-emerald-100 text-emerald-900";
  const val = color === "indigo" ? "text-indigo-700" : "text-emerald-700";
  return (
    <div className={`rounded-2xl border ${bg} overflow-hidden`}>
      <div className={`px-5 py-4 ${hdr}`}>
        <h3 className="font-bold">{title}</h3>
        <p className="text-xs opacity-70 mt-0.5">{subtitle}</p>
      </div>
      <div className="p-5">
        <div className={`text-3xl font-bold ${val} mb-4`}>₹{fmt(value)} Cr</div>
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
