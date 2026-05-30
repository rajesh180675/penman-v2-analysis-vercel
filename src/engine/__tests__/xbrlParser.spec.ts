import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseXbrlXmlDetailed } from "../xbrlParser";

interface FakeNode {
  textContent?: string | null;
}

interface FakeElement extends FakeNode {
  tagName: string;
  getAttribute(name: string): string | null;
  getElementsByTagNameNS(namespace: string, tagName: string): FakeNode[];
}

interface FakeDocument {
  querySelector(selector: string): FakeNode | null;
  getElementsByTagNameNS(namespace: string, tagName: string): FakeElement[];
  getElementsByTagName(tagName: string): FakeElement[];
}

function createContext(id: string, period: { instant?: string; endDate?: string }): FakeElement {
  return {
    tagName: "xbrli:context",
    textContent: null,
    getAttribute(name: string) {
      return name === "id" ? id : null;
    },
    getElementsByTagNameNS(_namespace: string, tagName: string) {
      if (tagName === "instant" && period.instant) return [{ textContent: period.instant }];
      if (tagName === "endDate" && period.endDate) return [{ textContent: period.endDate }];
      return [];
    },
  };
}

function createFact(tagName: string, contextRef: string, textContent: string): FakeElement {
  return {
    tagName,
    textContent,
    getAttribute(name: string) {
      return name === "contextRef" ? contextRef : null;
    },
    getElementsByTagNameNS() {
      return [];
    },
  };
}

class FakeDomParser {
  constructor(private readonly doc: FakeDocument) {}

  parseFromString() {
    return this.doc;
  }
}

describe("parseXbrlXmlDetailed", () => {
  const originalDomParser = globalThis.DOMParser;

  beforeEach(() => {
    delete (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  });

  afterEach(() => {
    if (originalDomParser) {
      globalThis.DOMParser = originalDomParser;
      return;
    }
    delete (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  });

  it("produces source-native diagnostics for clean mapped XBRL facts", () => {
    const contexts = [createContext("ctx-2025", { instant: "2025-03-31" })];
    const facts = [
      createFact("in-gaap:Assets", "ctx-2025", "1000"),
      createFact("in-gaap:Equity", "ctx-2025", "600"),
      createFact("in-gaap:RevenueFromOperations", "ctx-2025", "900"),
      createFact("in-gaap:NetCashFromOperatingActivities", "ctx-2025", "150"),
    ];
    const doc: FakeDocument = {
      querySelector() {
        return null;
      },
      getElementsByTagNameNS(_namespace: string, tagName: string) {
        return tagName === "context" ? contexts : [];
      },
      getElementsByTagName() {
        return facts;
      },
    };
    globalThis.DOMParser = class {
      parseFromString() {
        return new FakeDomParser(doc).parseFromString();
      }
    } as unknown as typeof DOMParser;

    const result = parseXbrlXmlDetailed("<xbrl />", "XBRL");

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.period_end).toBe("2025-03-31");
    expect(result.periods[0]!.raw_metric_values["Total Assets"]).toBe(1000);
    expect(result.diagnostics.sourceMode).toBe("xbrl");
    expect(result.diagnostics.warningCount).toBe(0);
    expect(result.diagnostics.errorCount).toBe(0);
    expect(result.diagnostics.checks.every((check) => check.passed)).toBe(true);
  });

  it("flags unresolved contexts, duplicate conflicts, and non-numeric mapped facts", () => {
    const contexts = [
      createContext("ctx-2025", { instant: "2025-03-31" }),
      createContext("ctx-missing-period", {}),
    ];
    const facts = [
      createFact("in-gaap:Assets", "ctx-2025", "1000"),
      createFact("in-gaap:Assets", "ctx-2025", "980"),
      createFact("in-gaap:Equity", "ctx-2025", "oops"),
      createFact("in-gaap:RevenueFromOperations", "ctx-2025", "900"),
      createFact("in-gaap:NetCashFromOperatingActivities", "ctx-2025", "150"),
    ];
    const doc: FakeDocument = {
      querySelector() {
        return null;
      },
      getElementsByTagNameNS(_namespace: string, tagName: string) {
        return tagName === "context" ? contexts : [];
      },
      getElementsByTagName() {
        return facts;
      },
    };
    globalThis.DOMParser = class {
      parseFromString() {
        return new FakeDomParser(doc).parseFromString();
      }
    } as unknown as typeof DOMParser;

    const result = parseXbrlXmlDetailed("<xbrl />", "XBRL");
    const byId = Object.fromEntries(result.diagnostics.checks.map((check) => [check.id, check]));

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.raw_metric_values["Total Assets"]).toBe(980);
    expect(result.diagnostics.warningCount).toBe(2);
    expect(result.diagnostics.errorCount).toBe(1);
    expect(byId["xbrl-context-periods"]!.passed).toBe(false);
    expect(byId["xbrl-numeric-facts"]!.passed).toBe(false);
    expect(byId["xbrl-duplicate-conflicts"]!.passed).toBe(false);
  });

  it("fails loud on invalid xml parser errors", () => {
    const doc: FakeDocument = {
      querySelector(selector: string) {
        return selector === "parsererror" ? { textContent: "bad xml" } : null;
      },
      getElementsByTagNameNS() {
        return [];
      },
      getElementsByTagName() {
        return [];
      },
    };
    globalThis.DOMParser = class {
      parseFromString() {
        return new FakeDomParser(doc).parseFromString();
      }
    } as unknown as typeof DOMParser;

    expect(() => parseXbrlXmlDetailed("<broken", "XBRL")).toThrow("Invalid XBRL XML document.");
  });
});
