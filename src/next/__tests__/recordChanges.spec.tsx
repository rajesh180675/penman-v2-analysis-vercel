/**
 * The Record's "what changed" compares the published copies (snapshots.json)
 * with the report's own functions, so it must show exactly what
 * docs/generated/frozen-forecast-changes.md lists: a set frozen or published
 * without regenerating the doc fails here, not on the page.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FrozenSnapshot } from "../hooks";
import { RecordChanges } from "../RecordChanges";
import { ToolsPage } from "../ToolsPage";

const snapshots = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "accountability", "snapshots.json"), "utf8")) as FrozenSnapshot[];
const doc = readFileSync(join(process.cwd(), "docs", "generated", "frozen-forecast-changes.md"), "utf8").replace(/\r/g, "");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

/** The doc's pairs: heading, summary sentence, and table rows as cells. */
const docPairs = doc.split(/^## /m).slice(1).map((block) => {
  const lines = block.split("\n");
  return {
    heading: lines[0]!,
    summary: lines[2]!,
    notes: lines.slice(3).filter((l) => l.startsWith("Frozen only in ") || l.startsWith("The ")),
    rows: lines.filter((l) => l.startsWith("| ") && !l.startsWith("| Company")).map((l) => l.slice(2, -2).split(" | ")),
  };
});

/** The page's pairs, by the same reading of its markup. */
function pagePairs(html: string) {
  return html.split("<h3").slice(1).map((block) => ({
    heading: text(block.slice(block.indexOf(">") + 1, block.indexOf("</h3>"))),
    summary: text(block.slice(block.indexOf("<p"), block.indexOf("</p>"))),
    rows: block.split("<tr").slice(1).filter((row) => row.includes("<th scope=\"row\"")).map((row) =>
      row.slice(row.indexOf(">") + 1).split(/<\/t[hd]>/).slice(0, -1).map((cell) => text(cell))),
  }));
}

describe("Record — frozen forecasts, set to set", () => {
  const page = pagePairs(renderToStaticMarkup(<RecordChanges snapshots={snapshots} />));

  it("shows every pair of sets the doc lists, latest first", () => {
    expect(docPairs.length).toBe(new Set(snapshots.map((s) => s.madeAt)).size - 1);
    expect(page.map((p) => p.heading)).toEqual([...docPairs].reverse().map((p) => p.heading));
  });

  it("lists, pair by pair, the doc's companies in its order with its cells", () => {
    for (const expected of docPairs) {
      const shown = page.find((p) => p.heading === expected.heading)!;
      expect(shown.rows, expected.heading).toEqual(expected.rows);
      // The table is below the doc's sentence and beside the page's.
      expect(shown.summary).toContain(expected.summary.replace(" listed below;", " listed;"));
      for (const note of expected.notes) expect(shown.summary).toContain(note);
    }
    expect(docPairs.some((p) => p.rows.length === 0)).toBe(true);
    expect(docPairs.some((p) => p.notes.some((n) => n.startsWith("Frozen only in ")))).toBe(true);
  });

  it("says which sets record no basis, and calls a v1 pair the same anchor, not the same basis", () => {
    const oldest = page.at(-1)!;
    expect(oldest.summary).toContain("The 2026-09-25 and 2026-10-08 sets record no basis (snapshot schema v1)");
    expect(oldest.rows.every((r) => r.at(-1) === "same anchor" || r.at(-1)!.startsWith("anchor "))).toBe(true);
  });

  it("links each company to its Case forecast", () => {
    expect(renderToStaticMarkup(<RecordChanges snapshots={snapshots} />)).toContain(`href="#/case/GRASIM/forecast"`);
  });

  it("shows on the Record page itself, until a tool is opened", () => {
    const at = (tool: string | null) => text(renderToStaticMarkup(
      <ToolsPage route={{ space: "record", company: null, tool }} companies={[]} company={null} snapshots={snapshots} tieOut={[]} />,
    ));
    expect(at(null)).toContain("Frozen forecasts, set to set");
    expect(at("thesis")).not.toContain("Frozen forecasts, set to set");
    expect(text(renderToStaticMarkup(<RecordChanges snapshots={snapshots.filter((s) => s.madeAt === "2026-10-20")} />)))
      .toContain("Fewer than two frozen sets: nothing to compare yet.");
  });
});
