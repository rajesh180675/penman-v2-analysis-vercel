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
  /** Whether both snapshots record their basis; before schema v2 only the anchor can be compared. */
  readonly basisRecorded: boolean;
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
      basisRecorded: a.basis != null && b.basis != null,
    }];
  });
}

/** What a change says of its anchor and basis: what changed, or that neither did, or only the anchor where no basis is recorded. */
export const anchorOrBasis = (c: SnapshotChange): string => c.basisChange ?? (c.basisRecorded ? "same" : "same anchor");

/** A value that moved by less than this, on the same anchor and basis, is counted rather than listed. */
export const LISTED_VALUE_CHANGE = 0.005;

/** One pair of consecutive snapshot sets, compared. */
export interface SnapshotSetChanges {
  readonly from: string;
  readonly to: string;
  /** How many companies were frozen in both sets. */
  readonly compared: number;
  /**
   * Those whose value moved by at least LISTED_VALUE_CHANGE, could not be
   * compared, or changed anchor or basis: the largest move first.
   */
  readonly listed: readonly SnapshotChange[];
  /** Tickers frozen only in the later set, and only in the earlier. */
  readonly added: readonly string[];
  readonly dropped: readonly string[];
  /** Which of the two sets record no basis (schema v1), so a change of business cannot show. */
  readonly unrecordedBasis: readonly string[];
}

/** Every pair of consecutive sets among these snapshots, oldest first; each set keeps the order its snapshots are given in. */
export function compareSnapshotSets(snapshots: readonly ComparedSnapshot[]): SnapshotSetChanges[] {
  const sets = [...new Set(snapshots.map((s) => s.madeAt))].sort();
  const inSet = (madeAt: string) => snapshots.filter((s) => s.madeAt === madeAt);
  return sets.slice(1).map((to, i) => {
    const from = sets[i]!;
    const [earlier, later] = [inSet(from), inSet(to)];
    const changes = compareSnapshots(earlier, later);
    return {
      from,
      to,
      compared: changes.length,
      listed: changes
        .filter((c) => c.basisChange != null || c.valueChange == null || Math.abs(c.valueChange) >= LISTED_VALUE_CHANGE)
        .sort((x, y) => Math.abs(y.valueChange ?? 0) - Math.abs(x.valueChange ?? 0)),
      added: later.filter((s) => !earlier.some((e) => e.ticker === s.ticker)).map((s) => s.ticker),
      dropped: earlier.filter((s) => !later.some((e) => e.ticker === s.ticker)).map((s) => s.ticker),
      unrecordedBasis: ([[from, earlier], [to, later]] as const).filter(([, set]) => set.some((s) => !s.basis)).map(([name]) => name),
    };
  });
}

const pct = (x: number | null) => (x == null ? "—" : `${x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1)}%`);
const signedPct = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`);
const points = (x: number) => (Math.abs(x) < 0.00005 ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}`);
const rupees = (x: number | null) => (x == null ? "—" : `${x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 1 })}`);
const times = (x: number | null) => (x == null ? "—" : `${x.toFixed(2)}×`);
const pair = (a: number | null, b: number | null, f: (x: number | null) => string) => (f(a) === f(b) ? f(b) : `${f(a)} → ${f(b)}`);

/**
 * A listed change as the record writes it, column by column: the Record page
 * and docs/generated/frozen-forecast-changes.md both show these strings.
 */
export function snapshotChangeCells(c: SnapshotChange): readonly string[] {
  return [
    c.ticker,
    pair(c.value.from, c.value.to, rupees),
    signedPct(c.valueChange),
    points(c.ke),
    points(c.kw),
    points(c.g),
    pair(c.margin.from, c.margin.to, pct),
    pair(c.turnover.from, c.turnover.to, times),
    anchorOrBasis(c),
  ];
}

/** The headings of snapshotChangeCells' columns. */
export const SNAPSHOT_CHANGE_COLUMNS = [
  "Company", "Value per share", "Change", "ke (pp)", "kw (pp)", "g (pp)", "Year-one margin", "Year-one turnover", "Anchor or basis",
] as const;
