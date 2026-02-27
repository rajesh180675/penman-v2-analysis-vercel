import { RecastPeriod } from "../engine/types";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell } from "recharts";

interface Props { data: RecastPeriod[] }

const fix = (v:number,d=2) => v.toFixed(d);

function ScoreBar({score,max,thresholds,colors}:{score:number;max:number;thresholds:number[];colors:string[]}) {
  const p = score/max*100;
  const color = score>=thresholds[1]?colors[2]:score>=thresholds[0]?colors[1]:colors[0];
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
        <div className="h-full rounded-full" style={{width:`${p}%`,backgroundColor:color}}/>
      </div>
      <span className="font-bold text-sm w-10 text-right" style={{color}}>{score}/{max}</span>
    </div>
  );
}

function ZoneTag({zone}:{zone:"Safe"|"Grey"|"Distress"}) {
  const c = zone==="Safe"?"bg-emerald-100 text-emerald-800":zone==="Grey"?"bg-amber-100 text-amber-800":"bg-red-100 text-red-800";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c}`}>{zone}</span>;
}

export default function QualityReport({data}:Props) {
  const rd = data.filter(d=>d.quality);
  if (rd.length===0) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
      <p className="font-semibold text-amber-800">Need ≥ 2 periods for quality metrics</p>
    </div>
  );

  const pChart = rd.map(d=>({
    period:d.period_end.slice(0,7),
    F:d.quality!.piotroski_total,
    Z:+d.quality!.altman_zprime.toFixed(2),
    M:+d.quality!.beneish_mscore.toFixed(2),
  }));

  const latest = rd[rd.length-1].quality!;
  const zZone:("Safe"|"Grey"|"Distress") = latest.altman_zprime>2.9?"Safe":latest.altman_zprime>1.23?"Grey":"Distress";
  const mFlag = latest.beneish_mscore > -1.78;

  const PIOTROSKI_SIGNALS = [
    {key:"piotroski_roa",label:"ROA > 0",cat:"Profitability"},
    {key:"piotroski_delta_roa",label:"ΔROA > 0",cat:"Profitability"},
    {key:"piotroski_cfo",label:"CFO > 0",cat:"Profitability"},
    {key:"piotroski_accrual",label:"CFO/TA > ROA (cash quality)",cat:"Profitability"},
    {key:"piotroski_leverage",label:"ΔFLEV < 0 (less debt)",cat:"Leverage"},
    {key:"piotroski_liquidity",label:"ΔCurrent Ratio > 0",cat:"Liquidity"},
    {key:"piotroski_dilution",label:"No equity dilution",cat:"Leverage"},
    {key:"piotroski_margin",label:"ΔGross Margin > 0",cat:"Efficiency"},
    {key:"piotroski_turnover",label:"ΔATO > 0",cat:"Efficiency"},
  ];

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Piotroski F-Score</div>
          <div className="text-3xl font-bold text-indigo-700 mb-3">{latest.piotroski_total}/9</div>
          <ScoreBar score={latest.piotroski_total} max={9} thresholds={[3,7]} colors={["#ef4444","#f59e0b","#10b981"]}/>
          <div className="mt-2 text-xs text-slate-400">{latest.piotroski_total>=7?"Strong health":latest.piotroski_total>=3?"Average":"Weak signals"}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Altman Z'-Score</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-slate-800">{latest.altman_zprime.toFixed(2)}</span>
            <ZoneTag zone={zZone}/>
          </div>
          <div className="text-xs text-slate-400">Z' &gt;2.9 Safe · 1.23–2.9 Grey · &lt;1.23 Distress</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Beneish M-Score</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={`text-3xl font-bold ${mFlag?"text-red-600":"text-emerald-700"}`}>{latest.beneish_mscore.toFixed(2)}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${mFlag?"bg-red-100 text-red-800":"bg-emerald-100 text-emerald-800"}`}>
              {mFlag?"⚠ Risk":"Clean"}
            </span>
          </div>
          <div className="text-xs text-slate-400">M &gt; −1.78 = possible manipulation</div>
        </div>
      </div>

      {/* Trend Charts */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Quality Score Trends</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">F-Score (0–9)</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={pChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}} domain={[0,9]}/>
                <Tooltip/>
                <ReferenceLine y={7} stroke="#10b981" strokeDasharray="3 2"/>
                <ReferenceLine y={3} stroke="#ef4444" strokeDasharray="3 2"/>
                <Line type="monotone" dataKey="F" stroke="#6366f1" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Z'-Score</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={pChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}}/>
                <Tooltip/>
                <ReferenceLine y={2.9}  stroke="#10b981" strokeDasharray="3 2"/>
                <ReferenceLine y={1.23} stroke="#ef4444" strokeDasharray="3 2"/>
                <Line type="monotone" dataKey="Z" stroke="#f59e0b" strokeWidth={2} dot={false}>
                  {pChart.map((_e,i)=><Cell key={i} fill="#f59e0b"/>)}
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">M-Score (≤−1.78 = safe)</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={pChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}}/>
                <Tooltip/>
                <ReferenceLine y={-1.78} stroke="#ef4444" strokeDasharray="3 2"/>
                <Line type="monotone" dataKey="M" stroke="#10b981" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Piotroski Detail */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Piotroski F-Score — 9 Signals</h2>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b">
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Signal</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Category</th>
              {rd.map(d=><th key={d.period_end} className="px-3 py-2 text-center text-xs font-semibold text-slate-500">{d.period_end.slice(0,7)}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {PIOTROSKI_SIGNALS.map(({key,label,cat})=>(
                <tr key={key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700 text-xs">{label}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{cat}</td>
                  {rd.map(d=>{
                    const v = d.quality?.[key as keyof typeof d.quality] as number;
                    return (
                      <td key={d.period_end} className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${v===1?"bg-emerald-100 text-emerald-700":"bg-slate-100 text-slate-400"}`}>
                          {v===1?"✓":"✗"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-indigo-50/40 font-semibold">
                <td className="px-3 py-2 text-slate-700 text-sm" colSpan={2}>Total F-Score</td>
                {rd.map(d=>(
                  <td key={d.period_end} className="px-3 py-2 text-center font-bold text-indigo-700">
                    {d.quality?.piotroski_total}/9
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Beneish */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Beneish M-Score Components</h2>
          <p className="text-xs text-slate-500">M &gt; −1.78 signals possible earnings manipulation (Beneish 1999, JAR)</p>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b">
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Component</th>
              {rd.map(d=><th key={d.period_end} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">{d.period_end.slice(0,7)}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[
                {key:"beneish_dsri",label:"DSRI — Days Sales Receivable Index"},
                {key:"beneish_gmi",label:"GMI — Gross Margin Index"},
                {key:"beneish_aqi",label:"AQI — Asset Quality Index"},
                {key:"beneish_sgi",label:"SGI — Sales Growth Index"},
                {key:"beneish_depi",label:"DEPI — Depreciation Index"},
                {key:"beneish_sgai",label:"SGAI — SGA Index"},
                {key:"beneish_lvgi",label:"LVGI — Leverage Index"},
                {key:"beneish_tata",label:"TATA — Total Accruals/TA"},
              ].map(({key,label})=>(
                <tr key={key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700 text-xs">{label}</td>
                  {rd.map(d=>(
                    <td key={d.period_end} className="px-3 py-2 text-right font-mono text-xs">
                      {fix(d.quality?.[key as keyof typeof d.quality] as number??0)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold bg-red-50/40">
                <td className="px-3 py-2 text-slate-700">M-Score</td>
                {rd.map(d=>{
                  const m=d.quality?.beneish_mscore??0;
                  return (
                    <td key={d.period_end} className={`px-3 py-2 text-right font-mono font-bold ${m>-1.78?"text-red-600":"text-emerald-700"}`}>
                      {m.toFixed(3)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Altman */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Altman Z'-Score Components</h2>
          <p className="text-xs text-slate-500">Z' = 0.717×WC/TA + 0.847×RE/TA + 3.107×EBIT/TA + 0.420×BVE/TL + 0.998×S/TA</p>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b">
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Component</th>
              {rd.map(d=><th key={d.period_end} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">{d.period_end.slice(0,7)}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[
                {key:"altman_wc_ta",label:"0.717 × WC/TA"},
                {key:"altman_re_ta",label:"0.847 × RE/TA"},
                {key:"altman_ebit_ta",label:"3.107 × EBIT/TA"},
                {key:"altman_bve_tl",label:"0.420 × BVE/TL"},
                {key:"altman_s_ta",label:"0.998 × S/TA"},
              ].map(({key,label})=>(
                <tr key={key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-700">{label}</td>
                  {rd.map(d=>(
                    <td key={d.period_end} className="px-3 py-2 text-right font-mono text-xs">
                      {fix(d.quality?.[key as keyof typeof d.quality] as number??0)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold bg-slate-50">
                <td className="px-3 py-2 text-slate-700">Z'-Score</td>
                {rd.map(d=>{
                  const z=d.quality?.altman_zprime??0;
                  const col=z>2.9?"text-emerald-700":z>1.23?"text-amber-700":"text-red-600";
                  return <td key={d.period_end} className={`px-3 py-2 text-right font-mono font-bold ${col}`}>{z.toFixed(2)}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
