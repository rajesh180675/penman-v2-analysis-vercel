/** @vitest-environment jsdom (mounts through react-dom/client) */
/* ================================================================
   That selecting a company type actually unblocks the upload.

   `processZip` reads `typeNotSelected` to gate the upload, but the
   callback's dep array omitted it. Every other dep is stable across a
   company-type change — `onDataSubmit` is a `useCallback(..., [])` in
   AppShell, `companyId` is local state, `buildMeta` and
   `auditGovernance` do not depend on config — so the callback identity
   never refreshed and it kept reading the type as unselected.

   This needs a real re-render between mount and upload, which is why it
   mounts through react-dom/client rather than renderToStaticMarkup: the
   stale value only exists in a closure captured on the first render.
================================================================ */

import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type CompanyType, type RawPeriodData } from "../../engine/types";

const { parseCapitalineZip } = vi.hoisted(() => ({ parseCapitalineZip: vi.fn() }));

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

// Typed off the prop rather than left as a bare `vi.fn()`: the mock is created
// in one helper and passed to another, so it loses the contextual type it would
// have had inline, and an untyped mock will not satisfy the prop.
type SubmitHandler = ComponentProps<typeof DataEntry>["onDataSubmit"];
const makeSubmitMock = () => vi.fn<SubmitHandler>();
type SubmitMock = ReturnType<typeof makeSubmitMock>;

const periods: RawPeriodData[] = [
  { company_id: "TCS", period_end: "2025-03-31", raw_metric_values: { revenue: 100 } },
  { company_id: "TCS", period_end: "2026-03-31", raw_metric_values: { revenue: 110 } },
];

const TYPE_GATE_ERROR = "Select a Company Type before uploading";

function parseResult() {
  return {
    periods,
    debug: {
      companyId: "TCS",
      files: [],
      detectedPeriods: periods.map((p) => p.period_end),
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

describe("DataEntry company-type upload gate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // No `company=` param: a deep link would load data on its own and never
    // exercise the manual upload path this covers.
    window.history.replaceState({}, "", "/?tab=upload");
    parseCapitalineZip.mockReset();
    parseCapitalineZip.mockImplementation(async () => parseResult());
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderWithType(onDataSubmit: SubmitMock, companyType: CompanyType) {
    await act(async () => {
      root.render(
        <StrictMode>
          <DataEntry
            onDataSubmit={onDataSubmit}
            currentData={null}
            config={{ ...DEFAULT_CONFIG, ticker: "TCS", company_type: companyType }}
            onConfigChange={vi.fn()}
          />
        </StrictMode>,
      );
    });
  }

  async function mountWithType(companyType: CompanyType) {
    const onDataSubmit = makeSubmitMock();
    await renderWithType(onDataSubmit, companyType);
    return onDataSubmit;
  }

  async function uploadZip() {
    const input = container.querySelector<HTMLInputElement>("#zip-upload");
    if (!input) throw new Error("consolidated zip input not found");
    const file = new File([new Uint8Array([80, 75, 3, 4])], "capitaline.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("blocks the upload while the type is still auto", async () => {
    // Non-vacuity: the gate has to actually fire, or the assertion below that
    // it stops firing would prove nothing.
    await mountWithType("auto");
    await uploadZip();
    expect(container.textContent).toContain(TYPE_GATE_ERROR);
    expect(parseCapitalineZip).not.toHaveBeenCalled();
  });

  it("accepts the upload once a type has been selected", async () => {
    // The sequence that matters: mount unselected, select, then upload. The
    // callback was captured on the first render and never refreshed.
    const onDataSubmit = await mountWithType("auto");
    await renderWithType(onDataSubmit, "it-services");
    await uploadZip();
    expect(container.textContent).not.toContain(TYPE_GATE_ERROR);
    await vi.waitFor(() => expect(parseCapitalineZip).toHaveBeenCalledTimes(1));
  });

  it("accepts an upload when the type was already selected at mount", async () => {
    // Control: proves the gate is not simply broken open, and isolates the
    // failure above to the stale closure rather than to the gate itself.
    await mountWithType("it-services");
    await uploadZip();
    expect(container.textContent).not.toContain(TYPE_GATE_ERROR);
    await vi.waitFor(() => expect(parseCapitalineZip).toHaveBeenCalledTimes(1));
  });
});
