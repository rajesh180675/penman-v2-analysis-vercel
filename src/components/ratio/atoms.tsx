import type { ReactNode } from "react";
import { NP_BENCHMARKS } from "../../engine/types";

/* ── Sub-components ── */
export function Section({title,subtitle,children}:{title:string;subtitle?:string;children:ReactNode}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {subtitle&&<p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
export function ChartGrid({children}:{children:ReactNode}) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{children}</div>;
}
export function ChartCard({title,children}:{title:string;children:ReactNode}) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}
export function Th({children,left}:{children?:ReactNode;left?:boolean}) {
  return (
    <th className={`px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${left?"text-left":"text-right"}`}>
      {children}
    </th>
  );
}
const ACCENT:Record<string,string>={indigo:"text-indigo-700",green:"text-emerald-700"};
export function TR({label,vals,bold,accent,bm,bmKey}:{
  label:string|ReactNode;vals:string[];bold?:boolean;accent?:"indigo"|"green";
  bm?: (number|null)[] | undefined;bmKey?:string;
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
