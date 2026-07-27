/** @vitest-environment jsdom (mounts through react-dom/client) */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type RawPeriodData } from "../../engine/types";

const { parseCapitalineZip } = vi.hoisted(() => ({
  parseCapitalineZip: vi.fn(),
}));

vi.mock("../../engine/capitalineParser", () => ({ parseCapitalineZip }));
vi.mock("../../lib/audit", () => ({
  createAuditAccessToken: () => "test-access-token",
  createAuditRunId: () => "test-audit-run",
  getAuditClientGovernance: () => ({
    contentClass: "confidential-financial-statements",
    retentionDays: 45,
    maximumUploadBytes: 64 * 1024 * 1024,
  }),
  persistAuditEvent: vi.fn(async () => undefined),
  persistAuditFile: vi.fn(async () => undefined),
  rememberAuditRun: vi.fn(),
}));

import DataEntry from "../DataEntry";

const consolidated: RawPeriodData[] = [
  { company_id: "TCS", period_end: "2025-03-31", raw_metric_values: { revenue: 100 } },
  { company_id: "TCS", period_end: "2026-03-31", raw_metric_values: { revenue: 110 } },
];
const standalone: RawPeriodData[] = [
  { company_id: "TCS", period_end: "2025-03-31", raw_metric_values: { revenue: 90 } },
  { company_id: "TCS", period_end: "2026-03-31", raw_metric_values: { revenue: 95 } },
];

function parseResult(periods: RawPeriodData[]) {
  return {
    periods,
    debug: {
      companyId: "TCS",
      files: [],
      detectedPeriods: periods.map((period) => period.period_end),
      sourceArtifactHashes: [],
      rawGrids: [],
      metrics: {
        totalCompositeKeys: 0,
        totalBaseKeys: 0,
        baseKeyCollisions: [],
        byStatement: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0 },
      },
      warnings: [],
      sample: { firstRows: [] },
      rawMetricKeys: [],
    },
    segmentData: null,
  };
}

describe("DataEntry bundled-company deep links", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState({}, "", "/?rf=7.00&erp=6.00&tab=upload&company=TCS");
    parseCapitalineZip.mockReset();
    parseCapitalineZip.mockImplementation(async (_file: unknown, opts?: { filename?: string }) =>
      opts?.filename === "standalone.zip" ? parseResult(standalone) : parseResult(consolidated));
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/data/companies/registry.json") {
        return new Response(JSON.stringify([{
          folder: "Tata Consultancy Services Ltd",
          name: "TCS",
          ticker: "TCS",
          sector: "IT Services",
          type: "it-services",
          description: "Global IT services leader",
          emoji: "💻",
          hasStandalone: true,
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("Tata%20Consultancy%20Services%20Ltd.zip") || url.endsWith("standalone.zip")) {
        return new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("resolves company=TCS and loads consolidated plus standalone exactly once", async () => {
    const onDataSubmit = vi.fn();
    const onConfigChange = vi.fn();
    await act(async () => {
      root.render(
        <StrictMode>
          <DataEntry
            onDataSubmit={onDataSubmit}
            currentData={null}
            config={{ ...DEFAULT_CONFIG, ticker: "TCS" }}
            onConfigChange={onConfigChange}
          />
        </StrictMode>,
      );
    });

    await vi.waitFor(() => expect(onDataSubmit).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/data/companies/registry.json");
    expect(fetchMock).toHaveBeenCalledWith(
      "/data/companies/Tata%20Consultancy%20Services%20Ltd/Tata%20Consultancy%20Services%20Ltd.zip",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/data/companies/Tata%20Consultancy%20Services%20Ltd/standalone.zip",
    );
    expect(parseCapitalineZip).toHaveBeenCalledTimes(2);
    expect(onDataSubmit.mock.calls[0]?.[0]).toEqual(consolidated);
    expect(onDataSubmit.mock.calls[0]?.[5]).toEqual(standalone);
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      ticker: "TCS",
      company_type: "it-services",
      quality_data_folder: "Tata Consultancy Services Ltd",
    }));

    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(onDataSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows an actionable error for an unknown deep-link company", async () => {
    window.history.replaceState({}, "", "/?tab=upload&company=UNKNOWN");
    await act(async () => {
      root.render(
        <DataEntry
          onDataSubmit={vi.fn()}
          currentData={null}
          config={{ ...DEFAULT_CONFIG, ticker: "UNKNOWN" }}
          onConfigChange={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('No bundled company matches "UNKNOWN"');
    });
  });

  it("continues with consolidated data and warns when standalone is unavailable", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/data/companies/registry.json") {
        return new Response(JSON.stringify([{
          folder: "Tata Consultancy Services Ltd",
          name: "TCS",
          ticker: "TCS",
          sector: "IT Services",
          type: "it-services",
          description: "Global IT services leader",
          emoji: "TCS",
          hasStandalone: true,
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("standalone.zip")) return new Response(null, { status: 404 });
      if (url.endsWith("Tata%20Consultancy%20Services%20Ltd.zip")) {
        return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const onDataSubmit = vi.fn();

    await act(async () => {
      root.render(
        <DataEntry
          onDataSubmit={onDataSubmit}
          currentData={null}
          config={{ ...DEFAULT_CONFIG, ticker: "TCS" }}
          onConfigChange={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => expect(onDataSubmit).toHaveBeenCalledTimes(1));
    expect(onDataSubmit.mock.calls[0]?.[0]).toEqual(consolidated);
    expect(onDataSubmit.mock.calls[0]?.[5]).toBeNull();
    expect(container.textContent).toContain("Standalone ZIP was unavailable");
  });
});
