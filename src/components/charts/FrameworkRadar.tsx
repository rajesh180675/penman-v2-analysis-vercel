import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

interface FrameworkAnchor {
  name: string;
  value: number | null;
  shortName: string;
}

interface Props {
  anchors: FrameworkAnchor[];
  marketPrice: number | null;
}

/**
 * Radar/spider chart showing multiple valuation frameworks normalized to market price.
 * Center = 0.5× market, outer ring = 2× market.
 * A balanced shape means frameworks agree; a lopsided shape means divergence.
 */
export default function FrameworkRadar({ anchors, marketPrice }: Props) {
  if (!marketPrice || marketPrice <= 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Framework Convergence</h3>
        <p className="text-xs text-slate-500">Market price needed to show framework convergence radar.</p>
      </div>
    );
  }

  const validAnchors = anchors.filter(a => a.value != null && Number.isFinite(a.value) && a.value > 0);
  if (validAnchors.length < 3) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Framework Convergence</h3>
        <p className="text-xs text-slate-500">Need ≥3 valuation anchors for radar chart.</p>
      </div>
    );
  }

  // Normalize: ratio to market price, capped at [0.3, 2.5] for visual clarity
  const chartData = validAnchors.map(a => ({
    framework: a.shortName,
    ratio: Math.min(2.5, Math.max(0.3, (a.value! / marketPrice))),
    value: a.value!,
    fullName: a.name,
  }));

  // Convergence score: std dev of ratios (lower = more agreement)
  const ratios = chartData.map(d => d.ratio);
  const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  const stdDev = Math.sqrt(ratios.reduce((s, v) => s + (v - mean) ** 2, 0) / ratios.length);
  const convergenceLabel = stdDev < 0.1 ? "Strong" : stdDev < 0.2 ? "Moderate" : "Weak";
  const convergenceColor = stdDev < 0.1 ? "text-emerald-600" : stdDev < 0.2 ? "text-amber-600" : "text-red-600";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Framework Convergence</h3>
        <span className={`text-xs font-medium ${convergenceColor}`}>
          {convergenceLabel} agreement (σ={stdDev.toFixed(2)})
        </span>
      </div>

      <div className="h-56">
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="framework" fontSize={11} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 2]}
              tickCount={5}
              fontSize={9}
              tickFormatter={(v: number) => `${v.toFixed(1)}×`}
            />
            <Tooltip
              formatter={((value: number, _name: string, props: any) => [
                `₹${props.payload.value.toFixed(0)} (${(value).toFixed(2)}× market)`,
                props.payload.fullName,
              ]) as any}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Radar
              name="Implied Value"
              dataKey="ratio"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.2}
              strokeWidth={2}
              dot={{ r: 4, fill: "#6366f1" }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-xs text-slate-500 mt-2">
        Each axis shows implied value as a multiple of market price (₹{marketPrice.toLocaleString("en-IN")}).
        The 1.0× ring = fair value at market. Points outside = undervalued by that framework.
      </div>
    </div>
  );
}
