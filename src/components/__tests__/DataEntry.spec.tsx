import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DataEntry from "../DataEntry";
import { DEFAULT_CONFIG } from "../../engine/types";

/**
 * Characterization spec for DataEntry. Renders with renderToStaticMarkup
 * (no useEffect runs, so no effect-driven fetches fire) and asserts a set of
 * stable visible strings on the INITIAL render. Locks behavior before the
 * render-decomposition refactor.
 */
const noop = () => {};

function render() {
  return renderToStaticMarkup(
    <DataEntry
      onDataSubmit={noop}
      currentData={null}
      config={DEFAULT_CONFIG}
      onConfigChange={noop}
    />,
  );
}

describe("DataEntry (characterization)", () => {
  it("renders the upload header and sample button", () => {
    const html = render();
    expect(html).toContain("Upload Capitaline Data");
    expect(html).toContain("Load VST Sample (10Y)");
  });

  it("renders the essential config field labels", () => {
    const html = render();
    expect(html).toContain("Company ID");
    expect(html).toContain("Company Type");
    expect(html).toContain("Market Price ₹");
    expect(html).toContain("Shares (Cr)");
  });

  it("renders the collapsible section headers", () => {
    const html = render();
    expect(html).toContain("Advanced Configuration (sector, market data, tax)");
    expect(html).toContain("Cost of Capital (ke, kd, WACC)");
  });

  it("renders the format mode tab labels", () => {
    const html = render();
    expect(html).toContain("Capitaline ZIP");
    expect(html).toContain("Screener Paste");
    expect(html).toContain("Raw JSON");
    expect(html).toContain("XBRL XML");
    expect(html).toContain("Manual Wizard");
  });

  it("renders the consolidated upload slot and how-to disclosure", () => {
    const html = render();
    expect(html).toContain("Consolidated Financial Data");
    expect(html).toContain("Drop consolidated ZIP or click to browse");
    expect(html).toContain("Standalone Statements");
    expect(html).toContain("How to prepare the Capitaline ZIP");
  });

  it("flags the company-type gate as required when type is auto", () => {
    const html = render();
    // DEFAULT_CONFIG.company_type === "auto" => typeNotSelected branch
    expect(html).toContain("required");
  });
});
