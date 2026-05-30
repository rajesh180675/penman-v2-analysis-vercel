export default function ContinuingValueFormulae({
  g,
  kwDerived,
}: {
  g: number;
  kwDerived: number;
}) {
  return (
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
  );
}
