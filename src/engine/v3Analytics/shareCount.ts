/* ══════════════════════════════════════════════════════════════════
   §16.1 Share-count derivation
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ../types and ./shared only — no back-edge to v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { RecastPeriod } from "../types";
import { CanonicalOutputRegistry } from "./shared";

/**
 * Share-count resolution.
 *
 * Two distinct purposes, two distinct bases:
 *   - `sharesForPerShare`  : diluted weighted average (ties to reported EPS,
 *                            what analysts quote for P/E, intrinsic-per-share).
 *   - `sharesForMarketCap` : period-end paid-up (the equity outstanding today,
 *                            the right denominator for market cap & EV).
 *
 * For most companies these are identical (no share issuance during the year).
 * They diverge when there's a mid-period issuance (ESOP, QIP) — the diluted WA
 * captures the partial-year average while the period-end captures the full
 * post-issuance count.
 *
 * The legacy `shares` field is kept for back-compat and equals
 * `sharesForPerShare`.
 */
export interface ShareCountResult {
  /** Diluted weighted average shares (Cr). Used for per-share valuation. */
  sharesForPerShare: number | null;
  /** Period-end paid-up shares (Cr). Used for market cap and EV. */
  sharesForMarketCap: number | null;
  /** Back-compat alias for `sharesForPerShare`. */
  shares: number | null;
  /** Source for the per-share basis. */
  source: string;
  /** Source for the market-cap basis (often different from `source`). */
  sourceForMarketCap: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "FAILED";
  dilution_note?: string | undefined;
}

export function deriveShareCount(
  periods: RecastPeriod[],
  registry?: CanonicalOutputRegistry | undefined,
  fallbackVPrimary?: number | undefined,
): ShareCountResult {
  const latest = periods[periods.length - 1]!;
  const directLatestShares = latest.shareCountInput?.endPeriodShares ?? null;
  const weightedAverageShares = latest.shareCountInput?.weightedAverageBasicShares ?? null;
  const dilutedWeightedAverageShares = latest.shareCountInput?.weightedAverageDilutedShares ?? null;
  const shareHistory = periods
    .map((period) => period.shareCountInput?.endPeriodShares ?? period.shareCountInput?.weightedAverageBasicShares ?? null)
    .filter((value): value is number => value != null && value > 0 && Number.isFinite(value));
  const shareExpansion = shareHistory.slice(-5).reduce((sum, shares, idx, arr) => {
    if (idx === 0) return sum;
    return sum + Math.max(0, shares - arr[idx - 1]!);
  }, 0);
  const dilutionBase = periods.slice(Math.max(1, periods.length - 5)).reduce((sum, p, idx) => {
    const prev = periods[Math.max(0, periods.length - 5) + idx - 1];
    if (!prev) return sum;
    return sum + Math.max(0, p.bs.CSE - prev.bs.CSE);
  }, 0);
  const buildShareDilutionNote = (basis: "direct" | "weighted_average" | "proxy", anchor: number) => {
    if (basis === "proxy") {
      return dilutionBase > 0.02 * Math.abs(anchor)
        ? `Recent 5Y equity expansion proxy: ₹${dilutionBase.toFixed(0)} Cr; per-share value may be diluted.`
        : "Minimal recent equity expansion proxy.";
    }
    if (shareHistory.length < 2) {
      return basis === "weighted_average"
        ? "Using weighted average basic shares because a period-end share count was not resolved."
        : "Using audited period-end shares from the input capital schedule.";
    }
    return shareExpansion > 0.02 * Math.abs(shareHistory[shareHistory.length - 1] ?? anchor)
      ? `Recent 5Y share-count expansion: ${shareExpansion.toFixed(2)} Cr shares; per-share value may be diluted.`
      : "Minimal recent share-count expansion over the last 5Y.";
  };

  // Per-share basis: prefer diluted weighted average, then basic WA, then period-end.
  // Market-cap basis: prefer period-end paid-up, then fall back to per-share basis.
  let perShareShares: number | null = null;
  let perShareSource = "";
  let perShareConfidence: ShareCountResult["confidence"] = "FAILED";
  let marketCapShares: number | null = null;
  let marketCapSource = "";

  if (dilutedWeightedAverageShares && dilutedWeightedAverageShares > 0) {
    perShareShares = dilutedWeightedAverageShares;
    perShareSource = latest.shareCountInput?.weightedAverageDilutedSource || "Diluted weighted-average shares (latest period)";
    perShareConfidence = "HIGH";
  } else if (weightedAverageShares && weightedAverageShares > 0) {
    perShareShares = weightedAverageShares;
    perShareSource = latest.shareCountInput?.weightedAverageBasicSource || "Weighted average basic shares (latest period)";
    perShareConfidence = "MEDIUM";
  }

  if (directLatestShares && directLatestShares > 0) {
    marketCapShares = directLatestShares;
    marketCapSource = latest.shareCountInput?.endPeriodSharesSource || "Audited period-end share count";
  }

  // If we have a per-share basis but no market-cap basis, fall back to the per-share
  // basis for market cap (this is the common case for companies with stable share count).
  if (marketCapShares == null && perShareShares != null) {
    marketCapShares = perShareShares;
    marketCapSource = perShareSource;
  }

  if (directLatestShares && directLatestShares > 0) {
    const source = latest.shareCountInput?.endPeriodSharesSource || "Audited period-end share count";
    // Confidence rule: when diluted/basic WA is available it is the per-share
    // denominator and drives confidence; otherwise period-end audited shares
    // are a defensible fallback. A generic Share Capital proxy is weaker.
    const directConfidence: ShareCountResult["confidence"] = source.toLowerCase().includes("share capital") ? "MEDIUM" : "HIGH";
    const confidence: ShareCountResult["confidence"] = perShareConfidence !== "FAILED" ? perShareConfidence : directConfidence;
    const dilution_note = buildShareDilutionNote("direct", directLatestShares);
    registry?.register("shares_outstanding", perShareShares ?? directLatestShares, "S-16.1");
    registry?.register("shares_source", perShareSource || source, "S-16.1");
    registry?.register("shares_confidence", confidence, "S-16.1");
    registry?.register("dilution_note", dilution_note, "S-16.1");
    return {
      sharesForPerShare: perShareShares ?? directLatestShares,
      sharesForMarketCap: marketCapShares ?? directLatestShares,
      shares: perShareShares ?? directLatestShares,
      source: perShareSource || source,
      sourceForMarketCap: marketCapSource || source,
      confidence,
      dilution_note,
    };
  }

  if (perShareShares != null && perShareShares > 0) {
    const source = perShareSource;
    const dilution_note = buildShareDilutionNote("weighted_average", perShareShares);
    registry?.register("shares_outstanding", perShareShares, "S-16.1");
    registry?.register("shares_source", source, "S-16.1");
    registry?.register("shares_confidence", perShareConfidence, "S-16.1");
    registry?.register("dilution_note", dilution_note, "S-16.1");
    // Per-share basis already set above (diluted or basic WA). For market cap, fall
    // back to per-share basis when no period-end count is available.
    return {
      sharesForPerShare: perShareShares,
      sharesForMarketCap: marketCapShares ?? perShareShares,
      shares: perShareShares,
      source,
      sourceForMarketCap: marketCapSource || source,
      confidence: perShareConfidence,
      dilution_note,
    };
  }

  const equity = latest.bs.CSE;
  const faceCandidates = [1, 2, 5, 10];
  const plausible = faceCandidates
    .map((fv) => ({ fv, shares: equity / fv }))
    .filter((x) => x.shares > 0 && Number.isFinite(x.shares));
  if (!plausible.length) {
    return {
      sharesForPerShare: null,
      sharesForMarketCap: null,
      shares: null,
      source: "Share Capital not available in canonical input",
      sourceForMarketCap: "Share Capital not available in canonical input",
      confidence: "FAILED",
    };
  }
  let selected = plausible.find((x) => x.fv === 1) ?? plausible[0]!;
  let confidence: ShareCountResult["confidence"] = "LOW";
  if (fallbackVPrimary && fallbackVPrimary > 0) {
    const withSanity = plausible.filter((x) => {
      const perShare = fallbackVPrimary / x.shares;
      return perShare > 1 && perShare < 100000;
    });
    if (withSanity.length === 1) {
      selected = withSanity[0]!;
      confidence = "MEDIUM";
    } else if (withSanity.length > 1) {
      selected = withSanity.find((x) => x.fv === 1 || x.fv === 10) ?? withSanity[0]!;
      confidence = "LOW";
    }
  }
  const dilution_note = buildShareDilutionNote("proxy", equity);
  const source = `Equity proxy ₹${equity.toFixed(0)} Cr ÷ inferred face value ₹${selected.fv}`;
  registry?.register("shares_outstanding", selected.shares, "S-16.1");
  registry?.register("shares_source", source, "S-16.1");
  registry?.register("shares_confidence", confidence, "S-16.1");
  registry?.register("dilution_note", dilution_note, "S-16.1");
  // The share-capital proxy is a period-end figure (latest balance sheet) — it
  // serves the market-cap basis naturally. For per-share basis, it's a less
  // defensible denominator (it's not weighted), so confidence is appropriately LOW.
  return {
    sharesForPerShare: perShareShares ?? selected.shares,
    sharesForMarketCap: marketCapShares ?? selected.shares,
    shares: perShareShares ?? selected.shares,
    source: perShareSource || source,
    sourceForMarketCap: marketCapSource || source,
    confidence,
    dilution_note,
  };
}
