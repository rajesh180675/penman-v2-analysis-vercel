/* ================================================================
   ResearchJournalPanel: how many entries it shows, and whether it
   admits to the ones it doesn't.

   The list was `.slice(0, 8)`d with its length nowhere on the panel.
   The head is the right end — `addWorkspaceJournalEntry` `unshift`s,
   so the store is newest-first — but the store keeps 120 entries, so
   eight of forty read as all forty. This is the record a reviewer
   checks to see whether a thesis was written down before or after the
   price moved.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResearchJournalPanel from "../ResearchJournalPanel";
import type { WorkspaceResearchJournalEntry } from "../../lib/researchWorkspace";

/** Newest first, the order the workspace store keeps. */
function entries(titles: string[]): WorkspaceResearchJournalEntry[] {
  return titles.map((title, index) => ({
    id: `entry-${title}`,
    recordedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    kind: "note",
    title,
    body: `Body for ${title}.`,
    relatedRunId: null,
  }));
}

function render(list: WorkspaceResearchJournalEntry[]) {
  return renderToStaticMarkup(
    <ResearchJournalPanel entries={list} onAdd={() => {}} />,
  );
}

const NINE = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

describe("ResearchJournalPanel", () => {
  it("says how many entries there are and how many it left out", () => {
    const html = render(entries([...NINE, "j", "k", "l"]));
    expect(html).toContain("Entries (12)");
    expect(html).toContain("4 older entries are not shown");
  });

  it("keeps the newest entries, which the store holds first", () => {
    const html = render(entries(["newest", "b", "c", "d", "e", "f", "g", "h", "oldest"]));
    expect(html).toContain("Body for newest.");
    expect(html).not.toContain("Body for oldest.");
  });

  it("words a single hidden entry in the singular", () => {
    const html = render(entries(NINE));
    expect(html).toContain("1 older entry is not shown");
  });

  it("claims nothing hidden when every entry fits", () => {
    const html = render(entries(["a", "b"]));
    expect(html).toContain("Entries (2)");
    expect(html).not.toMatch(/not shown/);
  });

  it("keeps the empty-state copy and no count header when there are none", () => {
    const html = render([]);
    expect(html).toContain("No journal entries yet");
    expect(html).not.toMatch(/Entries \(/);
    expect(html).not.toMatch(/not shown/);
  });

  it("does not mutate the array it was given", () => {
    const list = entries(["a", "b", "c"]);
    render(list);
    expect(list.map((entry) => entry.title)).toEqual(["a", "b", "c"]);
  });
});
