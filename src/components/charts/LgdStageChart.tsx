import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Line, ComposedChart } from "recharts";
import type { LgdMigrationMatrix } from "../../engine/nbfcSidecarParser";

interface Props {
  lgdData: LgdMigrationMatrix[];
}

/**
 * LGD Stage Migration Chart — Stacked bar showing gross carrying amounts
 * by stage (1/2/3) over time, with Stage 3 % line overlay.
 */
export default function LgdStageChart({ lgdData }: Props) {
  if (!lgdData || lgdData.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">ECL Stage Migration</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 periods of LGD data.</p>
      </div>
    );
  }

  // Build chart data from closing balances
  const data = lgdData.map(d => {
    const s1 = d.gross_carrying.closing?.stage1 ?? 0;
    const s2 = d.gross_carrying.closing?.stage2 ?? 0;
    const s3 = d.gross_carrying.closing?.stage3 ?? 0;
    const total = s1 + s2 + s3;
    return {
      period: d.fiscal_label,
      "Stage 1": +(s1 / 100).toFixed(0),  // Convert Lakhs to Cr
      "Stage 2": +(s2 / 100).toFixed(0),
      "Stage 3": +(s3 / 100).toFixed(0),
      "S3 %": total > 0 ? +((s3 / total) * 100).toFixed(2) : 0,
    };
  });

  // ECL provision coverage data
  const eclData = lgdData.map(d => {
    const grossS3 = d.gross_carrying.closing?.stage3 ?? 0;
    const eclS3 = d.ecl.closing?.stage3 ?? 0;
    const coverage = grossS3 > 0 ? (eclS3 / grossS3) * 100 : 0;
    return {
      period: d.fiscal_label,
      "ECL Stage 1": +(d.ecl.closing?.stage1 ?? 0) / 100,
      "ECL Stage 2": +(d.ecl.closing?.stage2 ?? 0) / 100,
      "ECL Stage 3": +(d.ecl.closing?.stage3 ?? 0) / 100,
      "S3 Coverage %": +coverage.toFixed(1),
    };
  });

  // Write-off trend
  const writeoffData = lgdData.map(d => ({
    period: d.fiscal_label,
    "Write-offs": +(d.gross_carrying.writeoff?.total ?? 0) / 100,
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">ECL Stage Migration (Loss Given Default)</h3>
        <p className="text-xs text-slate-500">Gross carrying amounts by IndAS 109 stage. Stage 3 = credit-impaired.</p>
      </div>

      {/* Stacked bar: Gross Carrying by Stage */}
      <div>
        <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Gross Carrying Amount by Stage (₹ Cr)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 'auto']} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="left" dataKey="Stage 1" stackId="a" fill="#3b82f6" />
            <Bar yAxisId="left" dataKey="Stage 2" stackId="a" fill="#f59e0b" />
            <Bar yAxisId="left" dataKey="Stage 3" stackId="a" fill="#ef4444" />
            <Line yAxisId="right" type="monotone" dataKey="S3 %" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ECL Provision Coverage */}
      <div>
        <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">ECL Provisions + Stage 3 Coverage</h4>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={eclData} margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="left" dataKey="ECL Stage 1" stackId="a" fill="#93c5fd" />
            <Bar yAxisId="left" dataKey="ECL Stage 2" stackId="a" fill="#fcd34d" />
            <Bar yAxisId="left" dataKey="ECL Stage 3" stackId="a" fill="#fca5a5" />
            <Line yAxisId="right" type="monotone" dataKey="S3 Coverage %" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Write-off trend */}
      {writeoffData.some(d => d["Write-offs"] > 0) && (
        <div>
          <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Write-offs (₹ Cr)</h4>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={writeoffData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Bar dataKey="Write-offs" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
