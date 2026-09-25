/**
 * CorrelationMatrix — N×N heat grid of pairwise correlations between ratio
 * series or peer returns. Diverging blue→white→red scale. Pure CSS grid.
 */
interface CorrelationMatrixProps {
  /** Axis labels (rows = cols) */
  labels: string[];
  /** values[i][j] in [-1, 1]; diagonal typically 1 */
  values: (number | null)[][];
  /** Cell px size */
  cell?: number | undefined;
  className?: string | undefined;
}

function cellColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "var(--color-surface-2)";
  // diverging: -1 → rose, 0 → transparent, +1 → indigo
  if (v >= 0) return `rgba(99, 102, 241, ${(0.12 + v * 0.78).toFixed(2)})`;
  return `rgba(239, 68, 68, ${(0.12 + Math.abs(v) * 0.78).toFixed(2)})`;
}

function cellText(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function textTone(v: number | null): string {
  if (v == null) return "var(--color-text-3)";
  return Math.abs(v) > 0.55 ? "#ffffff" : "var(--color-text-1)";
}

export function CorrelationMatrix({ labels, values, cell = 44, className = "" }: CorrelationMatrixProps) {
  const n = labels.length;
  if (n === 0) return <div className={`wb-chart-empty ${className}`}>No data</div>;
  return (
    <div className={`overflow-x-auto ${className}`}>
      <div
        role="grid"
        aria-label="correlation matrix"
        className="inline-grid gap-[3px]"
        style={{ gridTemplateColumns: `110px repeat(${n}, ${cell}px)` }}
      >
        {/* header row */}
        <div />
        {labels.map((l) => (
          <div key={`h-${l}`} className="flex items-end justify-center pb-1" style={{ width: cell, height: 56 }}>
            <span className="text-[9px] wb-text-3 font-medium whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              {l}
            </span>
          </div>
        ))}
        {labels.map((rowLabel, i) => (
          <CorrelationRow key={rowLabel} label={rowLabel} row={values[i] ?? []} cell={cell} rowIndex={i} />
        ))}
      </div>
      {/* legend */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[9px] wb-text-3">-1</span>
        <div className="h-2 w-24 rounded" style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.9), rgba(99,102,241,0.06), rgba(99,102,241,0.9))" }} />
        <span className="text-[9px] wb-text-3">+1</span>
      </div>
    </div>
  );
}

function CorrelationRow({ label, row, cell, rowIndex }: { label: string; row: (number | null)[]; cell: number; rowIndex: number }) {
  return (
    <>
      <div className="flex items-center pr-2 justify-end">
        <span className="text-[10px] wb-text-2 font-medium truncate max-w-[104px]">{label}</span>
      </div>
      {row.map((v, j) => (
        <div
          key={j}
          role="gridcell"
          className="flex items-center justify-center rounded-[4px] font-mono"
          style={{
            width: cell,
            height: cell,
            background: cellColor(v),
            color: textTone(v),
            fontSize: 10,
            fontWeight: rowIndex === j ? 700 : 500,
            outline: rowIndex === j ? "1.5px solid var(--color-border-strong)" : undefined,
          }}
          title={`${label} × ${j}: ${cellText(v)}`}
        >
          {cellText(v)}
        </div>
      ))}
    </>
  );
}
