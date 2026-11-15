import { describe, expect, it } from "vitest";
import { archiveName, recordsByArchiveName } from "../filings/nse";

describe("recordsByArchiveName", () => {
  const held = [
    { xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1712401_WEB.xml", periodEnd: "2026-06-30" },
    { xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1757301_WEB.xml", periodEnd: "2026-09-30" },
  ];

  it("finds the record a ledger holds for a filing, whichever host the listing names", () => {
    // NSE moved its archive from nseindia.com to nseindia.in in November 2026; the file names did not change.
    const listed = "https://nsearchives.nseindia.in/corporate/xbrl/INTEGRATED_FILING_INDAS_1757301_WEB.xml";
    expect(recordsByArchiveName(held).get(archiveName(listed))).toBe(held[1]);
  });

  it("holds nothing for a filing the ledger never read", () => {
    expect(recordsByArchiveName(held).get("INTEGRATED_FILING_INDAS_9999999_WEB.xml")).toBeUndefined();
    expect(recordsByArchiveName([]).size).toBe(0);
  });
});
