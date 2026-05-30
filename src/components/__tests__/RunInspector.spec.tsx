import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RunInspector from "../RunInspector";
import { rememberAuditRun, type AuditSubmissionMeta } from "../../lib/audit";

// Characterization spec for RunInspector. renderToStaticMarkup does NOT run
// useEffect, so the audit-event fetching effects never fire — every render here
// captures the pre-effect initial state (payload === null). jsdom supplies
// localStorage, which backs listRememberedAuditRuns()/rememberAuditRun().

function seedRun(overrides: Partial<AuditSubmissionMeta> = {}): AuditSubmissionMeta {
  const meta: AuditSubmissionMeta = {
    runId: "run-abcdef123456",
    sourceMode: "json",
    companyId: "ITC",
    fileName: "itc.json",
    runAccessToken: "token-xyz",
    contentClass: "confidential-financial-statements",
    retentionDays: 45,
    ...overrides,
  };
  rememberAuditRun(meta);
  return meta;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("RunInspector", () => {
  it("renders the no-runs empty state when nothing is remembered", () => {
    const html = renderToStaticMarkup(
      <RunInspector auditMeta={null} analysisStatus={null} />,
    );
    expect(html).toContain("No audited runs available yet");
    expect(html).toContain("Load a dataset first, then this inspector will show the full server-side timeline");
    // None of the populated section headings should appear in the empty state.
    expect(html).not.toContain("Opportunity Watchlist");
  });

  it("renders the full section scaffold once a run is remembered", () => {
    seedRun();
    const html = renderToStaticMarkup(
      <RunInspector auditMeta={null} analysisStatus={null} />,
    );
    // Header + subtitle.
    expect(html).toContain("Run Inspector");
    expect(html).toContain("First-class audit timeline for the current browser-authorized run");
    expect(html).toContain("Selected run");
    // Run option label: companyId · runId.slice(0,8) · sourceMode
    expect(html).toContain("ITC");
    expect(html).toContain("run-abcd");
    // Metric cards.
    expect(html).toContain("Events");
    expect(html).toContain("Inputs");
    expect(html).toContain("Artifacts");
    expect(html).toContain("Monitor");
    // All major section headings.
    expect(html).toContain("Opportunity Watchlist");
    expect(html).toContain("Latest Market Snapshot");
    expect(html).toContain("Latest Valuation Signal");
    expect(html).toContain("Latest Valuation Manifest");
    expect(html).toContain("Alerts and Backtest");
    expect(html).toContain("Timeline");
    expect(html).toContain("Monitor Findings");
    expect(html).toContain("Artifacts and Inputs");
    expect(html).toContain("Traceability");
    expect(html).toContain("Governance and Recovery");
  });

  it("shows pre-effect empty-state strings because payload stays null under SSR", () => {
    seedRun();
    const html = renderToStaticMarkup(
      <RunInspector auditMeta={null} analysisStatus={null} />,
    );
    // payload is null (no effects under SSR) → "—" metric placeholders + empties.
    expect(html).toContain("No live market snapshot has been persisted for this run yet.");
    expect(html).toContain("No valuation signal event has been persisted for this run yet.");
    expect(html).toContain("No valuation manifest has been persisted for this run yet.");
    expect(html).toContain("No persisted timeline events found.");
    expect(html).toContain("No findings yet.");
    expect(html).toContain("No persisted inputs or artifacts found yet.");
    expect(html).toContain("No traceability payload found yet.");
    // Watchlist tracked-runs counter starts at 0.
    expect(html).toContain("0 tracked runs");
  });

  it("renders the watchlist table column headers", () => {
    seedRun();
    const html = renderToStaticMarkup(
      <RunInspector auditMeta={null} analysisStatus={null} />,
    );
    expect(html).toContain("Company");
    expect(html).toContain("Signal");
    expect(html).toContain("Bucket");
    expect(html).toContain("Score");
    expect(html).toContain("Stress CAGR");
    expect(html).toContain("Latest");
  });

  it("surfaces governance fields from the remembered run", () => {
    seedRun({ retentionDays: 90, contentClass: "restricted" });
    const html = renderToStaticMarkup(
      <RunInspector auditMeta={null} analysisStatus={null} />,
    );
    expect(html).toContain("Sensitive class:");
    expect(html).toContain("restricted");
    expect(html).toContain("Retention:");
    expect(html).toContain("90 days");
    expect(html).toContain("Pending queued events:");
    expect(html).toContain("Pending failed uploads/exports:");
  });
});
