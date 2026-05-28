import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Label } from "recharts";

interface CompanyPoint {
  name: string;
  x: number;
  y: number;
  isTarget?: boolean | undefined;
}

interface Props {
  /** Companies with their x/y metric values */
  companies: CompanyPoint[];
  xLabel: string;
  yLabel: string;
  /** Optional: format axis values */
  xFormat?: "pct" | "mult" | "number" | undefined;
  yFormat?: "pct" | "mult" | "number" | undefined;
}

function formatAxis(value: number, format: "pct" | "mult" | "number" = "number"): string {
  switch (format) {
    case "pct": return `${(value * 100).toFixed(0)}%`;
    case "mult": return `${value.toFixed(1)}×`;
    default: return value.toFixed(1);
  }
}

/**
 * Scatter plot for peer comparison — e.g. ROCE vs P/B, showing each company as a labeled dot.
 * Target company highlighted in indigo, peers in slate.
 */
export default function PeerScatterPlot({ companies, xLabel, yLabel, xFormat = "number", yFormat = "number" }: Props) {
  if (companies.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{yLabel} vs {xLabel}</h3>
        <p className="text-xs text-slate-500">Need ≥2 companies for scatter plot.</p>
      </div>
    );
  }

  const targets = companies.filter(c => c.isTarget);
  const peers = companies.filter(c => !c.isTarget);

  // Compute medians for reference lines
  const xValues = companies.map(c => c.x).filter(v => Number.isFinite(v));
  const yValues = companies.map(c => c.y).filter(v => Number.isFinite(v));
  const xMedian = xValues.sort((a, b) => a - b)[Math.floor(xValues.length / 2)] ?? 0;
  const yMedian = yValues.sort((a, b) => a - b)[Math.floor(yValues.length / 2)] ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">{yLabel} vs {xLabel}</h3>
      <div className="h-64">
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              tickFormatter={(v) => formatAxis(v, xFormat)}
              fontSize={11}
            >
              <Label value={xLabel} position="bottom" offset={-5} fontSize={11} fill="#64748b" />
            </XAxis>
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              tickFormatter={(v) => formatAxis(v, yFormat)}
              fontSize={11}
            >
              <Label value={yLabel} position="insideLeft" angle={-90} offset={-5} fontSize={11} fill="#64748b" />
            </YAxis>
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const p = payload[0].payload as CompanyPoint;
                return (
                  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm text-xs">
                    <div className="font-semibold text-slate-800">{p.name}</div>
                    <div className="text-slate-600">{xLabel}: {formatAxis(p.x, xFormat)}</div>
                    <div className="text-slate-600">{yLabel}: {formatAxis(p.y, yFormat)}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine x={xMedian} stroke="#94a3b8" strokeDasharray="4 4" />
            <ReferenceLine y={yMedian} stroke="#94a3b8" strokeDasharray="4 4" />
            {peers.length > 0 && (
              <Scatter name="Peers" data={peers} fill="#94a3b8" strokeWidth={1} stroke="#64748b">
              </Scatter>
            )}
            {targets.length > 0 && (
              <Scatter name="Target" data={targets} fill="#6366f1" strokeWidth={2} stroke="#4f46e5" shape="star">
              </Scatter>
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" /> Target</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-slate-400 inline-block" /> Peers</span>
        <span className="ml-auto">Dashed lines = peer median</span>
      </div>
    </div>
  );
}
