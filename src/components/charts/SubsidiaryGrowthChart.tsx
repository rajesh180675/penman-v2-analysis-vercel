import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

interface SubsidiaryRecord {
  name: string;
  pat_cr?: number | null | undefined;
  total_assets_cr?: number | null | undefined;
}

interface Props {
  /** Quality periods with subsidiary data, ordered chronologically */
  periods: Array<{
    fiscal_label: string;
    subsidiaries?: SubsidiaryRecord[] | undefined;
  }>;
}

/**
 * Subsidiary Growth Chart — PAT and Total Assets trends for each subsidiary.
 * Shows how subsidiary businesses have scaled over time.
 */
export default function SubsidiaryGrowthChart({ periods }: Props) {
  // Filter to periods that have subsidiary data
  const withSubs = periods.filter(p => p.subsidiaries && p.subsidiaries.length > 0);
  if (withSubs.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Subsidiary Growth</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 periods with subsidiary data.</p>
      </div>
    );
  }

  // Get unique subsidiary names across all periods
  const subNames = new Set<string>();
  for (const p of withSubs) {
    for (const s of p.subsidiaries ?? []) {
      if (s.name) subNames.add(s.name);
    }
  }
  const names = Array.from(subNames);

  // Build chart data — one row per period, columns for each sub's PAT
  const patData = withSubs.map(p => {
    const row: Record<string, string | number | null> = { period: p.fiscal_label };
    for (const name of names) {
      const sub = (p.subsidiaries ?? []).find(s => s.name === name);
      row[`${name}_PAT`] = sub?.pat_cr ?? null;
    }
    return row;
  });

  // Build assets data
  const assetsData = withSubs.map(p => {
    const row: Record<string, string | number | null> = { period: p.fiscal_label };
    for (const name of names) {
      const sub = (p.subsidiaries ?? []).find(s => s.name === name);
      row[`${name}_Assets`] = sub?.total_assets_cr ?? null;
    }
    return row;
  });

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Subsidiary Growth Trends</h3>
        <p className="text-xs text-slate-500">PAT and Total Assets of key subsidiaries over time.</p>
      </div>

      {/* PAT Chart */}
      <div>
        <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">PAT (₹ Cr)</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={patData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
              formatter={(value: unknown) => [typeof value === "number" ? `₹${value.toLocaleString("en-IN")} Cr` : "—", ""]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {names.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={`${name}_PAT`}
                name={name.replace(/Bajaj /g, "")}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Total Assets Chart */}
      <div>
        <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Total Assets (₹ Cr)</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={assetsData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
              formatter={(value: unknown) => [typeof value === "number" ? `₹${value.toLocaleString("en-IN")} Cr` : "—", ""]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {names.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={`${name}_Assets`}
                name={name.replace(/Bajaj /g, "")}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
