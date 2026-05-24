/**
 * Public data registry parity test.
 *
 * Validates that registry.json and companies-metadata.json are consistent,
 * structurally sound, and carry all fields the UI depends on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseLibraryCompanyRegistry } from "../../components/data-entry/companyRegistry";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const REGISTRY_PATH = resolve(COMPANIES_DIR, "registry.json");
const METADATA_PATH = resolve(COMPANIES_DIR, "companies-metadata.json");

const ALLOWED_TYPES = [
  "bank",
  "nbfc",
  "insurance",
  "industrial",
  "it-services",
  "consumer",
  "utility",
  "telecom",
  "cyclical",
  "conglomerate",
  "loss-maker",
];

describe("public data registry parity", () => {
  const registryRaw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const metadataRaw = JSON.parse(readFileSync(METADATA_PATH, "utf8"));

  it("registry.json is a non-empty array of objects", () => {
    expect(Array.isArray(registryRaw)).toBe(true);
    expect(registryRaw.length).toBeGreaterThan(0);
    for (const entry of registryRaw) {
      expect(typeof entry).toBe("object");
      expect(entry).not.toBeNull();
    }
  });

  it("every registry entry has required string fields", () => {
    for (const entry of registryRaw) {
      expect(typeof entry.folder).toBe("string");
      expect(entry.folder.length).toBeGreaterThan(0);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.ticker).toBe("string");
      expect(entry.ticker.length).toBeGreaterThan(0);
      expect(typeof entry.type).toBe("string");
      expect(ALLOWED_TYPES).toContain(entry.type);
    }
  });

  it("no duplicate folders in registry", () => {
    const folders = registryRaw.map((e: { folder: string }) => e.folder);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it("no duplicate tickers in registry", () => {
    const tickers = registryRaw.map((e: { ticker: string }) => e.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it("every registry folder has a matching metadata entry", () => {
    const metadataFolders = new Set(metadataRaw.map((e: { folder: string }) => e.folder));
    for (const entry of registryRaw) {
      expect(metadataFolders.has(entry.folder)).toBe(true);
    }
  });

  it("every metadata folder has a matching registry entry", () => {
    const registryFolders = new Set(registryRaw.map((e: { folder: string }) => e.folder));
    for (const entry of metadataRaw) {
      expect(registryFolders.has(entry.folder)).toBe(true);
    }
  });

  it("every registry folder exists on disk", () => {
    for (const entry of registryRaw) {
      const folderPath = resolve(COMPANIES_DIR, entry.folder);
      expect(existsSync(folderPath)).toBe(true);
    }
  });

  it("hasStandalone is boolean when present", () => {
    for (const entry of registryRaw) {
      if (entry.hasStandalone !== undefined) {
        expect(typeof entry.hasStandalone).toBe("boolean");
      }
    }
  });

  it("parseLibraryCompanyRegistry accepts the real registry without errors", () => {
    const result = parseLibraryCompanyRegistry(registryRaw);
    expect(result.errors).toHaveLength(0);
    expect(result.companies.length).toBe(registryRaw.length);
  });
});
