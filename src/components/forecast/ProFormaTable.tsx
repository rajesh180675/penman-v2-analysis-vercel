import { ForecastPeriod } from "../../engine/types";
import { toPerShare } from "../../engine/shareCountTools";
import { cr, share } from "./ForecastReport.formatters";

export default function ProFormaTable({
  fcPeriods,
  sharesOut,
}: {
  fcPeriods: ForecastPeriod[];
  sharesOut: number | null;
}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">Pro Forma Statement (Base Case)</h2>
        <p className="text-xs text-slate-500">Derived from accounting identities Eq.2,3,12,14 {sharesOut ? `· displayed as ₹ per share on the current ${sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr share base` : ""}</p>
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
                    {sharesOut ? share(toPerShare(fp[key] as number, sharesOut)) : `₹${cr(fp[key] as number)}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
