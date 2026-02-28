import { RecastPeriod, NP_BENCHMARKS } from "../engine/types";
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, BarChart, Bar, ReferenceLine, Cell,
} from "recharts";

interface Props { data: RecastPeriod[] }

const pct  = (v:number|null|undefined,d=1) => v!=null?(v*100).toFixed(d)+"%" : "—";
const mult = (v:number|null|undefined,d=2) => v!=null?v.toFixed(d)+"×" : "—";
const num  = (v:number|null|undefined,d=0) => v!=null?v.toLocaleString("en-IN",{maximumFractionDigits:d}) : "—";
const days = (v:number|null|undefined) => v!=null?v.toFixed(0)+"d" : "—";

const NP_COLORS = {median:"#6366f1"};

export default function RatioReport({data}:Props) {
  const [view, setView] = useState<"core"|"wc"|"trend">("core");
  if (!data||data.length<=1) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
      <p className="font-semibold text-amber-800 text-lg">Need ≥ 2 periods</p>
    </div>
  );

  const rd = data.filter(d=>d.ratios);
  const latest = rd[rd.length-1];

  const dupont5 = rd.map((d, i) => {
    const prev = i > 0 ? rd[i - 1] : d;
    const avgTA = (d.bs.TA + prev.bs.TA) / 2;
    const avgCSE = (d.bs.CSE + prev.bs.CSE) / 2;
    const ebt = d.is.PAT + d.is.TaxExpense;
    const ebit = ebt + d.is.FinanceCost;
    const taxBurden = ebt !== 0 ? d.is.PAT / ebt : null;
    const intBurden = ebit !== 0 ? ebt / ebit : null;
    const opm = d.is.Sales !== 0 ? ebit / d.is.Sales : null;
    const at = avgTA !== 0 ? d.is.Sales / avgTA : null;
    const eqMult = avgCSE !== 0 ? avgTA / avgCSE : null;
    const roe5 = taxBurden != null && intBurden != null && opm != null && at != null && eqMult != null
      ? taxBurden * intBurden * opm * at * eqMult
      : null;
    return {
      period: d.period_end.slice(0, 7),
      taxBurden,
      intBurden,
      opm,
      at,
      eqMult,
      roe5,
    };
  });

  const chart = rd.map(d=>({
    period: d.period_end.slice(0,7),
    ROCE:   d.ratios?.ROCE   !=null?+(d.ratios.ROCE*100).toFixed(2):null,
    RNOA:   d.ratios?.RNOA   !=null?+(d.ratios.RNOA*100).toFixed(2):null,
    NBC:    d.ratios?.NBC     !=null?+(d.ratios.NBC*100).toFixed(2):null,
    PM:     d.ratios?.PM      !=null?+(d.ratios.PM*100).toFixed(2):null,
    ATO:    d.ratios?.ATO     !=null?+d.ratios.ATO.toFixed(3):null,
    ROOA:   d.ratios?.ROOA    !=null?+(d.ratios.ROOA*100).toFixed(2):null,
    OLLEV:  d.ratios?.OLLEV   !=null?+d.ratios.OLLEV.toFixed(3):null,
    Sales_g:d.ratios?.Sales_growth!=null?+(d.ratios.Sales_growth*100).toFixed(1):null,
    NOA_g:  d.ratios?.NOA_growth  !=null?+(d.ratios.NOA_growth*100).toFixed(1):null,
    CCR:    d.ratios?.cash_conversion_ratio!=null?+d.ratios.cash_conversion_ratio.toFixed(2):null,
    Accrual:d.ratios?.accrual_ratio_bs!=null?+(d.ratios.accrual_ratio_bs*100).toFixed(2):null,
  }));

  return (
    <div className="space-y-8">

      <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between">
        <div className="text-sm text-slate-700 font-medium">Analysis View</div>
        <div className="inline-flex rounded-lg overflow-hidden border border-slate-300">
          <button onClick={() => setView("core")} className={`px-3 py-1.5 text-xs ${view === "core" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>Core Ratios</button>
          <button onClick={() => setView("wc")} className={`px-3 py-1.5 text-xs ${view === "wc" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>WC Deep Dive</button>
          <button onClick={() => setView("trend")} className={`px-3 py-1.5 text-xs ${view === "trend" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>Trend (C-03)</button>
        </div>
      </div>

      {view === "core" && (
      <>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {label:"ROCE",value:latest?.ratios?.ROCE,fmt:pct,bm:"ROCE",color:"indigo"},
          {label:"RNOA",value:latest?.ratios?.RNOA,fmt:pct,bm:"RNOA",color:"emerald"},
          {label:"SPREAD",value:latest?.ratios?.SPREAD,fmt:pct,bm:"SPREAD",color:"blue"},
          {label:"ATO",value:latest?.ratios?.ATO,fmt:(v:number|null)=>mult(v,2),bm:"ATO",color:"violet"},
        ].map(({label,value,fmt,bm,color})=>(
          <div key={label} className={`bg-white rounded-2xl border border-${color}-100 p-4 shadow-sm`}>
            <div className="text-xs text-slate-500 font-semibold uppercase">{label}</div>
            <div className={`text-2xl font-bold text-${color}-700 mt-1`}>{fmt(value as number|null)}</div>
            {NP_BENCHMARKS[bm]&&value!=null&&(
              <div className="text-[10px] text-slate-400 mt-1">
                N&P median: {(NP_BENCHMARKS[bm].median*(bm==="ATO"?1:100)).toFixed(bm==="ATO"?2:1)}{bm==="ATO"?"×":"%"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── ROCE Bridge ── */}
      <Section title="ROCE Decomposition — Paper Eq.(4) & Eq.(16)" subtitle="ROCE = RNOA + FLEV × SPREAD  |  Eq.16: ROCE = MSR × {Core Sales PM × ATO* + Other/OA + UOI/OA + OLLEV×OLSPREAD + FLEV×(CoreSPREAD+…)}">
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Driver</Th>
              {rd.map(d=><Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
              <Th>N&P Med</Th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="ROCE" vals={rd.map(d=>pct(d.ratios?.ROCE))} bold accent="indigo"
                  bm={rd.map(d=>d.ratios?.ROCE??null)} bmKey="ROCE"/>
              <TR label="RNOA" vals={rd.map(d=>pct(d.ratios?.RNOA))} bold
                  bm={rd.map(d=>d.ratios?.RNOA??null)} bmKey="RNOA"/>
              <TR label="NBC (Net Borrowing Cost)" vals={rd.map(d=>pct(d.ratios?.NBC))}/>
              <TR label="SPREAD = RNOA − NBC" vals={rd.map(d=>pct(d.ratios?.SPREAD))}/>
              <TR label="FLEV (NFO/CSE)" vals={rd.map(d=>mult(d.ratios?.FLEV))}/>
              <TR label="FLEV × SPREAD" vals={rd.map(d=>{
                const fl=d.ratios?.FLEV,sp=d.ratios?.SPREAD;
                return fl!=null&&sp!=null?pct(fl*sp):"—";
              })} accent="indigo"/>
              <TR label="RNOA + FLEV×SPREAD (bridge check)" vals={rd.map(d=>{
                const rn=d.ratios?.RNOA,fl=d.ratios?.FLEV,sp=d.ratios?.SPREAD;
                return rn!=null&&fl!=null&&sp!=null?pct(rn+fl*sp):"—";
              })} accent="indigo"/>
              <TR label="Bridge residual (ROCE − bridge)" vals={rd.map(d=>pct(d.ratios?.ROCE_bridge_residual))}/>
              <TR label="— Core Sales PM" vals={rd.map(d=>pct(d.ratios?.CoreSalesPM))} bold/>
              <TR label="— ATO* (Sales/OA, gross)" vals={rd.map(d=>mult(d.ratios?.ATO_star))}/>
              <TR label="— UOI/OA" vals={rd.map(d=>pct(d.ratios?.UOI_OA))}/>
              <TR label="— Core NBC" vals={rd.map(d=>pct(d.ratios?.CoreNBC))}/>
              <TR label="— UFE/NFO" vals={rd.map(d=>pct(d.ratios?.UFE_NFO))}/>
              <TR label="— Core SPREAD" vals={rd.map(d=>pct(d.ratios?.CoreSPREAD))}/>
              <TR label="Eq.16 reconstructed ROCE" vals={rd.map(d=>pct(d.ratios?.ROCE_eq16_reconstructed))} accent="indigo"/>
              <TR label="Eq.16 bridge error" vals={rd.map(d=>pct(d.ratios?.ROCE_eq16_error))}/>
              <TR label="ROTCE (OI/TCE)" vals={rd.map(d=>pct(d.ratios?.ROTCE))}/>
              <TR label="MSR" vals={rd.map(d=>mult(d.ratios?.MSR,3))}/>
            </tbody>
          </table>
        </div>
        <ChartGrid>
          <ChartCard title="ROCE vs RNOA vs NBC (%)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <ReferenceLine y={(NP_BENCHMARKS.ROCE.median*100)} stroke={NP_COLORS.median} strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="ROCE" stroke="#6366f1" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="RNOA" stroke="#10b981" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="NBC"  stroke="#ef4444" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="RNOA check: ROOA + OLLEV×OLSPREAD (%)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <Line type="monotone" dataKey="RNOA" stroke="#6366f1" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="ROOA" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="5 3"/>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </ChartGrid>
      </Section>

      {/* ── DuPont ── */}
      <Section title="DuPont Decomposition — Paper Eq.(4a) & Eq.(10)" subtitle="RNOA = PM × ATO  |  Eq.10: ReOI = Sales × (PM − kw/ATO)">
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>
              {rd.map(d=><Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
              <Th>N&P Med</Th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="OI/Sales (PM)" vals={rd.map(d=>pct(d.ratios?.PM))} bold
                  bm={rd.map(d=>d.ratios?.PM??null)} bmKey="PM"/>
              <TR label="Sales PM (OI from sales / Sales)" vals={rd.map(d=>pct(d.ratios?.SalesPM))}/>
              <TR label="Core Sales PM" vals={rd.map(d=>pct(d.ratios?.CoreSalesPM))} bold/>
              <TR label="ATO = Sales/avg(NOA)" vals={rd.map(d=>mult(d.ratios?.ATO))} bold
                  bm={rd.map(d=>d.ratios?.ATO??null)} bmKey="ATO"/>
              <TR label="ATO* = Sales/avg(OA)" vals={rd.map(d=>mult(d.ratios?.ATO_star))}/>
              <TR label="PM × ATO (≈ RNOA)" vals={rd.map(d=>{
                const pm=d.ratios?.PM,ato=d.ratios?.ATO;
                return pm!=null&&ato!=null?pct(pm*ato):"—";
              })} accent="indigo"/>
              <TR label="Eq.10: Required return / sales (kw/ATO)" vals={rd.map(d=>pct(d.ratios?.required_return_per_sales))}/>
              <TR label="Eq.10: Value-creating margin (PM − kw/ATO)" vals={rd.map(d=>pct(d.ratios?.value_creating_margin))} accent="indigo"/>
              <TR label="Other Items / NOA" vals={rd.map(d=>pct(d.ratios?.OtherItemsRatio))}/>
              <TR label="Eq.8: CSE_check (Sales/ATO/(1+FLEV))" vals={rd.map(d=>num(d.ratios?.CSE_eq8_check))}/>
              <TR label="Eq.8: error %" vals={rd.map(d=>pct(d.ratios?.CSE_eq8_error_pct))}/>
            </tbody>
          </table>
        </div>
        <ChartGrid>
          <ChartCard title="Profit Margin % trend">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <ReferenceLine y={NP_BENCHMARKS.PM.median*100} stroke={NP_COLORS.median} strokeDasharray="4 2"/>
                <Line type="monotone" dataKey="PM" stroke="#6366f1" strokeWidth={2} dot={false} name="PM"/>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Asset Turnover (ATO×)">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}}/>
                <Tooltip/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <ReferenceLine y={NP_BENCHMARKS.ATO.median} stroke={NP_COLORS.median} strokeDasharray="4 2"/>
                <Line type="monotone" dataKey="ATO" stroke="#10b981" strokeWidth={2} dot={false} name="ATO"/>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </ChartGrid>
      </Section>

      {/* ── Op Liab Leverage ── */}
      <Section title="Operating Liability Leverage — Paper Eq.(7)" subtitle="RNOA = ROOA + OLLEV × OLSPREAD   (io excludes deferred tax per spec §4.1.2)">
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>
              {rd.map(d=><Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="ROOA = (OI+io)/avg(OA)" vals={rd.map(d=>pct(d.ratios?.ROOA))} bold/>
              <TR label="OLLEV = OL/avg(NOA)" vals={rd.map(d=>mult(d.ratios?.OLLEV))}/>
              <TR label="OLSPREAD = ROOA − io/OL" vals={rd.map(d=>pct(d.ratios?.OLSPREAD))}/>
              <TR label="io (imputed interest ₹ Cr)" vals={rd.map(d=>num(d.ratios?.io))}/>
              <TR label="RNOA_check (ROOA+OLLEV×OLSPREAD)" vals={rd.map(d=>pct(d.ratios?.RNOA_check))} accent="indigo"/>
              <TR label="DTL (excluded from io base)" vals={rd.map(d=>num(d.bs.DTL))}/>
              <TR label="OL_ex_DTL (io base)" vals={rd.map(d=>num(d.bs.OL_ex_DTL))}/>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Working Capital ── */}
      <Section title="Working Capital & Liquidity" subtitle="Days Sales Outstanding | Days Inventory | Days Payable | Cash Conversion Cycle">
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>
              {rd.map(d=><Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="Current Ratio" vals={rd.map(d=>mult(d.ratios?.current_ratio))}/>
              <TR label="Quick Ratio" vals={rd.map(d=>mult(d.ratios?.quick_ratio))}/>
              <TR label="Days Receivable (DSO)" vals={rd.map(d=>days(d.ratios?.days_receivable))}/>
              <TR label="Days Inventory (DIO)" vals={rd.map(d=>days(d.ratios?.days_inventory))}/>
              <TR label="Days Payable (DPO)" vals={rd.map(d=>days(d.ratios?.days_payable))}/>
              <TR label="Cash Conversion Cycle" vals={rd.map(d=>days(d.ratios?.cash_conversion_cycle))} bold/>
              <TR label="Interest Coverage (OI/|NFE|)" vals={rd.map(d=>mult(d.ratios?.interest_coverage))}/>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Earnings Quality ── */}
      <Section title="Earnings Quality — Accruals & Cash Conversion" subtitle="Accrual ratio BS = ΔNOA/avg(TA) | CCR = CFO/OI | Paper Eq.12 basis">
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>
              {rd.map(d=><Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="BS Accrual Ratio (ΔNOA/avg TA)" vals={rd.map(d=>pct(d.ratios?.accrual_ratio_bs))}/>
              <TR label="CF Accrual Ratio ((NI-CFO)/avg TA)" vals={rd.map(d=>pct(d.ratios?.accrual_ratio_cf))}/>
              <TR label="Cash Conversion Ratio (CFO/OI)" vals={rd.map(d=>mult(d.ratios?.cash_conversion_ratio))} bold/>
            </tbody>
          </table>
        </div>
        <ChartGrid>
          <ChartCard title="Accrual Ratio BS (%) — low = better">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}} unit="%"/>
                <Tooltip/>
                <ReferenceLine y={0} stroke="#94a3b8"/>
                <ReferenceLine y={5}  stroke="#f59e0b" strokeDasharray="4 2" label={{value:"Watch",fontSize:9}}/>
                <ReferenceLine y={10} stroke="#ef4444" strokeDasharray="4 2" label={{value:"Flag",fontSize:9}}/>
                <Bar dataKey="Accrual" name="Accrual Ratio %">
                  {chart.map((e,i)=><Cell key={i} fill={e.Accrual!=null&&e.Accrual>10?"#ef4444":e.Accrual!=null&&e.Accrual>5?"#f59e0b":"#6366f1"}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Cash Conversion Ratio (CFO/OI) — ideal ≈ 1.0">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}}/>
                <Tooltip/>
                <ReferenceLine y={1.0} stroke="#10b981" strokeDasharray="4 2" label={{value:"Ideal",fontSize:9}}/>
                <ReferenceLine y={0.6} stroke="#f59e0b" strokeDasharray="4 2" label={{value:"Low",fontSize:9}}/>
                <Line type="monotone" dataKey="CCR" stroke="#6366f1" strokeWidth={2} dot={false} name="CCR"/>
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </ChartGrid>
      </Section>

      {/* ── Growth ── */}
      <Section title="Growth Drivers" subtitle="NOA Growth | CNI Growth | Sales Growth — Paper §2.4">
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Driver</Th>
              {rd.map(d=><Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="Sales Growth %" vals={rd.map(d=>pct(d.ratios?.Sales_growth))} bold/>
              <TR label="NOA Growth %" vals={rd.map(d=>pct(d.ratios?.NOA_growth))}/>
              <TR label="OI Growth %" vals={rd.map(d=>pct(d.ratios?.OI_growth))}/>
              <TR label="CNI Growth %" vals={rd.map(d=>pct(d.ratios?.CNI_growth))}/>
            </tbody>
          </table>
        </div>
        <ChartCard title="Growth Rates (%)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="period" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:10}} unit="%"/>
              <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
              <Legend wrapperStyle={{fontSize:11}}/>
              <ReferenceLine y={0} stroke="#94a3b8"/>
              <Bar dataKey="Sales_g" name="Sales %" fill="#6366f1"/>
              <Bar dataKey="NOA_g"   name="NOA %" fill="#10b981"/>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      <Section title="Extended 5-Factor DuPont (C-04)" subtitle="ROE = (NI/EBT) × (EBT/EBIT) × (EBIT/Sales) × (Sales/Assets) × (Assets/Equity)">
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Factor</Th>
              {dupont5.map(d => <Th key={d.period}>{d.period}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="Tax burden (NI/EBT)" vals={dupont5.map(d => pct(d.taxBurden))} />
              <TR label="Interest burden (EBT/EBIT)" vals={dupont5.map(d => pct(d.intBurden))} />
              <TR label="Operating margin (EBIT/Sales)" vals={dupont5.map(d => pct(d.opm))} />
              <TR label="Asset turnover (Sales/Assets)" vals={dupont5.map(d => mult(d.at))} />
              <TR label="Equity multiplier (Assets/Equity)" vals={dupont5.map(d => mult(d.eqMult))} />
              <TR label="Reconstructed ROE (5-factor)" vals={dupont5.map(d => pct(d.roe5))} bold accent="indigo" />
              <TR label="Reported ROCE (anchor)" vals={rd.map(d => pct(d.ratios?.ROCE))} bold />
            </tbody>
          </table>
        </div>
        <ChartCard title="5-Factor ROE reconstruction vs ROCE">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dupont5.map((d, i) => ({ period: d.period, ROE5: d.roe5 != null ? +(d.roe5 * 100).toFixed(2) : null, ROCE: rd[i]?.ratios?.ROCE != null ? +(rd[i].ratios!.ROCE! * 100).toFixed(2) : null }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="period" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:10}} unit="%"/>
              <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
              <Legend wrapperStyle={{fontSize:11}}/>
              <Line type="monotone" dataKey="ROE5" stroke="#7c3aed" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ROCE" stroke="#2563eb" strokeWidth={2} dot={false} strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>
      </>
      )}

      {view === "wc" && (
        <Section title="Working Capital Deep Dive (C-06)" subtitle="DIO, DSO, DPO, CCC with qualitative flags">
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <Th left>Metric</Th>
                {rd.map(d => <Th key={d.period_end}>{d.period_end.slice(0,7)}</Th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                <TR label="DSO (days receivable)" vals={rd.map(d => days(d.ratios?.days_receivable))} />
                <TR label="DIO (days inventory)" vals={rd.map(d => days(d.ratios?.days_inventory))} />
                <TR label="DPO (days payable)" vals={rd.map(d => days(d.ratios?.days_payable))} />
                <TR label="CCC (DSO + DIO - DPO)" vals={rd.map(d => days(d.ratios?.cash_conversion_cycle))} bold accent="indigo" />
                <TR label="Current Ratio" vals={rd.map(d => mult(d.ratios?.current_ratio))} />
                <TR label="Quick Ratio" vals={rd.map(d => mult(d.ratios?.quick_ratio))} />
              </tbody>
            </table>
          </div>
          <ChartGrid>
            <ChartCard title="DSO/DIO/DPO (days)">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={rd.map(d => ({ period: d.period_end.slice(0,7), DSO: d.ratios?.days_receivable != null ? +d.ratios.days_receivable.toFixed(1) : null, DIO: d.ratios?.days_inventory != null ? +d.ratios.days_inventory.toFixed(1) : null, DPO: d.ratios?.days_payable != null ? +d.ratios.days_payable.toFixed(1) : null }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="period" tick={{fontSize:10}}/>
                  <YAxis tick={{fontSize:10}}/>
                  <Tooltip/>
                  <Legend wrapperStyle={{fontSize:11}}/>
                  <Line type="monotone" dataKey="DSO" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="DIO" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="DPO" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="CCC trend (days)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={rd.map(d => ({ period: d.period_end.slice(0,7), CCC: d.ratios?.cash_conversion_cycle != null ? +d.ratios.cash_conversion_cycle.toFixed(1) : 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="period" tick={{fontSize:10}}/>
                  <YAxis tick={{fontSize:10}}/>
                  <Tooltip/>
                  <ReferenceLine y={0} stroke="#94a3b8"/>
                  <Bar dataKey="CCC" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </ChartGrid>
          <div className="mt-4 space-y-2 text-xs">
            {rd.map((d, i) => {
              if (i === 0) return null;
              const prev = rd[i - 1];
              const dsoUp = (d.ratios?.days_receivable ?? 0) - (prev.ratios?.days_receivable ?? 0);
              const salesG = d.ratios?.Sales_growth ?? 0;
              const ccc = d.ratios?.cash_conversion_cycle ?? null;
              const warn = dsoUp > 7 && salesG < 0.1;
              return (
                <div key={d.period_end} className={`rounded-lg border p-2 ${warn ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                  <b>{d.period_end.slice(0,7)}:</b> DSO delta {dsoUp.toFixed(1)}d, Sales growth {pct(salesG)}{ccc != null ? `, CCC ${ccc.toFixed(1)}d` : ""}
                  {warn ? "  -> Flag: receivables rising faster than sales." : ""}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Trend / Horizontal Analysis (C-03) ── */}
      {view === "trend" && (
        <Section title="Horizontal & Trend Analysis (C-03)" subtitle="YoY % change | 3-year CAGR | N&P Table 3 context">
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <Th left>Line Item</Th>
                {rd.slice(1).map(d => <Th key={d.period_end}>{d.period_end.slice(0,7)} YoY</Th>)}
                {rd.length >= 3 && <Th>3Y CAGR</Th>}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: "Sales", fn: (d: typeof rd[0]) => d.is.Sales },
                  { label: "Operating Income (OI)", fn: (d: typeof rd[0]) => d.is.OI },
                  { label: "Core OI", fn: (d: typeof rd[0]) => d.cu.CoreOI },
                  { label: "CNI", fn: (d: typeof rd[0]) => d.is.CNI },
                  { label: "CFO", fn: (d: typeof rd[0]) => d.cf.CFO },
                  { label: "Total Assets", fn: (d: typeof rd[0]) => d.bs.TA },
                  { label: "NOA", fn: (d: typeof rd[0]) => d.bs.NOA },
                  { label: "CSE", fn: (d: typeof rd[0]) => d.bs.CSE },
                  { label: "NFO", fn: (d: typeof rd[0]) => d.bs.NFO },
                  { label: "Trade Receivables", fn: (d: typeof rd[0]) => d.bs.TradeReceivables },
                  { label: "Inventories", fn: (d: typeof rd[0]) => d.bs.Inventory },
                  { label: "PPE", fn: (d: typeof rd[0]) => d.bs.PPE },
                ].map(({ label, fn }) => {
                  const vals = rd.map(fn);
                  const yoys = rd.slice(1).map((d, i) => {
                    const prev = vals[i], cur = vals[i + 1];
                    if (!prev || prev === 0) return null;
                    return (cur - prev) / Math.abs(prev);
                  });
                  const first = vals[0], last = vals[vals.length - 1];
                  const years = rd.length - 1;
                  const cagr3 = first > 0 && last > 0 && years >= 2
                    ? Math.pow(last / first, 1 / years) - 1 : null;
                  return (
                    <tr key={label} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">{label}</td>
                      {yoys.map((v, i) => (
                        <td key={i} className={`px-3 py-2 text-right font-mono text-xs ${v == null ? "text-slate-400" : v >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`}
                        </td>
                      ))}
                      {rd.length >= 3 && (
                        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${cagr3 == null ? "text-slate-400" : cagr3 >= 0 ? "text-indigo-700" : "text-red-600"}`}>
                          {cagr3 == null ? "—" : `${cagr3 >= 0 ? "+" : ""}${(cagr3 * 100).toFixed(1)}%`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border">
            <strong>Reading Guide:</strong> YoY column shows (Current − Prior) / |Prior|. A consistently positive
            OI CAGR exceeding Sales CAGR suggests margin expansion. Rising NOA growth vs Sales growth may indicate
            asset-intensity risk (N&P 2001 §4 — high NOA growth dilutes RNOA if PM doesn't increase commensurately).
          </div>
        </Section>
      )}
    </div>
  );
}

/* ── Sub-components ── */
function Section({title,subtitle,children}:{title:string;subtitle?:string;children:React.ReactNode}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {subtitle&&<p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
function ChartGrid({children}:{children:React.ReactNode}) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{children}</div>;
}
function ChartCard({title,children}:{title:string;children:React.ReactNode}) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}
function Th({children,left}:{children?:React.ReactNode;left?:boolean}) {
  return (
    <th className={`px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${left?"text-left":"text-right"}`}>
      {children}
    </th>
  );
}
const ACCENT:Record<string,string>={indigo:"text-indigo-700",green:"text-emerald-700"};
function TR({label,vals,bold,accent,bm,bmKey}:{
  label:string;vals:string[];bold?:boolean;accent?:"indigo"|"green";
  bm?:(number|null)[];bmKey?:string;
}) {
  const vc=accent?ACCENT[accent]:"";
  const benchmark = bmKey&&NP_BENCHMARKS[bmKey] ? NP_BENCHMARKS[bmKey] : null;
  return (
    <tr className={`hover:bg-slate-50 ${bold?"bg-indigo-50/30":""}`}>
      <td className={`px-3 py-2 text-slate-700 whitespace-nowrap text-xs ${bold?"font-semibold":""}`}>{label}</td>
      {vals.map((v,i)=>{
        const raw = bm?.[i];
        const above = benchmark&&raw!=null?raw>benchmark.median:null;
        return (
          <td key={i} className={`px-3 py-2 text-right font-mono whitespace-nowrap text-xs ${bold?"font-semibold":""} ${vc}`}>
            {v}
            {above!==null&&<span className={`ml-1 text-[9px] ${above?"text-emerald-600":"text-amber-600"}`}>{above?"▲":"▼"}</span>}
          </td>
        );
      })}
      <td className="px-3 py-2 text-right text-[10px] text-slate-400">
        {benchmark?`${(benchmark.median*(bmKey==="ATO"?1:100)).toFixed(bmKey==="ATO"?2:1)}${bmKey==="ATO"?"×":"%"}`:""}
      </td>
    </tr>
  );
}
