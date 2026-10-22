/**
 * The Record's scoreboard scores the published copies (snapshots.json, and
 * the tie-out ledger's first filings) with the report's own functions, so it
 * must reproduce accountability/frozen-scores.json exactly: a published file
 * left behind by a freeze or a filings fetch fails here, not on the page.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { scoresBySet, summarizeScores } from "../../engine/accountability";
import type { FrozenSnapshot, TieOutCompany } from "../hooks";
import { frozenScoresFrom, RecordScores } from "../RecordScores";
import { ToolsPage } from "../ToolsPage";

const read = <T,>(...path: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...path), "utf8")) as T;
const snapshots = read<FrozenSnapshot[]>("public", "data", "accountability", "snapshots.json");
const tieOut = read<TieOutCompany[]>("public", "data", "filings", "tie-out.json");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

describe("Record — frozen forecasts scored against what was filed since", () => {
  it("scores the published copies exactly as score-frozen.ts scores the files", () => {
    expect(JSON.parse(JSON.stringify(frozenScoresFrom(snapshots, tieOut)))).toEqual(read("accountability", "frozen-scores.json"));
  });

  it("shows every set latest first, the year in progress apart, and the latest set company by company", () => {
    const sets = scoresBySet(frozenScoresFrom(snapshots, tieOut));
    const html = text(renderToStaticMarkup(<RecordScores snapshots={snapshots} tieOut={tieOut} />));

    const at = sets.map((s) => html.indexOf(`Frozen ${s.madeAt} ${s.scored} of ${s.forecasts} forecasts scored on a filed year.`));
    expect(at.every((p) => p >= 0)).toBe(true);
    at.slice(1).forEach((p, i) => expect(p).toBeLessThan(at[i]!));

    const latest = sets.at(-1)!;
    const [sales] = summarizeScores(latest.final);
    expect(html).toContain(`Sales ${sales!.n} ${pct(sales!.model)} ${pct(sales!.randomWalk)}`);
    expect(latest.provisional.length).toBeGreaterThan(0);
    const [inProgress] = summarizeScores(latest.provisional, ["sales-log-error"]);
    expect(html).toContain(`The year in progress, provisional: projected from ${latest.provisionalMonths != null ? `${latest.provisionalMonths} months filed` : "the months filed, which differ by company"}.`);
    expect(html).toContain(`Sales ${inProgress!.n} ${pct(inProgress!.model)} ${pct(inProgress!.randomWalk)}`);

    expect(html).toContain(`Frozen ${latest.madeAt}, by company All ${latest.forecasts} forecasts in the set.`);
    const provisional = latest.provisional[0]!;
    expect(html).toMatch(new RegExp(`${provisional.periodEnd} \\(${provisional.provisional!.months} months filed\\)( [+-][0-9.]+(%| pts)){4} not projected`));
  });

  it("links each company to its Case forecast, and lists one that was not scored with the reason", () => {
    const html = renderToStaticMarkup(<RecordScores snapshots={snapshots} tieOut={tieOut} />);
    expect(html).toContain(`href="#/case/TCS/forecast"`);
    const withoutLedger = text(renderToStaticMarkup(<RecordScores snapshots={snapshots} tieOut={tieOut.filter((c) => c.symbol !== "TCS")} />));
    expect(withoutLedger).toContain("TCS 2026-03-31 Not scored: no as-filed ledger.");
  });

  it("shows on the Record page itself, until a tool is opened", () => {
    const page = (tool: string | null) => text(renderToStaticMarkup(
      <ToolsPage route={{ space: "record", company: null, tool }} companies={[]} company={null} snapshots={snapshots} tieOut={tieOut} />,
    ));
    expect(page(null)).toContain("Frozen forecasts, scored against what was filed since");
    expect(page("thesis")).not.toContain("Frozen forecasts, scored against what was filed since");
    expect(text(renderToStaticMarkup(<RecordScores snapshots={null} tieOut={tieOut} />))).toContain("Loading the frozen forecasts…");
  });
});
