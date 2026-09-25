import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TABS } from "../../app/tabs";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { classicHref, TAB_HOMES, toolsIn } from "../legacyTools";
import { CASE_SECTIONS } from "../route";
import { choosePeers, MAX_PEERS, PeersSection, peerMetrics } from "../sections/PeersSection";
import { ToolsPage } from "../ToolsPage";

const co = (ticker: string, type: LibraryCompany["type"], name = ticker): LibraryCompany => ({
  folder: `${name} folder`, name, ticker, sector: "", type, description: "", emoji: "",
});

describe("every current tab has a home in the next UI (Phase 4 exit)", () => {
  it("maps all 22 tabs, each exactly once", () => {
    expect(TABS).toHaveLength(22);
    expect(Object.keys(TAB_HOMES).sort()).toEqual(TABS.map((t) => t.id).sort());
    const cased = Object.values(TAB_HOMES).filter((h) => h.kind === "case").length;
    expect(cased + toolsIn("library").length + toolsIn("record").length + toolsIn("lab").length).toBe(22);
  });

  it("sends rebuilt tabs to real Case sections", () => {
    const sections = new Set(CASE_SECTIONS.map((s) => s.id));
    for (const home of Object.values(TAB_HOMES)) if (home.kind === "case") expect(sections.has(home.section)).toBe(true);
  });

  it("opens the rest in the classic interface with the deep link it reads (?company=&tab=)", () => {
    expect(classicHref("regression", "M&M")).toBe("/?ui=classic&tab=regression&company=M%26M");
    expect(classicHref("upload")).toBe("/?ui=classic&tab=upload");
  });
});

describe("ToolsPage", () => {
  const companies = [co("TCS", "it-services", "TCS"), co("ITC", "consumer", "ITC Ltd")];

  it("withholds company tools until a company is chosen, and links them once one is", () => {
    const none = renderToStaticMarkup(<ToolsPage kind="record" companies={companies} company={null} />);
    expect(none).toContain("Choose a company first");
    expect(none).not.toContain("tab=report");
    const withCompany = renderToStaticMarkup(<ToolsPage kind="record" companies={companies} company={companies[0]!} />);
    expect(withCompany).toContain('href="/?ui=classic&amp;tab=report&amp;company=TCS"');
    expect(withCompany).toContain('href="/?ui=classic&amp;tab=thesis&amp;company=TCS"');
  });

  it("links tools that need no company straight away", () => {
    const html = renderToStaticMarkup(<ToolsPage kind="lab" companies={companies} company={null} />);
    expect(html).toContain('href="/?ui=classic&amp;tab=debug"');
    expect(html).toContain('href="/?ui=classic&amp;tab=charts"');
  });
});

describe("Peers", () => {
  it("chooses same-type library companies, never the company itself, at most four, by name", () => {
    const me = co("A", "cyclical", "Alpha");
    const all = [me, co("E", "cyclical", "Echo"), co("B", "cyclical", "Bravo"), co("X", "consumer", "Xray"),
      co("D", "cyclical", "Delta"), co("C", "cyclical", "Charlie"), co("F", "cyclical", "Foxtrot")];
    expect(choosePeers(me, all).map((c) => c.name)).toEqual(["Bravo", "Charlie", "Delta", "Echo"]);
    expect(MAX_PEERS).toBe(4);
  });

  function run(ratios: Record<string, number | null>, base: number | null, upside: number | null) {
    return {
      status: "completed",
      run: {},
      materialization: {
        pipelineResult: { periods: [{ period_end: "2024-03-31", ratios: {} }, { period_end: "2025-03-31", ratios }] },
        commandCenter: base == null ? null : { scenarios: [{ key: "base", intrinsicPerShare: base, upsidePct: upside }] },
      },
    } as unknown as LegacyAnalysisRunExecutionResult;
  }

  it("reads the latest year's ratios and the base case", () => {
    expect(peerMetrics(run({ RNOA: 0.3, PM: 0.2, ATO: 1.5, ROCE: 0.4, Sales_growth: 0.1 }, 1000, 0.25))).toEqual({
      latestPeriod: "2025-03-31", rnoa: 0.3, pm: 0.2, ato: 1.5, roce: 0.4, salesGrowth: 0.1, baseValue: 1000, upside: 0.25,
    });
  });

  it("runs peers only when asked, then shows each beside the company", () => {
    const me = co("TCS", "it-services", "TCS");
    const peer = co("INFY", "it-services", "Infosys");
    const idle = renderToStaticMarkup(
      <PeersSection company={me} result={run({ RNOA: 0.5 }, 3000, 0.1)} peers={[peer]} peerRuns={null} onLoadPeers={() => {}} />,
    );
    expect(idle).toContain("Analyse 1 peer");
    expect(idle).toContain("Not analysed yet.");
    expect(idle).toContain("50.0%");

    const loaded = renderToStaticMarkup(
      <PeersSection company={me} result={run({ RNOA: 0.5 }, 3000, 0.1)} peers={[peer]}
        peerRuns={new Map([[peer.folder, { status: "ready", result: run({ RNOA: 0.42 }, null, null) }]])} onLoadPeers={() => {}} />,
    );
    expect(loaded).not.toContain("Analyse 1 peer");
    expect(loaded).toContain("42.0%");
    expect(loaded).toContain("No industrial base case");
  });

  it("says when there is no peer to compare with", () => {
    const html = renderToStaticMarkup(
      <PeersSection company={co("IDEA", "telecom")} result={run({}, null, null)} peers={[]} peerRuns={null} onLoadPeers={() => {}} />,
    );
    expect(html).toContain("No other telecom company in the library");
  });
});
