import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Label } from "recharts";

interface Props {
  /** Latest period income statement */
  sales: number;
  cogs: number;
  /** Operating income (OI) — after operating costs */
  operatingIncome: number;
  /** Net financial expense */
  netFinancingExpense: number;
  /** Tax */
  taxExpense: number;
  /** Profit after tax */
  pat: number;
  /** Period label */
  period: string;
  /** Currency unit (e.g. "₹ Cr") */
  unit?: string;
}

/**
 * Income Statement Waterfall — Sales → OI → PAT decomposition.
 * Each bar shows the magnitude of each line item with running totals.
 */
export default function IncomeWaterfall({ sales, cogs, operatingIncome, netFinancingExpense, taxExpense, pat, period, unit = "₹ Cr" }: Props) {
  // Build waterfall stages
  const operatingCosts = sales - operatingIncome; // total cost stack (incl COGS)
  const pbt = operatingIncome - netFinancingExpense;

  const data = [
    { name: "Sales",            value: sales,                    type: "total",   label: "Revenue" },
    { name: "Operating Costs",  value: -Math.abs(operatingCosts),type: "negative",label: `-${Math.abs(operatingCosts).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
    { name: "Operating Income", value: operatingIncome,          type: "subtotal",label: "OI" },
    { name: "Net Fin. Exp.",    value: -Math.abs(netFinancingExpense),type: "negative",label: `-${Math.abs(netFinancingExpense).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
    { name: "PBT",              value: pbt,                      type: "subtotal",label: "PBT" },
    { name: "Tax",              value: -Math.abs(taxExpense),    type: "negative",label: `-${Math.abs(taxExpense).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
    { name: "PAT",              value: pat,                      type: "total",   label: "Net Income" },
  ];

  const colorOf = (type: string) => {
    if (type === "total") return "#3b82f6";       // blue (Sales/PAT)
    if (type === "subtotal") return "#10b981";    // emerald (OI/PBT)
    if (type === "negative") return "#ef4444";    // red (deductions)
    return "#94a3b8";
  };

  const margins = {
    operating: sales > 0 ? operatingIncome / sales : null,
    pretax: sales > 0 ? pbt / sales : null,
    net: sales > 0 ? pat / sales : null,
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Income Statement Waterfall</h3>
          <p className="text-xs text-slate-500">{period} — Sales → PAT decomposition ({unit})</p>
        </div>
        <div className="flex gap-3 text-xs">
          {margins.operating != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Op Margin</div>
              <div className="font-bold text-emerald-600">{(margins.operating * 100).toFixed(1)}%</div>
            </div>
          )}
          {margins.net != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Net Margin</div>
              <div className="font-bold text-blue-600">{(margins.net * 100).toFixed(1)}%</div>
            </div>
          )}
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 10, right: 10, top: 10, bottom: 30 }}>
            <XAxis
              dataKey="name"
              fontSize={10}
              angle={-15}
              textAnchor="end"
              height={50}
              interval={0}
            />
            <YAxis
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              fontSize={10}
            />
            <Tooltip
              formatter={(value: number) => [`${unit} ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, ""]}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={42}>
              {data.map((entry, i) => (
                <Cell key={i} fill={colorOf(entry.type)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300">Sales</div>
          <div className="font-bold text-slate-900 dark:text-slate-100">{unit} {sales.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Operating Income</div>
          <div className="font-bold text-slate-900 dark:text-slate-100">{unit} {operatingIncome.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300">Net Income</div>
          <div className="font-bold text-slate-900 dark:text-slate-100">{unit} {pat.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
    </div>
  );
}
