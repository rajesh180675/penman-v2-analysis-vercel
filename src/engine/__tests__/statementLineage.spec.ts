/* ================================================================
   buildStatementLineage: what it returns and what it must stop
   throwing away.

   `segmentHints` used to be truncated to 12 inside this function.
   Its only consumer renders every hint it is handed and showed no
   total, so Hindustan Unilever's 35 hints appeared as 12 chips with
   nothing saying more existed. Display truncation now lives in the
   panel, which reports the remainder — these pin that the engine
   hands over the whole list, and that the period ordering the panel
   reverses for display stays ascending here, because the
   restatement signals are computed against the previous row.
================================================================ */

import { describe, expect, it } from "vitest";
import { buildStatementLineage } from "../statementLineage";
import type { RawPeriodData } from "../types";

function period(periodEnd: string, raw: Record<string, number> = {}): RawPeriodData {
  return { company_id: "TESTCO", period_end: periodEnd, raw_metric_values: raw };
}

/** `n` distinct labels the segment classifier recognises. */
function segmentLabels(n: number) {
  const raw: Record<string, number> = {};
  for (let i = 0; i < n; i += 1) raw[`Segment Revenue ${i}__ProfitLoss`] = 100 + i;
  return raw;
}

describe("buildStatementLineage segment hints", () => {
  it("returns every hint, with no ceiling of its own", () => {
    // 35 is Hindustan Unilever's count, the largest in the bundled registry, and
    // the case the old slice(0, 12) mangled worst.
    const lineage = buildStatementLineage([period("2025-03-31", segmentLabels(35))]);
    expect(lineage.segmentHints).toHaveLength(35);
  });

  it("still returns hints when there are fewer than a screenful", () => {
    const lineage = buildStatementLineage([period("2025-03-31", segmentLabels(3))]);
    expect(lineage.segmentHints).toHaveLength(3);
  });

  it("keeps a label that contains a colon intact", () => {
    // The type and label were packed into one `type:label` string to dedupe, then
    // unpacked with split(":"), which kept only the fragment before the first
    // colon. Latent while the 12-cap hid most labels; not once all of them render.
    const lineage = buildStatementLineage([
      period("2025-03-31", { "Segment Revenue: India__ProfitLoss": 100 }),
    ]);
    expect(lineage.segmentHints).toEqual([
      { type: "operating-segment", label: "segment revenue: india" },
    ]);
  });

  it("counts a label appearing on two statements once", () => {
    const lineage = buildStatementLineage([
      period("2025-03-31", {
        "Segment Revenue__ProfitLoss": 100,
        "Segment Revenue__BalanceSheet": 100,
      }),
    ]);
    expect(lineage.segmentHints).toHaveLength(1);
  });

  it("classifies from the latest period, not the first", () => {
    const lineage = buildStatementLineage([
      period("2024-03-31", segmentLabels(4)),
      period("2025-03-31", { "Export Sales__ProfitLoss": 100 }),
    ]);
    expect(lineage.segmentHints).toEqual([{ type: "geography", label: "export sales" }]);
  });

  it("returns no hints when nothing segment-like is disclosed", () => {
    const lineage = buildStatementLineage([
      period("2025-03-31", { "Revenue From Operations__ProfitLoss": 100 }),
    ]);
    expect(lineage.segmentHints).toEqual([]);
  });
});

describe("buildStatementLineage ordering", () => {
  it("returns versions in the order the periods arrived, oldest first", () => {
    // The panel reverses this for display. It has to stay ascending here: each
    // version's restatement signals compare against rows[index - 1], so
    // "previous filing" is defined by this order.
    const lineage = buildStatementLineage([
      period("2023-03-31"),
      period("2024-03-31"),
      period("2025-03-31"),
    ]);
    expect(lineage.versions.map((item) => item.periodEnd)).toEqual([
      "2023-03-31",
      "2024-03-31",
      "2025-03-31",
    ]);
  });

  it("compares each filing against the one before it in that order", () => {
    // Revenue triples between the first two filings. The signal belongs to the
    // later of the pair; if the comparison ran the other way it would land on the
    // earlier one, and the panel would name the wrong filing as suspect.
    const lineage = buildStatementLineage([
      period("2024-03-31", { "Revenue From Operations__ProfitLoss": 100 }),
      period("2025-03-31", { "Revenue From Operations__ProfitLoss": 300 }),
    ]);
    expect(lineage.versions[0]!.restatementSignals).toHaveLength(0);
    expect(lineage.versions[1]!.restatementSignals.length).toBeGreaterThan(0);
    expect(lineage.restatementCandidates[0]).toContain("2025-03-31");
  });
});

describe("buildStatementLineage filing mix", () => {
  it("counts every filing, including ones whose period end it cannot classify", () => {
    // The panel prints annual/quarterly/ttm and now unknown too. If unknown were
    // dropped from the mix the chip would not sum to the filing count.
    const lineage = buildStatementLineage([
      period("2024-03-31"),
      period("2024-09-30"),
      period("2024-11-15"),
    ]);
    const { annual, quarterly, ttm, unknown } = lineage.filingMix;
    expect(annual).toBe(1);
    expect(quarterly).toBe(1);
    expect(ttm).toBe(0);
    expect(unknown).toBe(1);
    expect(annual + quarterly + ttm + unknown).toBe(lineage.versions.length);
  });
});
