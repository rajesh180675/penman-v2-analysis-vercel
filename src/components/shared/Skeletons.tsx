/**
 * Skeleton loading states for the analysis tabs.
 * Shows pulsing placeholder UI while data is being processed.
 */

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Verdict banner skeleton */}
      <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 h-24 w-full" />
      {/* KPI grid skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-2xl bg-slate-100 dark:bg-slate-800 h-28" />
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 h-48" />
      {/* Narrative skeleton */}
      <div className="space-y-2">
        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-3/4" />
        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number | undefined; cols?: number }) {
  return (
    <div className="animate-pulse card-base overflow-hidden">
      {/* Header */}
      <div className="h-12 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700" />
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className={`h-4 bg-slate-100 dark:bg-slate-800 rounded ${j === 0 ? "w-32" : "w-16"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className={`animate-pulse card-base ${height} flex items-end gap-2 p-6`}>
      {[40, 65, 45, 80, 55, 70, 50, 75, 60, 85].map((h, i) => (
        <div
          key={i}
          className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-t"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

export function ProcessingOverlay({ step, fileName }: { step: string; fileName?: string }) {
  return (
    <div className="card-base p-8 text-center">
      <div className="inline-flex items-center gap-3 mb-4">
        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{step}</span>
      </div>
      {fileName && (
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{fileName}</p>
      )}
      <div className="mt-4 w-64 mx-auto h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: "60%" }} />
      </div>
    </div>
  );
}
