/**
 * The Capitaline lines the pipeline reads by name, as one list.
 *
 * `processCompanyDataFull` reads its lines by name: the recast
 * (src/engine/PenmanNissimEngine) through the key lists in
 * `CapitalineMappingSpec` and a few lists written in place in its own modules,
 * the scope check (scopePolicy.ts) through its sector signals, and the
 * greenfield step (greenfieldPipeline/l1Normalize.ts) through its fallbacks. A
 * label none of them names is never read there. So a fact set holding a fact
 * for each of these lines holds every value the pipeline can read: rebuilt
 * into periods from such a set alone, every library company's pipeline came
 * out identical, field by field (measured 2026-10-28 and 2026-10-29 across the
 * 33 library runs). Every other value is reached only by scans that list or
 * count the parse (mapping audit, quality gate, parser fidelity, the
 * unusual-item keyword screen), and those read the parse itself.
 *
 * Labels are matched the way the recast's picker matches them
 * (PenmanNissimEngine/picking.ts): case, spacing and punctuation folded, plus
 * the export's spelling slips ("0ther", "Long Tem"). A balance-sheet row that
 * repeats a label inside current assets or liabilities is kept by the parser
 * as "<label> - Current Assets" or "<label> - Current", and is read by name
 * with the suffix, so a named label's two twins count as named too.
 */
import { CapitalineMappingSpec } from "../mappingSpec";

/**
 * Lists the pipeline writes in place rather than in `CapitalineMappingSpec`.
 * `recastLineCatalog.spec.ts` parses the modules that read them and fails when
 * one names a label that is in neither, so a new inline list cannot be missed.
 */
export const RECAST_INLINE_LINES: readonly string[] = [
  // recast.ts
  "Liabilities Directly Associated with Assets Classified as Held for Sale",
  "Non-Current Assets Classified as Held for Sale",
  "Other Assets Excluding Non-Current and Current Assets",
  "Trade Payables - Current",
  "Net Current Assets",
  "Current Liabilities",
  "Forward Contract Receivable",
  "Lease Liabilities - Current",
  "Right of Use Assets",
  "Right-of-Use Assets",
  "Regulatory Deferral Account - Debit Balance",
  "Regulatory Deferral Account Debit Balance",
  "Regulatory Assets",
  "Deferred Tax Assets (Net)",
  "Net Deferred Tax Assets",
  "Deferred Tax Assets",
  "Capital Work in Progress",
  "Capital Work-in-Progress",
  "Tax Expense of Discontinuing Operations",
  // picking.ts (share count)
  "Total Equity Capital(Ordinary)",
  "Equity Paid up",
  "Share Capital",
  "Equity Share Capital",
  "Face Value of Subscribed Shares Fully Paid up",
  "Face Value of Ordinary Shares A - Subscribed Fully Paid up",
  "Face Value of Equity Shares",
  "Number of Equity Shares - Paid Up",
  "Total Number of Equity Shares - Subscribed",
  // quality.ts
  "Gross Property, plant and equipment",
  // scopePolicy.ts: the financial-sector and utility signals the pipeline
  // routes on. The scope check counts each label's periods, so without these
  // HDFC Life and LIC read as having no insurance signal.
  "Bills Purchased and Discounted",
  "Money at Call and Short Notice",
  "Borrowings from RBI",
  "Assets Held to Cover Linked Liabilities (Insurance Business)",
  "Assets Held to Cover Discontinued Funds (Insurance Business)",
  "Investment - Insurance Operation (Insurance Business)",
  "Reinsurance Expenses",
  "Income from Financial Services",
  "Assets on Hire Purchase",
  "Loan to Customer",
  "Finance Lease Receivables",
  "Regulatory Deferral Account - Credit Balance",
  // greenfieldPipeline/l1Normalize.ts: its fallbacks when the recast leaves a
  // field empty (none fires on the library today).
  "Total Income",
  "Free Cash Flow",
  "Net Financial Obligation",
  "Payment for Acquisition of Property, Plant and Equipment",
  "Proceeds from Issue of Share Capital",
  "Share Buybacks",
];

/** The suffixes the parser gives a balance-sheet row repeated inside a current block. */
const CURRENT_TWIN_SUFFIXES = [" - Current Assets", " - Current"] as const;

/** The recast picker's label normalization (PenmanNissimEngine/picking.ts). */
export function normalizeRecastLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/0ther/g, "other")
    .replace(/shorttem/g, "shortterm")
    .replace(/longtem/g, "longterm")
    .replace(/\btem\b/g, "term")
    .replace(/amotisation/g, "amortisation")
    .replace(/[^a-z0-9]/g, "");
}

function specLabels(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) specLabels(item, out);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) specLabels(item, out);
  return out;
}

const NAMED = new Set(
  [...specLabels(CapitalineMappingSpec, []), ...RECAST_INLINE_LINES].map(normalizeRecastLabel),
);

/** Whether the recast reads a line with this base label (no `__Statement` suffix). */
export function isRecastLine(baseLabel: string): boolean {
  if (NAMED.has(normalizeRecastLabel(baseLabel))) return true;
  return CURRENT_TWIN_SUFFIXES.some((suffix) =>
    baseLabel.endsWith(suffix) && NAMED.has(normalizeRecastLabel(baseLabel.slice(0, -suffix.length))));
}

/** A fact's unit and stored scale, from what the line counts. */
export interface RecastLineUnit {
  readonly normalizedUnit: "INR_CRORE" | "INR_PER_SHARE" | "ABSOLUTE_SHARES" | "CRORE_SHARES" | "RATIO";
  readonly storedScale: "crore" | "absolute" | "ratio";
  readonly currency: "INR" | null;
}

const INR_CRORE: RecastLineUnit = { normalizedUnit: "INR_CRORE", storedScale: "crore", currency: "INR" };

const ABSOLUTE_SHARES: RecastLineUnit = { normalizedUnit: "ABSOLUTE_SHARES", storedScale: "absolute", currency: null };
const CRORE_SHARES: RecastLineUnit = { normalizedUnit: "CRORE_SHARES", storedScale: "crore", currency: null };
const INR_PER_SHARE: RecastLineUnit = { normalizedUnit: "INR_PER_SHARE", storedScale: "absolute", currency: "INR" };
const PERCENT_OF_FACE_VALUE: RecastLineUnit = { normalizedUnit: "RATIO", storedScale: "ratio", currency: null };

/**
 * The recast lines that are not INR crore, by what they count. Capitaline files
 * each on one scale in every library year (2026-10-29, 33 companies): the
 * authorised, issued and subscribed counts in shares (50 million to 132
 * billion), the paid-up, subscribed-total and weighted-average counts in crore
 * shares (5 to 7,139), the face values in rupees (1 to 10), and the dividend
 * as a percentage of face value (up to 15,750).
 */
const NON_CRORE_UNITS = new Map<string, RecastLineUnit>([
  ["Number of Equity Shares - Authorised", ABSOLUTE_SHARES],
  ["Number of Equity Shares - Issued", ABSOLUTE_SHARES],
  ["Number of Equity Shares - Subscribed Fully Paid up", ABSOLUTE_SHARES],
  ["Number of Equity Shares - Paid Up", CRORE_SHARES],
  ["Total Number of Equity Shares - Subscribed", CRORE_SHARES],
  ["Weighted Average Number of Shares in Issue - Basic", CRORE_SHARES],
  ["Weighted Average Number of Shares in Issue - Diluted", CRORE_SHARES],
  ["Face Value of Subscribed Shares Fully Paid up", INR_PER_SHARE],
  ["Face Value of Ordinary Shares A - Subscribed Fully Paid up", INR_PER_SHARE],
  ["Face Value of Equity Shares", INR_PER_SHARE],
  ["Total Dividend Percentage", PERCENT_OF_FACE_VALUE],
].map(([label, unit]) => [normalizeRecastLabel(label as string), unit as RecastLineUnit]));

/** The unit a recast line's fact is recorded in. */
export function recastLineUnit(baseLabel: string): RecastLineUnit {
  return NON_CRORE_UNITS.get(normalizeRecastLabel(baseLabel)) ?? INR_CRORE;
}
