/**
 * Golden Companies — Registry Validation Smoke
 *
 * @vitest-environment node
 *
 * Phase rigor-5 (May 2026): structural validation pass over registry.json.
 *
 * What this guards:
 *   - Every registry entry has the required fields (folder, ticker, type, name)
 *   - Tickers match the NSE_SYMBOL_REGISTRY (catches the documented LICI/LIFI,
 *     BAJFINANCE/BAJAJFINANCE drift bug class)
 *   - Each company's consolidated ZIP exists on disk
 *   - quality_indicators.json sidecar exists for bank/nbfc/insurance subtypes
 *   - Company type is in the engine's CompanyType enum or registry-extended set
 *
 * What this does NOT guard (those live in dedicated per-company specs):
 *   - HDFC Bank: hdfcBank.spec.ts (ROA, ROE, CASA bands)
 *   - Bajaj Finance: bajajFinance.spec.ts (NBFC routing + cost-to-income)
 *   - Vodafone Idea: vodafoneIdea.spec.ts (loss-maker fail-close)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { NSE_SYMBOL_REGISTRY } from "../nseSymbolRegistry";
import { parseCapitalineZip } from "../capitalineParser";

interface RegistryEntry {
  folder: string;
  name: string;
  ticker: string;
  type: string;
  hasStandalone?: boolean;
}

const REGISTRY_PATH = resolve(__dirname, "../../../public/data/companies/registry.json");
const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");

const REGISTRY: RegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

// Types accepted by registry. Some are UI-routing labels (loss-maker,
// conglomerate) that the engine maps to "auto" or "industrial".
const VALID_REGISTRY_TYPES = new Set([
  "bank", "nbfc", "insurance",
  "industrial", "it-services", "consumer", "utility", "telecom", "cyclical",
  // UI-only types (engine routes these to industrial pipeline + scope detector)
  "conglomerate", "loss-maker",
]);

const FI_TYPES = new Set(["bank", "nbfc", "insurance"]);

describe("Golden Companies — registry validation", () => {
  it("registry has at least 13 companies", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(13);
  });

  for (const entry of REGISTRY) {
    describe(`${entry.ticker} — ${entry.folder}`, () => {
      it("has all required fields", () => {
        expect(entry.folder).toBeTruthy();
        expect(entry.name).toBeTruthy();
        expect(entry.ticker).toBeTruthy();
        expect(entry.type).toBeTruthy();
      });

      it("type is in the accepted set", () => {
        expect(VALID_REGISTRY_TYPES.has(entry.type)).toBe(true);
      });

      it("ticker matches NSE_SYMBOL_REGISTRY (no drift)", () => {
        const expected = NSE_SYMBOL_REGISTRY[entry.folder];
        // Some folders may not have an NSE-listed ticker (subsidiaries, etc.).
        // When they do, registry.ticker MUST equal NSE_SYMBOL_REGISTRY value.
        if (expected !== undefined) {
          expect(entry.ticker).toBe(expected);
        }
      });

      it("consolidated ZIP exists on disk", () => {
        const zipPath = resolve(COMPANIES_DIR, entry.folder, `${entry.folder}.zip`);
        expect(existsSync(zipPath)).toBe(true);
      });

      if (FI_TYPES.has(entry.type)) {
        it("quality_indicators.json exists (required for bank/nbfc/insurance)", () => {
          const qiPath = resolve(COMPANIES_DIR, entry.folder, "quality_indicators.json");
          expect(existsSync(qiPath)).toBe(true);
        });
      }

      if (entry.hasStandalone === true) {
        it("standalone.zip exists when hasStandalone=true", () => {
          const stanPath = resolve(COMPANIES_DIR, entry.folder, "standalone.zip");
          expect(existsSync(stanPath)).toBe(true);
        });
      }

      it("can load the ZIP without OOMing the worker (leak test)", async () => {
        const zipPath = resolve(COMPANIES_DIR, entry.folder, `${entry.folder}.zip`);
        const buffer = readFileSync(zipPath);
        const { periods } = await parseCapitalineZip(buffer);
        expect(periods.length).toBeGreaterThan(0);
      });
    });
  }
});
