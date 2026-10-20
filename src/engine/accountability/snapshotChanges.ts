import type { ForecastSnapshot, ForecastSnapshotBasis, SnapshotYear } from "./snapshot";

/** What a comparison reads of a snapshot, so the browser's copy of one compares as the file does. */
export type ComparedSnapshot = Pick<ForecastSnapshot, "ticker" | "madeAt" | "cutoffPeriod" | "assumptions" | "intrinsicPerShare"> & {
  readonly years: readonly Pick<SnapshotYear, "sales" | "operatingIncome" | "noa">[];
  readonly basis?: Partial<ForecastSnapshotBasis> | undefined;
};

/**
 * What moved in one company's frozen base case between two snapshot sets: the
 * value, the capital costs, and the year-one drivers the forecast was built on.
 * A record of change, not an attribution: the value moves with all of them at
 * once, and nothing here re-values one in isolation.
 */
export interface SnapshotChange {
  readonly ticker: string;
  readonly from: string;
  readonly to: string;
  readonly value: { readonly from: number | null; readonly to: number | null };
  /** (to − from) / |from|, or null when either value is missing or the earlier is zero. */
  readonly valueChange: number | null;
  /** Moves in the capital costs and terminal growth, in absolute rates. */
  readonly ke: number;
  readonly kw: number;
  readonly g: number;
  /** Year-one core operating margin (operating income / sales) in each set. */
  readonly margin: { readonly from: number | null; readonly to: number | null };
  /** Year-one turnover (sales / year-end NOA) in each set. */
  readonly turnover: { readonly from: number | null; readonly to: number | null };
  /** Why the two forecasts are not of the same anchor and business, when they are not. */
  readonly basisChange: string | null;
}

const ratio = (num: number | undefined, den: number | undefined) =>
  num != null && den != null && Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : null;

/** The year-one core operating margin (operating income / sales) and turnover (sales / year-end NOA) a forecast starts from. */
export function yearOneDrivers(s: ComparedSnapshot): { readonly margin: number | null; readonly turnover: number | null } {
  const y = s.years[0];
  return { margin: ratio(y?.operatingIncome, y?.sales), turnover: ratio(y?.sales, y?.noa) };
}

function basisChange(a: ComparedSnapshot, b: ComparedSnapshot): string | null {
  const notes: string[] = [];
  if (a.cutoffPeriod !== b.cutoffPeriod) notes.push(`anchor ${a.cutoffPeriod.slice(0, 7)} → ${b.cutoffPeriod.slice(0, 7)}`);
  // Snapshots before v2 record no basis; only a recorded change is reported.
  if (a.basis?.accounts && b.basis?.accounts && a.basis.accounts !== b.basis.accounts) notes.push(`accounts ${a.basis.accounts} → ${b.basis.accounts}`);
  if (a.basis && b.basis && (a.basis.lendingArm ?? null) !== (b.basis.lendingArm ?? null)) {
    notes.push(`lending arm ${a.basis.lendingArm ?? "none"} → ${b.basis.lendingArm ?? "none"}`);
  }
  return notes.length ? notes.join("; ") : null;
}

/** The companies frozen in both sets, compared. */
export function compareSnapshots(earlier: readonly ComparedSnapshot[], later: readonly ComparedSnapshot[]): SnapshotChange[] {
  const before = new Map(earlier.map((s) => [s.ticker, s]));
  return later.flatMap((b): SnapshotChange[] => {
    const a = before.get(b.ticker);
    if (!a) return [];
    const [da, db] = [yearOneDrivers(a), yearOneDrivers(b)];
    const valueChange = a.intrinsicPerShare != null && b.intrinsicPerShare != null && a.intrinsicPerShare !== 0
      ? (b.intrinsicPerShare - a.intrinsicPerShare) / Math.abs(a.intrinsicPerShare)
      : null;
    return [{
      ticker: b.ticker,
      from: a.madeAt,
      to: b.madeAt,
      value: { from: a.intrinsicPerShare, to: b.intrinsicPerShare },
      valueChange,
      ke: b.assumptions.ke - a.assumptions.ke,
      kw: b.assumptions.kw - a.assumptions.kw,
      g: b.assumptions.g - a.assumptions.g,
      margin: { from: da.margin, to: db.margin },
      turnover: { from: da.turnover, to: db.turnover },
      basisChange: basisChange(a, b),
    }];
  });
}
