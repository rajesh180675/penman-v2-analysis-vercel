import { RawPeriodData } from "./types";
import { findAllRawMetrics, listRawBaseKeys, periodMetricValue } from "./rawMetricTools";

export interface StatementLineageVersion {
  periodEnd: string;
  fiscalYear: string;
  filingKind: "annual" | "quarterly" | "ttm" | "unknown";
  versionTag: string;
  amendmentLikelihood: "low" | "medium" | "high";
  restatementSignals: string[];
}

export interface SegmentHint {
  label: string;
  type: "geography" | "channel" | "product" | "operating-segment";
}

export interface StatementLineageSummary {
  versions: StatementLineageVersion[];
  restatementCandidates: string[];
  segmentHints: SegmentHint[];
  filingMix: {
    annual: number;
    quarterly: number;
    ttm: number;
    unknown: number;
  };
}

function yearFromPeriod(periodEnd: string) {
  return periodEnd.slice(0, 4) || "unknown";
}

function deriveFilingKind(periodEnd: string) {
  if (!periodEnd) return "unknown" as const;
  if (periodEnd.endsWith("-03-31")) return "annual" as const;
  if (periodEnd.endsWith("-06-30") || periodEnd.endsWith("-09-30") || periodEnd.endsWith("-12-31")) return "quarterly" as const;
  return "unknown" as const;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function buildStatementLineage(periods: RawPeriodData[] | null | undefined): StatementLineageSummary {
  const rows = periods ?? [];
  const versions = rows.map((period, index) => {
    const filingKind = deriveFilingKind(period.period_end);
    const revenue = periodMetricValue(period, ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)"]);
    const equity = periodMetricValue(period, ["Total Equity", "Shareholders Funds", "Net Worth", "Total Reserve & Surplus"]);
    const shares = periodMetricValue(period, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"]);
    const prev = index > 0 ? rows[index - 1] : null;
    const prevRevenue = prev ? periodMetricValue(prev, ["Revenue From Operations", "Total Revenue from Operations", "Revenue From Operations(Net)"]) : null;
    const prevEquity = prev ? periodMetricValue(prev, ["Total Equity", "Shareholders Funds", "Net Worth", "Total Reserve & Surplus"]) : null;
    const restatementSignals: string[] = [];
    if (prevRevenue != null && revenue != null && prevRevenue !== 0) {
      const ratio = revenue / prevRevenue;
      if (ratio > 2.25 || ratio < 0.45) restatementSignals.push("Revenue scale changed sharply versus the previous filing.");
    }
    if (prevEquity != null && equity != null && prevEquity !== 0) {
      const ratio = equity / prevEquity;
      if (ratio > 2.1 || ratio < 0.5) restatementSignals.push("Book equity moved at a scale more consistent with reclassification or restatement than ordinary drift.");
    }
    if (shares != null && prev && prev.raw_metric_values) {
      const prevShares = periodMetricValue(prev, ["Number of Equity Shares - Subscribed Fully Paid up", "Number of Equity Shares - Issued"]);
      if (prevShares != null && prevShares > 0) {
        const dilution = shares / prevShares;
        if (dilution > 1.25 || dilution < 0.8) restatementSignals.push("Share count changed materially, so per-share comparability should be checked.");
      }
    }
    return {
      periodEnd: period.period_end,
      fiscalYear: yearFromPeriod(period.period_end),
      filingKind,
      versionTag: `${yearFromPeriod(period.period_end)}-${filingKind}-${index + 1}`,
      amendmentLikelihood: restatementSignals.length >= 2 ? "high" : restatementSignals.length === 1 ? "medium" : "low",
      restatementSignals,
    } satisfies StatementLineageVersion;
  });

  const latest = rows[rows.length - 1];
  const rawLabels = listRawBaseKeys(latest).map((label) => label.toLowerCase());
  const segmentCandidates: SegmentHint[] = rawLabels.flatMap((label): SegmentHint[] => {
    if (label.includes("domestic") || label.includes("export") || label.includes("geographical")) {
      return [{ label, type: "geography" }];
    }
    if (label.includes("segment")) {
      return [{ label, type: "operating-segment" }];
    }
    if (label.includes("product") || label.includes("brand")) {
      return [{ label, type: "product" }];
    }
    if (label.includes("dealer") || label.includes("distribution") || label.includes("channel")) {
      return [{ label, type: "channel" }];
    }
    return [];
  });
  // Deliberately uncapped. This used to `.slice(0, 12)` here, which bound for 6 of
  // the 12 companies sampled — Hindustan Unilever has 35 hints, Cholamandalam and
  // HDFC Life 33 each — and the only consumer renders every hint it is handed with
  // no total, so 35 appeared as 12 and nothing said so. Truncating for display is
  // the panel's business (`statementLineageWindow.ts`), and it can only report how
  // many it dropped if this function stops dropping them first.
  const segmentHints = unique(
    segmentCandidates.map((item) => `${item.type}:${item.label}`),
  ).map((entry) => {
    const separator = entry.indexOf(":");
    return {
      type: entry.slice(0, separator) as SegmentHint["type"],
      // `split(":")` took only the first fragment, so a label containing a colon
      // rendered truncated. Fine while the cap hid most of them; not once every
      // hint is shown.
      label: entry.slice(separator + 1),
    };
  });

  const filingMix = versions.reduce(
    (acc, version) => {
      acc[version.filingKind] += 1;
      return acc;
    },
    { annual: 0, quarterly: 0, ttm: 0, unknown: 0 },
  );

  const restatementCandidates = versions
    .filter((item) => item.amendmentLikelihood !== "low")
    .map((item) => `${item.periodEnd}: ${item.restatementSignals.join(" ")}`);

  return {
    versions,
    restatementCandidates,
    segmentHints,
    filingMix,
  };
}

export function extractSegmentSeries(periods: RawPeriodData[] | null | undefined) {
  return (periods ?? []).map((period) => {
    const matches = findAllRawMetrics(period, [
      "Domestic Sales",
      "Export Sales",
      "Geographical Segment Revenue",
      "Revenue by Segment",
    ]);
    return {
      periodEnd: period.period_end,
      labels: matches.map((item) => item.key),
    };
  });
}
