/**
 * Today's share count when the quote reports none: the shares in issue at the
 * company's latest annual filing, from the as-filed ledger (tie-out.json).
 *
 * The price is per share of today's count, every value per share of the
 * anchor year's. NSE's quote API refuses the request (403), so without the
 * filing a bonus or split since the data's year (HDFC Bank 1:1, Bajaj Finance
 * ×10, Kotak ×5, Nestlé 1:1, all in 2025) went unseen, and values met the
 * price on the wrong count. Both shells fill the snapshot through here.
 */
import type { LiveMarketDataSnapshot } from "../engine/marketData";

export interface FiledShareCount {
  readonly fiscalYearEnd: string;
  readonly sharesOutstandingCr: number;
}

type Ledger = readonly { symbol: string; latestFiling?: { fiscalYearEnd: string; sharesOutstandingCr?: number | null } | null }[];

let ledger: Promise<Ledger | null> | null = null;

/** The latest filing's share count for an NSE symbol; null when the ledger has none. */
export async function fetchFiledShareCount(symbol: string): Promise<FiledShareCount | null> {
  ledger ??= fetch("/data/filings/tie-out.json")
    .then((response) => (response.ok ? (response.json() as Promise<Ledger>) : null))
    .catch(() => null);
  const latest = (await ledger)?.find((c) => c.symbol === symbol)?.latestFiling;
  return latest?.sharesOutstandingCr != null && latest.sharesOutstandingCr > 0
    ? { fiscalYearEnd: latest.fiscalYearEnd, sharesOutstandingCr: latest.sharesOutstandingCr }
    : null;
}

/** The snapshot with the filing's count where the quote has none, saying where it came from. */
export function withFiledShareCount(
  snapshot: LiveMarketDataSnapshot | null,
  filed: FiledShareCount | null,
): LiveMarketDataSnapshot | null {
  if (!snapshot || snapshot.sharesOutstanding != null || !filed) return snapshot;
  return {
    ...snapshot,
    sharesOutstanding: filed.sharesOutstandingCr * 1e7,
    sharesOutstandingSource: `the latest annual filing (${filed.fiscalYearEnd})`,
  };
}
