/**
 * Case render parity: proves a change leaves every library company's Case
 * page, as the default UI renders it, exactly as it was.
 *
 *   npm run parity:case -- --out=before.json --dump=before-case
 *   npm run parity:case -- --compare=before.json --dump=after-case --baseline-dump=before-case
 *
 * The run parity harness (analysis-run-parity.ts) proves the engine's output
 * unchanged, but a change to what the UI reads, or how, is invisible to it.
 * This renders each company's six Case sections (src/next/CasePage.tsx) to
 * static markup from the app's own run of it (scripts/lib/libraryCompanyRun.ts)
 * on a fixed clock and no live price, beside the committed frozen snapshots,
 * track record and tie-out the page loads, and records a digest of each. A
 * comparison names each section whose markup moved and shows the text around
 * the first difference.
 *
 * Peers renders with no peer runs loaded, as the page first shows it, beside
 * the peers the app chooses (choosePeers).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseLibraryCompanyRegistry, type LibraryCompany } from "../src/components/data-entry/companyRegistry";
import { ACTIVE_MARKET_PACKS, packVintage } from "../src/engine/marketPacks";
import { CasePage } from "../src/next/CasePage";
import type { FrozenSnapshot, TieOutCompany, TrackRecordFile } from "../src/next/hooks";
import { CASE_SECTIONS, caseRoute, type CaseSection } from "../src/next/route";
import { choosePeers } from "../src/next/sections/PeersSection";
import { loadQualitySidecar } from "./lib/auditCompanyRun";
import { runLibraryCompany } from "./lib/libraryCompanyRun";

const PROJECT_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PUBLIC = join(PROJECT_ROOT, "public");
/** The run parity harness's clock: the pinned packs' vintage. */
const DEFAULT_AS_OF = packVintage(ACTIVE_MARKET_PACKS);
const FINANCIAL_LIBRARY_TYPES = new Set<string>(["bank", "nbfc", "insurance"]);
/** Characters of text shown either side of a section's first difference. */
const CONTEXT = 80;

interface CaseRecording {
  readonly asOf: string;
  readonly companies: Readonly<Record<string, Readonly<Record<CaseSection, string>> | { readonly error: string }>>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(PUBLIC, path), "utf-8")) as T;
}

function sectionFile(directory: string, folder: string, section: CaseSection): string {
  return join(directory, `${folder.replace(/[^A-Za-z0-9]+/g, "-")}.${section}.html`);
}

/** Markup as text, for showing where two renders part. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function firstDifference(before: string, after: string): string {
  const a = text(before);
  const b = text(after);
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  if (index === a.length && index === b.length) return "the text is identical; only the markup moved";
  const from = Math.max(0, index - CONTEXT);
  return `before: …${a.slice(from, index + CONTEXT)}…\n      after:  …${b.slice(from, index + CONTEXT)}…`;
}

async function renderCompany(
  company: LibraryCompany,
  asOf: string,
  context: { registry: readonly LibraryCompany[]; snapshots: readonly FrozenSnapshot[]; trackRecords: TrackRecordFile; tieOut: readonly TieOutCompany[] },
): Promise<Record<CaseSection, string> | { error: string }> {
  const { quality } = loadQualitySidecar(PROJECT_ROOT, company.folder);
  const run = await runLibraryCompany(PROJECT_ROOT, company, {
    now: new Date(`${asOf}T00:00:00.000Z`),
    bankQuality: FINANCIAL_LIBRARY_TYPES.has(company.type) ? quality : null,
  });
  if (run.status !== "ready") return { error: run.message };
  const peers = choosePeers(company, context.registry);
  const rendered = {} as Record<CaseSection, string>;
  for (const { id } of CASE_SECTIONS) {
    rendered[id] = renderToStaticMarkup(createElement(CasePage, {
      route: caseRoute(company.ticker, id),
      company,
      run,
      trackRecords: context.trackRecords,
      snapshots: context.snapshots,
      tieOut: context.tieOut,
      peers,
      peerRuns: null,
    }));
  }
  return rendered;
}

async function main(): Promise<void> {
  let out: string | null = null;
  let baseline: string | null = null;
  let dumpDirectory: string | null = null;
  let baselineDumpDirectory: string | null = null;
  let asOf = DEFAULT_AS_OF ?? "";
  let ticker: string | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg.startsWith("--compare=")) baseline = arg.slice("--compare=".length);
    else if (arg.startsWith("--dump=")) dumpDirectory = arg.slice("--dump=".length);
    else if (arg.startsWith("--baseline-dump=")) baselineDumpDirectory = arg.slice("--baseline-dump=".length);
    else if (arg.startsWith("--as-of=")) asOf = arg.slice("--as-of=".length);
    else if (arg.startsWith("--ticker=")) ticker = arg.slice("--ticker=".length).toUpperCase();
    else {
      console.log("Usage: npm run parity:case -- [--out=FILE] [--compare=FILE] [--dump=DIR] [--baseline-dump=DIR] [--as-of=YYYY-MM-DD] [--ticker=TICKER]");
      process.exit(arg === "--help" ? 0 : 2);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);
  if (dumpDirectory) mkdirSync(dumpDirectory, { recursive: true });

  // Parsed as the app parses it (src/next/hooks.ts useRegistry).
  const registry = parseLibraryCompanyRegistry(readJson<unknown>("data/companies/registry.json")).companies;
  const context = {
    registry,
    snapshots: readJson<FrozenSnapshot[]>("data/accountability/snapshots.json"),
    trackRecords: readJson<TrackRecordFile>("data/accountability/track-record.json"),
    tieOut: readJson<TieOutCompany[]>("data/filings/tie-out.json"),
  };
  const companies = ticker
    ? registry.filter((company) => company.ticker.toUpperCase() === ticker || company.folder.toUpperCase() === ticker)
    : registry;

  const recorded: Record<string, Record<CaseSection, string> | { error: string }> = {};
  for (const company of companies) {
    const started = Date.now();
    const rendered = await renderCompany(company, asOf, context);
    if ("error" in rendered) {
      recorded[company.folder] = { error: String(rendered.error) };
    } else {
      const digests = {} as Record<CaseSection, string>;
      for (const { id } of CASE_SECTIONS) {
        const html = rendered[id];
        digests[id] = createHash("sha256").update(html, "utf-8").digest("hex");
        if (dumpDirectory) writeFileSync(sectionFile(dumpDirectory, company.folder, id), html, "utf-8");
      }
      recorded[company.folder] = digests;
    }
    console.log(`${company.folder.padEnd(36)} ${"error" in rendered ? `error: ${rendered.error}` : "rendered"} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const recording: CaseRecording = { asOf, companies: recorded };
  if (out) writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");

  if (baseline) {
    const before = JSON.parse(readFileSync(baseline, "utf-8")) as CaseRecording;
    const problems: string[] = [];
    if (before.asOf !== recording.asOf) problems.push(`clock: recorded as of ${before.asOf}, now ${recording.asOf}`);
    const folders = ticker ? Object.keys(recorded).sort() : [...new Set([...Object.keys(before.companies), ...Object.keys(recorded)])].sort();
    for (const folder of folders) {
      const a = before.companies[folder];
      const b = recorded[folder];
      if (!a || !b) {
        problems.push(`${folder}: ${a ? "missing now" : "not in the baseline"}`);
        continue;
      }
      if ("error" in a || "error" in b) {
        if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${folder}: ${"error" in a ? a.error : "rendered"} -> ${"error" in b ? b.error : "rendered"}`);
        continue;
      }
      for (const { id } of CASE_SECTIONS) {
        if (a[id] === b[id]) continue;
        const detail = dumpDirectory && baselineDumpDirectory && existsSync(sectionFile(baselineDumpDirectory, folder, id))
          ? `\n      ${firstDifference(readFileSync(sectionFile(baselineDumpDirectory, folder, id), "utf-8"), readFileSync(sectionFile(dumpDirectory, folder, id), "utf-8"))}`
          : "";
        problems.push(`${folder}: ${id} differs${detail}`);
      }
    }
    if (problems.length) {
      console.log(`\nCase render parity FAILED: ${problems.length} difference(s)`);
      for (const problem of problems) console.log(`  ${problem}`);
      process.exit(1);
    }
    console.log(`\nCase render parity holds for ${Object.keys(recorded).length} companies, ${CASE_SECTIONS.length} sections each.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
