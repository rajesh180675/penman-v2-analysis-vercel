/* ══════════════════════════════════════════════════════════════════
   §16.1 Share-count derivation
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ../types and ./shared only — no back-edge to v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { RecastPeriod } from "../types";
import { CanonicalOutputRegistry } from "./shared";

export interface ShareCountResult {
  shares: number | null;
  source: string;
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

  if (directLatestShares && directLatestShares > 0) {
    const source = latest.shareCountInput?.endPeriodSharesSource || "Audited period-end share count";
    const confidence: ShareCountResult["confidence"] = /share capital/i.test(source) ? "MEDIUM" : "HIGH";
    const dilution_note = buildShareDilutionNote("direct", directLatestShares);
    registry?.register("shares_outstanding", directLatestShares, "S-16.1");
    registry?.register("shares_source", source, "S-16.1");
    registry?.register("shares_confidence", confidence, "S-16.1");
    registry?.register("dilution_note", dilution_note, "S-16.1");
    return { shares: directLatestShares, source, confidence, dilution_note };
  }

  if (weightedAverageShares && weightedAverageShares > 0) {
    const source = latest.shareCountInput?.weightedAverageBasicSource || "Weighted average basic shares";
    const dilution_note = buildShareDilutionNote("weighted_average", weightedAverageShares);
    registry?.register("shares_outstanding", weightedAverageShares, "S-16.1");
    registry?.register("shares_source", source, "S-16.1");
    registry?.register("shares_confidence", "MEDIUM", "S-16.1");
    registry?.register("dilution_note", dilution_note, "S-16.1");
    return { shares: weightedAverageShares, source, confidence: "MEDIUM", dilution_note };
  }

  const equity = latest.bs.CSE;
  const faceCandidates = [1, 2, 5, 10];
  const plausible = faceCandidates
    .map((fv) => ({ fv, shares: equity / fv }))
    .filter((x) => x.shares > 0 && Number.isFinite(x.shares));
  if (!plausible.length) {
    return { shares: null, source: "Share Capital not available in canonical input", confidence: "FAILED" };
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
  return { shares: selected.shares, source, confidence, dilution_note };
}
