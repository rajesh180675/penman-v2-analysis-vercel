import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine,
} from "recharts";

interface ChartFadeRow {
  year: string;
  Sales_g: number;
  PM: number;
  ATO: number;
  NP_PM: number;
  NP_ATO: number;
}

export default function FadeAnalysisSection({
  chartFade,
  FADE_SG,
  FADE_PM,
  FADE_ATO,
  NP_SG,
  NP_PM,
  NP_ATO,
}: {
  chartFade: ChartFadeRow[];
  FADE_SG: number;
  FADE_PM: number;
  FADE_ATO: number;
  NP_SG: number;
  NP_PM: number;
  NP_ATO: number;
}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
      <h2 className="text-lg font-bold text-slate-800 mb-2">Fade Analysis — N&P Table 3</h2>
      <p className="text-xs text-slate-500 mb-4">Ratios mean-revert toward N&P historical medians (R<sub>t+1</sub> = α×R<sub>t</sub> + (1−α)×R̄ median)</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">Sales Growth Fade (α={FADE_SG})</div>
          <ResponsiveContainer debounce={50} width="100%" height={140}>
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
          <ResponsiveContainer debounce={50} width="100%" height={140}>
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
          <ResponsiveContainer debounce={50} width="100%" height={140}>
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
  );
}
