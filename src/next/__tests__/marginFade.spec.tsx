import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForecastPeriod, RecastPeriod } from "../../engine/types";
import { latestSnapshotFor, type FrozenSnapshot } from "../hooks";
import { MARGIN_HISTORY_YEARS, MarginFadeChart, marginFadeRows } from "../ui/MarginFadeChart";

const period = (year: number, margin: number) =>
  ({ period_end: `${year}-03-31`, ratios: { CoreSalesPM: margin }, is: { Sales: 100 }, cu: { CoreOI: margin * 100 } }) as unknown as RecastPeriod;
const history = Array.from({ length: 10 }, (_, i) => period(2016 + i, 0.1 + i * 0.01)); // FY2016…FY2025
const forecast = [0.18, 0.17, 0.16].map((m) => ({ core_sales_pm_assumption: m }) as ForecastPeriod);
const frozen = {
  madeAt: "2026-09-25",
  cutoffPeriod: "2024-03-31",
  years: [{ periodEnd: "2025-03-31", sales: 200, operatingIncome: 40 }, { periodEnd: "2026-03-31", sales: 220, operatingIncome: 33 }],
};

describe("marginFadeRows", () => {
  const rows = marginFadeRows(history, "2025-03-31", forecast, frozen);
  const at = (year: number) => rows.find((r) => r.year === year)!;

  it("shows the latest eight reported years", () => {
    expect(MARGIN_HISTORY_YEARS).toBe(8);
    expect(rows.filter((r) => r.reported != null).map((r) => r.year)).toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  });

  it("starts the current forecast at the anchor's reported margin, then follows the forecast years", () => {
    expect(at(2025).forecast).toBeCloseTo(0.19, 12);
    expect([at(2026).forecast, at(2027).forecast, at(2028).forecast]).toEqual([0.18, 0.17, 0.16]);
  });

  it("starts the frozen forecast at its own cutoff and reads its margins as OI ÷ sales", () => {
    expect(at(2024).frozen).toBeCloseTo(0.18, 12);
    expect(at(2025).frozen).toBeCloseTo(0.2, 12);
    expect(at(2026).frozen).toBeCloseTo(0.15, 12);
    expect(at(2023).frozen).toBeNull();
  });
});

describe("MarginFadeChart", () => {
  it("states what it shows and offers the values as a table, the frozen forecast named", () => {
    const html = renderToStaticMarkup(
      <MarginFadeChart rows={marginFadeRows(history, "2025-03-31", forecast, frozen)} frozenMadeAt="2026-09-25" historyShown={8} historyTotal={10} />,
    );
    expect(html).toContain("latest 8 of 10 reported years");
    expect(html).toContain("Show as a table");
    expect(html).toContain("Forecast frozen 2026-09-25");
    expect(html).toContain("19.0%");
  });

  it("drops the frozen series when there is none", () => {
    const html = renderToStaticMarkup(
      <MarginFadeChart rows={marginFadeRows(history, "2025-03-31", forecast, null)} frozenMadeAt={null} historyShown={8} historyTotal={10} />,
    );
    expect(html).not.toContain("Forecast frozen");
  });
});

describe("frozen snapshots", () => {
  const snap = (ticker: string, madeAt: string) => ({ ticker, madeAt, cutoffPeriod: "2025-03-31", years: [] }) as FrozenSnapshot;

  it("uses the company's most recently frozen forecast", () => {
    const all = [snap("TCS", "2026-09-25"), snap("TCS", "2027-06-01"), snap("ITC", "2027-09-01")];
    expect(latestSnapshotFor(all, "TCS")!.madeAt).toBe("2027-06-01");
    expect(latestSnapshotFor(all, "INFY")).toBeNull();
    expect(latestSnapshotFor(null, "TCS")).toBeNull();
  });

  it("serves the browser exactly the snapshots frozen under accountability/snapshots", () => {
    const base = join(process.cwd(), "accountability", "snapshots");
    const expected = readdirSync(base).sort().flatMap((madeAt) =>
      readdirSync(join(base, madeAt)).filter((f) => f.endsWith(".json")).sort()
        .map((f) => JSON.parse(readFileSync(join(base, madeAt, f), "utf8")) as unknown));
    const published = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "accountability", "snapshots.json"), "utf8")) as unknown;
    expect(published).toEqual(expected);
  });
});
