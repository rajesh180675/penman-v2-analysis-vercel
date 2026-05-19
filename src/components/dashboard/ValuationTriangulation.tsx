import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";

interface Props {
  price: number | null;
  epvPerShare: number | null;
  intrinsicRange: { floor: number; ceiling: number; mid: number } | null;
  marketCap: number | null;
}

export default function ValuationTriangulation({ price, epvPerShare, intrinsicRange }: Props) {
  // Build framework bars
  const frameworks: Array<{ name: string; value: number | null; color: string }> = [
    { name: "EPV (floor)", value: epvPerShare, color: "#f59e0b" },
    { name: "V_RE (base)", value: intrinsicRange?.mid ?? null, color: "#6366f1" },
    { name: "V_RE (ceiling)", value: intrinsicRange?.ceiling ?? null, color: "#8b5cf6" },
  ];

  const validFrameworks = frameworks.filter(f => f.value != null && Number.isFinite(f.value) && f.value > 0);

  if (validFrameworks.length === 0 && price == null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Valuation Triangulation</h3>
        <p className="text-xs text-slate-500">Insufficient data for valuation anchors. Add market price and ensure ≥2 periods.</p>
      </div>
    );
  }

  const chartData = validFrameworks.map(f => ({
    name: f.name,
    value: Math.round(f.value!),
    color: f.color,
  }));

  // Margin of safety
  const mos = price != null && intrinsicRange?.mid != null && price > 0
    ? ((intrinsicRange.mid - price) / price) * 100
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Valuation Triangulation</h3>
        {mos != null && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${mos > 15 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : mos > 0 ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}>
            MoS: {mos > 0 ? "+" : ""}{mos.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
            <XAxis type="number" tickFormatter={(v) => `₹${v}`} fontSize={11} />
            <YAxis type="category" dataKey="name" width={90} fontSize={11} />
            <Tooltip
              formatter={((value: number) => [`₹${value.toLocaleString("en-IN")}`, "Implied Value"]) as any}
              contentStyle={{ fontSize: 12 }}
            />
            {price != null && (
              <ReferenceLine x={price} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={2} label={{ value: `Market ₹${price}`, position: "top", fontSize: 10, fill: "#ef4444" }} />
            )}
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-500">
        {price != null && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" /> Market Price</span>}
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> EPV (no-growth floor)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" /> Residual Earnings</span>
      </div>
    </div>
  );
}
