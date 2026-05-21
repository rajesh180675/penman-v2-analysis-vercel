/**
 * Compounder Test (Industrial)
 *
 * Buffett's quality screen for "wonderful businesses":
 *   1. ROIC consistently > 15% (high return on invested capital)
 *   2. ROIC > WACC (creates value, doesn't destroy it)
 *   3. Reinvestment rate sustained (can compound capital, not just harvest)
 *   4. Low ROIC volatility (predictable economics, durable moat)
 *
 * Compounder grade = ROIC × Reinvestment Rate × Consistency
 *
 *   ROIC = NOPAT / Invested Capital ≈ OI × (1-tax) / NOA
 *   Reinvestment Rate = Δ NOA / NOPAT
 *
 * The product is the sustainable growth rate of intrinsic value.
 * 15% × 50% = 7.5% IV CAGR. That's a wonderful business.
 */
import { useMemo } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine, ReferenceArea, Cell, LineChart, Line, Legend } from "recharts";
import type { RecastPeriod } from "../../../engine/types";

interface Props { recastData: RecastPeriod[] }

export default function CompounderTest({ recastData }: Props) {
  const rows = useMemo(() => {
    return recastData.map((p, i) => {
      const prev = recastData[i - 1];
      const oi = p.is?.OI ?? 0;
      const taxRate = p.is?.taxRate ?? 0.25;
      const nopat = oi * (1 - taxRate);
      const noa = p.bs?.NOA ?? null;
      const prevNoa = prev?.bs?.NOA ?? null;
      const avgNoa = noa != null && prevNoa != null ? (noa + prevNoa) / 2 : noa;
      const roic = avgNoa != null && avgNoa > 0 ? nopat / avgNoa : null;
      const deltaNoa = noa != null && prevNoa != null ? noa - prevNoa : null;
      const reinvestRate = deltaNoa != null && nopat > 0 ? deltaNoa / nopat : null;
      const sgr = roic != null && reinvestRate != null ? roic * reinvestRate : null;
      return {
        period: p.period_end.slice(0, 7),
        roic: roic != null ? +(roic * 100).toFixed(2) : null,
        reinvestRate: reinvestRate != null ? +(reinvestRate * 100).toFixed(2) : null,
        sgr: sgr != null ? +(sgr * 100).toFixed(2) : null,
        nopat,
      };
    });
  }, [recastData]);

  const validROIC = rows.filter((r) => r.roic != null).map((r) => r.roic!);
  const meanROIC = validROIC.length > 0 ? validROIC.reduce((a, b) => a + b, 0) / validROIC.length : 0;
  const stdROIC = validROIC.length > 1
    ? Math.sqrt(validROIC.reduce((s, v) => s + (v - meanROIC) ** 2, 0) / validROIC.length)
    : 0;
  const minROIC = validROIC.length > 0 ? Math.min(...validROIC) : 0;
  const yearsAbove15 = validROIC.filter((v) => v >= 15).length;
  const consistencyScore = validROIC.length > 0 ? yearsAbove15 / validROIC.length : 0;

  // Compounder grade: holistic quality assessment
  const grade = useMemo(() => {
    if (validROIC.length < 5) return { letter: "?", color: "slate", reason: "Need 5+ years of data" };
    if (meanROIC >= 20 && minROIC >= 15 && stdROIC < 5) return { letter: "A+", color: "emerald", reason: "Wonderful business — sustained 20%+ ROIC, low volatility" };
    if (meanROIC >= 15 && minROIC >= 10 && stdROIC < 7) return { letter: "A", color: "emerald", reason: "Compounder — 15%+ ROIC sustained, moderate volatility" };
    if (meanROIC >= 12 && consistencyScore >= 0.6) return { letter: "B", color: "blue", reason: "Decent business — above average ROIC, mostly consistent" };
    if (meanROIC >= 8) return { letter: "C", color: "amber", reason: "Average business — ROIC near cost of capital" };
    return { letter: "D", color: "rose", reason: "Value-destroying — ROIC below cost of capital" };
  }, [meanROIC, minROIC, stdROIC, consistencyScore, validROIC.length]);

  const gradeColors: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-900 dark:text-emerald-200", border: "border-emerald-300 dark:border-emerald-700" },
    blue: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-900 dark:text-blue-200", border: "border-blue-300 dark:border-blue-700" },
    amber: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-900 dark:text-amber-200", border: "border-amber-300 dark:border-amber-700" },
    rose: { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-900 dark:text-rose-200", border: "border-rose-300 dark:border-rose-700" },
    slate: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", border: "border-slate-300 dark:border-slate-700" },
  };
  const gc = gradeColors[grade.color];

  return (
    <div className="space-y-4">
      {/* Grade banner */}
      <div className={`rounded-xl border-2 p-5 ${gc.bg} ${gc.border}`}>
        <div className="flex items-start gap-4">
          <div className={`text-5xl font-bold ${gc.text}`}>{grade.letter}</div>
          <div className="flex-1">
            <h2 className={`text-base font-semibold ${gc.text}`}>Compounder Grade</h2>
            <p className={`text-sm mt-1 ${gc.text} opacity-90`}>{grade.reason}</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Mean ROIC</div>
                <div className={`text-lg font-semibold tabular-nums ${gc.text}`}>{meanROIC.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Min ROIC</div>
                <div className={`text-lg font-semibold tabular-nums ${gc.text}`}>{minROIC.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Years &gt;15%</div>
                <div className={`text-lg font-semibold tabular-nums ${gc.text}`}>{yearsAbove15}/{validROIC.length}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ROIC × Reinvestment scatter — the compounder map */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">ROIC × Reinvestment Rate · Compounder Map</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Top-right quadrant = wonderful businesses. Each dot is a year.
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 16, right: 32, bottom: 32, left: 48 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis type="number" dataKey="reinvestRate" name="Reinvestment %" tick={{ fontSize: 11 }}
              label={{ value: "Reinvestment Rate %", position: "bottom", fontSize: 11 }} />
            <YAxis type="number" dataKey="roic" name="ROIC %" tick={{ fontSize: 11 }}
              label={{ value: "ROIC %", angle: -90, position: "left", fontSize: 11 }} />
            <ZAxis range={[80, 80]} />
            {/* Wonderful zone: ROIC > 15%, reinvest > 30% */}
            <ReferenceArea x1={30} x2={100} y1={15} y2={50} fill="#10b981" fillOpacity={0.08} />
            <ReferenceLine y={15} stroke="#10b981" strokeDasharray="3 3" label={{ value: "ROIC = 15%", fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <ReferenceLine x={0} stroke="#94a3b8" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { period: string; roic: number; reinvestRate: number; sgr: number };
                return (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl">
                    <div className="font-mono">{p.period}</div>
                    <div className="font-mono tabular-nums">ROIC: {p.roic?.toFixed(1)}%</div>
                    <div className="font-mono tabular-nums">Reinvest: {p.reinvestRate?.toFixed(1)}%</div>
                    <div className="font-mono tabular-nums text-emerald-400">SGR: {p.sgr?.toFixed(1)}%</div>
                  </div>
                );
              }}
            />
            <Scatter data={rows.filter((r) => r.roic != null && r.reinvestRate != null)}>
              {rows.filter((r) => r.roic != null && r.reinvestRate != null).map((r, i) => (
                <Cell key={i} fill={r.roic! > 15 && r.reinvestRate! > 30 ? "#10b981" : r.roic! > 15 ? "#3b82f6" : r.roic! > 8 ? "#f59e0b" : "#f87171"} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* SGR over time */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sustainable Growth Rate (SGR) Trend</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">SGR = ROIC × Reinvestment Rate. The natural compounding rate of intrinsic value.</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Line dataKey="roic" name="ROIC" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="reinvestRate" name="Reinvest %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="sgr" name="SGR" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">The Buffett checklist</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">ROIC ≥ 15% sustained</span> → moat exists. Below 10% = commodity business.</li>
          <li><span className="font-semibold">ROIC volatility &lt; 5pp</span> → predictable economics. Cyclical = ROIC volatility &gt; 10pp.</li>
          <li><span className="font-semibold">Reinvestment 30–70%</span> → can compound. Below 20% = harvest mode (mature). Above 80% = either explosive growth or capital-trap.</li>
          <li><span className="font-semibold">SGR &gt; 10%</span> → IV compounding faster than market. The whole point of owning a business.</li>
          <li><span className="font-semibold">Min ROIC ≥ 10% in worst year</span> → durable moat. If a recession crushes ROIC to 5%, the moat isn't real.</li>
        </ul>
      </div>
    </div>
  );
}
