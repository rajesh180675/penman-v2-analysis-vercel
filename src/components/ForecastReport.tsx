import { useState, useMemo } from "react";
import { RecastPeriod, ForecastScenario, ForecastPeriod, FADE_PARAMS, NP_BENCHMARKS, EngineConfig, ke_from_config } from "../engine/types";
import { buildScenario, sensitivityAnalysis } from "../engine/forecastingEngine";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend, ReferenceLine, Cell,
} from "recharts";
import { runMonteCarlo } from "../engine/monteCarloClient";

interface Props { data: RecastPeriod[]; config: EngineConfig }

const pct = (v:number,d=1) => (v*100).toFixed(d)+"%";
const cr  = (v:number) => v.toLocaleString("en-IN",{maximumFractionDigits:0});

function makeDefaultScenario(
  latest: RecastPeriod, name: ForecastScenario["name"], ke: number, kw: number,
  salesGrowth: number[], corePM: number[], ato: number[],
): ForecastScenario {
  return {
    name, probability: name==="base"?0.5:name==="bull"?0.25:0.25,
    horizonT: salesGrowth.length,
    drivers: {
      sales_growth: salesGrowth,
      core_sales_pm: corePM,
      ato,
      flev:  Array(salesGrowth.length).fill(latest.bs.NFO/Math.max(latest.bs.CSE,1)),
      nbc:   Array(salesGrowth.length).fill(latest.is.NFE/Math.max(Math.abs(latest.bs.NFO),1)||0.05),
      g_terminal: 0.05,
      ke, kw,
    },
  };
}

export default function ForecastReport({data,config}:Props) {
  const keBase = ke_from_config(config);

  const latest = data[data.length-1];
  const latestRatios = latest?.ratios;

  const basePM  = latestRatios?.CoreSalesPM ?? latestRatios?.PM ?? 0.12;
  const baseATO = latestRatios?.ATO ?? 1.2;
  const baseSG  = latestRatios?.Sales_growth ?? 0.10;

  const NP_PM  = NP_BENCHMARKS.PM?.median   ?? 0.055;
  const NP_ATO = NP_BENCHMARKS.ATO?.median  ?? 1.18;
  const FADE_PM  = FADE_PARAMS.CoreSalesPM  ?? 0.87;
  const FADE_ATO = FADE_PARAMS.ATO          ?? 0.95;
  const FADE_SG  = FADE_PARAMS.Sales_growth ?? 0.70;
  const NP_SG    = NP_BENCHMARKS.Sales_growth?.median ?? 0.072;

  // Generate 5-year fade arrays
  function fadeArr(base:number,alpha:number,target:number,t:number):number[] {
    const arr:number[]=[];let prev=base;
    for(let i=0;i<t;i++){const n=alpha*prev+(1-alpha)*target;arr.push(n);prev=n;}
    return arr;
  }

  const horizonT = 5;
  const fadePM  = fadeArr(basePM, FADE_PM, NP_PM, horizonT);
  const fadeATO = fadeArr(baseATO, FADE_ATO, NP_ATO, horizonT);
  const fadeSG  = fadeArr(baseSG, FADE_SG, NP_SG, horizonT);

  const [ke_inp,  setKe]  = useState(+(keBase*100).toFixed(1));
  const [g_inp,   setG]   = useState(5.0);
  const [horizon, setH]   = useState(5);
  const [pBull, setPBull] = useState(0.25);
  const [pBase, setPBase] = useState(0.5);
  const [pBear, setPBear] = useState(0.25);
  const [mcBusy, setMcBusy] = useState(false);
  const [mcProgress, setMcProgress] = useState(0);
  const [mcOut, setMcOut] = useState<any | null>(null);

  const kwDerived = useMemo(() => {
    if (data.length < 2) return config.risk_free_rate;
    const cur = data[data.length - 1];
    const prev = data[data.length - 2];
    return deriveKwFromStructure(cur, prev, ke_inp / 100, config.risk_free_rate, config);
  }, [data, ke_inp, config]);

  const scenarios = useMemo(():ForecastScenario[]=>{
    const kei=ke_inp/100, kwi=kwDerived;
    const bull = makeDefaultScenario(latest,"bull",kei,kwi,
      fadeSG.map(v=>v*1.5).slice(0,horizon),
      fadePM.map(v=>v*1.2).slice(0,horizon),
      fadeATO.slice(0,horizon),
    );
    const base = makeDefaultScenario(latest,"base",kei,kwi,
      fadeSG.slice(0,horizon),
      fadePM.slice(0,horizon),
      fadeATO.slice(0,horizon),
    );
    const bear = makeDefaultScenario(latest,"bear",kei,kwi,
      fadeSG.map(v=>v*0.5).slice(0,horizon),
      fadePM.map(v=>v*0.7).slice(0,horizon),
      fadeATO.slice(0,horizon),
    );

    bull.probability = pBull;
    base.probability = pBase;
    bear.probability = pBear;

    return [bull,base,bear].map(sc=>{
      const fps = buildScenario(sc, latest);
      sc.periods = fps;

      // Build fake RecastPeriod[] from forecast for valuation
      const fakePeriods: RecastPeriod[] = [latest, ...fps.map((fp,i)=>({
        period_end: `${parseInt(latest.period_end.slice(0,4))+(i+1)}-03-31`,
        bs: {...latest.bs, CSE:fp.CSE_f, NOA:fp.NOA_f, NFO:fp.NOA_f-fp.CSE_f},
        is: {...latest.is, CNI:fp.CNI_f, OI:fp.OI_f, Sales:fp.Sales_f, NFE:fp.NFE_f},
        cu: latest.cu, cf: latest.cf,
      } as RecastPeriod))];

      try {
        sc.valuationResult = computeValuation(fakePeriods, kei, kwi, g_inp/100, config);
      } catch(_e){/**/}
      return sc;
    });
  },[latest,ke_inp,kwDerived,g_inp,horizon,pBull,pBase,pBear,fadeSG,fadePM,fadeATO,config]);

  const baseScenario = scenarios.find(s=>s.name==="base");
  const fcPeriods = baseScenario?.periods ?? [];

  // Sensitivity
  const baseV = baseScenario?.valuationResult?.V_RE_CV3 ?? 0;
  const sensResults = useMemo(()=>sensitivityAnalysis(
    baseV,
    {ke:ke_inp/100,kw:kwDerived,g:g_inp/100,core_pm:basePM,ato:baseATO,sales_growth:baseSG},
    (p)=>{
      try {
        if (!baseScenario?.periods) return baseV;
        const fakePeriods: RecastPeriod[] = [latest, ...(baseScenario.periods).map((fp,i)=>({
          period_end:`${parseInt(latest.period_end.slice(0,4))+(i+1)}-03-31`,
          bs:{...latest.bs,CSE:fp.CSE_f,NOA:fp.NOA_f,NFO:fp.NOA_f-fp.CSE_f},
          is:{...latest.is,CNI:fp.CNI_f,OI:fp.OI_f,Sales:fp.Sales_f,NFE:fp.NFE_f},
          cu:latest.cu,cf:latest.cf,
        } as RecastPeriod))];
        const r = computeValuation(fakePeriods,p.ke,p.kw,p.g,config);
        return r.V_RE_CV3;
      } catch(_e){return baseV;}
    }
  ),[baseV,baseScenario,latest,ke_inp,kwDerived,g_inp,basePM,baseATO,baseSG,config]);

  const chartFade = Array.from({length:horizonT},((_,i)=>({
    year:`Y+${i+1}`,
    Sales_g: +(fadeSG[i]*100).toFixed(1),
    PM:      +(fadePM[i]*100).toFixed(1),
    ATO:     +fadeATO[i].toFixed(2),
    NP_PM:   +(NP_PM*100).toFixed(1),
    NP_ATO:  +NP_ATO.toFixed(2),
  })));

  const chartScen = fcPeriods.map(fp=>({
    year: fp.period_label,
    RE:   +fp.RE_f.toFixed(0),
    ReOI: +fp.ReOI_f.toFixed(0),
    OI:   +fp.OI_f.toFixed(0),
    Sales:+fp.Sales_f.toFixed(0),
    FCF:  +fp.FCF_f.toFixed(0),
  }));

  const SCENARIO_COLORS:{[k:string]:string}={bull:"#10b981",base:"#6366f1",bear:"#ef4444"};
  const probSum = pBull + pBase + pBear;

  const runMc = async () => {
    setMcBusy(true);
    setMcProgress(0);
    try {
      const out = await runMonteCarlo(
        {
          basePeriods: data,
          config,
          N: 10000,
          horizonT: horizon,
          paramDistributions: {
            ke: { mean: ke_inp / 100, std: 0.01 },
            kw: { mean: kwDerived, std: 0.008 },
            g: { mean: g_inp / 100, std: 0.01 },
          },
        },
        (p) => setMcProgress(p),
      );
      setMcOut(out);
    } finally {
      setMcBusy(false);
    }
  };

  const mcHistogram = useMemo(() => {
    if (!mcOut?.V_RE_samples?.length) return [] as Array<{ bucket: string; n: number }>;
    const vals: number[] = mcOut.V_RE_samples;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const bins = 20;
    const step = (max - min) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (const v of vals) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
      counts[idx] += 1;
    }
    return counts.map((n, i) => ({ bucket: `${cr(min + i * step)}–${cr(min + (i + 1) * step)}`, n }));
  }, [mcOut]);

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Forecast Assumptions — §4.3</h2>
        <div className="flex flex-wrap gap-4 items-end">
          {[
            {label:"ke % (Cost of Equity)",val:ke_inp,set:setKe},
            {label:"g % (Terminal Growth)",val:g_inp,set:setG},
          ].map(({label,val,set})=>(
            <div key={label}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input type="number" step={0.5} value={val}
                onChange={e=>set(Number(e.target.value))}
                className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm"/>
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">kw % (Derived, S-9.4)</label>
            <div className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-700 font-mono font-semibold">
              {(kwDerived * 100).toFixed(2)}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Horizon (years)</label>
            <select value={horizon} onChange={e=>setH(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              {[1,3,5,7,10,12,15].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">P(Bull)</label>
              <input type="number" step={0.05} value={pBull} onChange={(e) => setPBull(Number(e.target.value))} className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">P(Base)</label>
              <input type="number" step={0.05} value={pBase} onChange={(e) => setPBase(Number(e.target.value))} className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">P(Bear)</label>
              <input type="number" step={0.05} value={pBear} onChange={(e) => setPBear(Number(e.target.value))} className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>
        <div className={`mt-3 text-xs ${Math.abs(probSum - 1) < 0.001 ? "text-emerald-700" : "text-amber-700"}`}>
          Probability sum = {probSum.toFixed(2)} {Math.abs(probSum - 1) < 0.001 ? "(valid)" : "(must equal 1.00)"}
        </div>
      </div>

      {/* Fade Model */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Fade Analysis — N&P Table 3</h2>
        <p className="text-xs text-slate-500 mb-4">Ratios mean-revert toward N&P historical medians (R<sub>t+1</sub> = α×R<sub>t</sub> + (1−α)×R̄ median)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Sales Growth Fade (α={FADE_SG})</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartFade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <ReferenceLine y={NP_SG*100} stroke="#94a3b8" strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="Sales_g" stroke="#6366f1" strokeWidth={2} dot/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Core PM Fade (α={FADE_PM})</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartFade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <ReferenceLine y={NP_PM*100} stroke="#94a3b8" strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="PM" stroke="#10b981" strokeWidth={2} dot/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">ATO Fade (α={FADE_ATO})</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartFade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}}/>
                <Tooltip/>
                <ReferenceLine y={NP_ATO} stroke="#94a3b8" strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="ATO" stroke="#f59e0b" strokeWidth={2} dot/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Scenario Valuation */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Scenario Valuation — §4.3.3</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {scenarios.map(sc=>(
            <div key={sc.name} className="border rounded-xl p-4" style={{borderColor:SCENARIO_COLORS[sc.name]+"44"}}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{backgroundColor:SCENARIO_COLORS[sc.name]}}/>
                <span className="font-bold text-slate-800 capitalize">{sc.name}</span>
                <span className="text-xs text-slate-400">({(sc.probability*100).toFixed(0)}%)</span>
              </div>
              {sc.valuationResult&&(
                <div>
                  <div className="text-2xl font-bold" style={{color:SCENARIO_COLORS[sc.name]}}>
                    ₹{cr(sc.valuationResult.V_RE_CV3)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">V (RE·CV3) Cr</div>
                  <div className="mt-2 text-xs text-slate-500">
                    Sales g Y1: {pct(sc.drivers.sales_growth[0])} → Y{sc.horizonT}: {pct(sc.drivers.sales_growth[sc.horizonT-1]??sc.drivers.sales_growth[0])}
                  </div>
                  <div className="text-xs text-slate-500">Core PM Y1: {pct(sc.drivers.core_sales_pm[0])}</div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
          <div className="text-sm font-semibold text-indigo-800">
            Expected Value (probability-weighted): ₹{cr(
              scenarios.reduce((s,sc)=>s+(sc.probability*(sc.valuationResult?.V_RE_CV3??0)),0)/
              Math.max(scenarios.reduce((s,sc)=>s+sc.probability,0),1)
            )} Cr
          </div>
        </div>

        {/* Base case Pro Forma */}
        {chartScen.length>0&&(
          <div>
            <div className="text-sm font-semibold text-slate-600 mb-3">Base Case Pro Forma — RE & ReOI Series</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartScen}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}}/>
                <Tooltip/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <ReferenceLine y={0} stroke="#94a3b8"/>
                <Bar dataKey="RE" name="RE" fill="#6366f1">
                  {chartScen.map((e,i)=><Cell key={i} fill={e.RE>=0?"#6366f1":"#ef4444"}/>)}
                </Bar>
                <Bar dataKey="ReOI" name="ReOI" fill="#10b981">
                  {chartScen.map((e,i)=><Cell key={i} fill={e.ReOI>=0?"#10b981":"#ef4444"}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Monte Carlo Simulation — §4.1.1</h2>
            <p className="text-xs text-slate-500">N=10,000 simulations in Web Worker. Outputs valuation distribution percentiles.</p>
          </div>
          <button onClick={runMc} disabled={mcBusy} className={`px-4 py-2 rounded-lg text-sm font-medium ${mcBusy?"bg-slate-300 text-slate-100":"bg-indigo-600 text-white hover:bg-indigo-700"}`}>
            {mcBusy ? `Running... ${(mcProgress * 100).toFixed(0)}%` : "Run Monte Carlo"}
          </button>
        </div>
        {mcOut && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm mb-4">
              <Mini title="P10 RE" value={`₹${cr(mcOut.p10_RE)}`} />
              <Mini title="P50 RE" value={`₹${cr(mcOut.p50_RE)}`} />
              <Mini title="P90 RE" value={`₹${cr(mcOut.p90_RE)}`} />
              <Mini title="P10 ReOI" value={`₹${cr(mcOut.p10_ReOI)}`} />
              <Mini title="P50 ReOI" value={`₹${cr(mcOut.p50_ReOI)}`} />
              <Mini title="P90 ReOI" value={`₹${cr(mcOut.p90_ReOI)}`} />
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mcHistogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="bucket" hide />
                <YAxis tick={{fontSize:10}} />
                <Tooltip />
                <Bar dataKey="n" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* Sensitivity Tornado */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Sensitivity Analysis — §4.3.4</h2>
        <p className="text-xs text-slate-500 mb-4">Each parameter varied ±20% from base. Impact = V_high − V_low (₹ Cr). Sorted by magnitude.</p>
        {sensResults.map(r=>{
          const maxImpact = Math.max(...sensResults.map(x=>x.impact),1);
          const pctW = r.impact/maxImpact*100;
          return (
            <div key={r.param} className="flex items-center gap-3 mb-2">
              <div className="w-40 text-xs text-slate-600 text-right truncate">{r.label}</div>
              <div className="flex-1 flex items-center gap-1">
                <div className="h-5 bg-blue-200 rounded-l" style={{width:`${pctW/2}%`}}/>
                <div className="h-5 bg-indigo-500 rounded-r" style={{width:`${pctW/2}%`}}/>
              </div>
              <div className="w-28 text-xs font-mono text-slate-500">±₹{cr(r.impact/2)}</div>
              <div className="w-36 text-xs text-slate-400">
                [{cr(r.low)} – {cr(r.high)}]
              </div>
            </div>
          );
        })}
      </div>

      {/* Pro Forma Table */}
      {fcPeriods.length>0&&(
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-lg font-bold text-slate-800">Pro Forma Statement (Base Case)</h2>
            <p className="text-xs text-slate-500">Derived from accounting identities Eq.2,3,12,14</p>
          </div>
          <div className="p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Line Item</th>
                {fcPeriods.map(fp=><th key={fp.period_label} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">{fp.period_label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {([
                  {key:"Sales_f",label:"Sales",bold:true},
                  {key:"OI_f",label:"Operating Income (OI)"},
                  {key:"NFE_f",label:"Net Financial Expense (NFE)"},
                  {key:"CNI_f",label:"Comprehensive Net Income (CNI)",bold:true},
                  {key:"NOA_f",label:"Net Operating Assets (NOA)"},
                  {key:"CSE_f",label:"Common Equity (CSE)",bold:true},
                  {key:"ΔNOA_f",label:"ΔNOA"},
                  {key:"FCF_f",label:"Free Cash Flow (FCF = OI − ΔNOA)"},
                  {key:"RE_f",label:"Residual Earnings (RE)",bold:true},
                  {key:"ReOI_f",label:"Residual Op. Income (ReOI)",bold:true},
                ] as {key:keyof ForecastPeriod,label:string,bold?:boolean}[]).map(({key,label,bold})=>(
                  <tr key={key} className={`hover:bg-slate-50 ${bold?"bg-indigo-50/20":""}`}>
                    <td className={`px-3 py-2 text-slate-700 text-xs ${bold?"font-semibold":""}`}>{label}</td>
                    {fcPeriods.map(fp=>(
                      <td key={fp.period_label} className={`px-3 py-2 text-right font-mono text-xs ${bold?"font-semibold":""} ${(fp[key] as number)<0?"text-red-600":"text-slate-700"}`}>
                        ₹{cr(fp[key] as number)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
      <div className="text-[11px] text-slate-500 uppercase">{title}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}
