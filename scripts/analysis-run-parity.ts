/**
 * Analysis-run parity: proves a change to the run engine leaves every library
 * company's run exactly as it was.
 *
 *   npm run parity -- --out=before.json          (record, e.g. on main)
 *   npm run parity -- --compare=before.json      (record again and diff)
 *
 * Each company is run through the app's own loader (scripts/lib/libraryCompanyRun.ts)
 * on a fixed clock and no live market price, so two recordings of unchanged
 * code are identical. A recording keeps, per company, the run's status and
 * reproducibility hash, the content hash of every artifact in order, and a
 * digest of each field of the materialization the UI reads (pipelineResult,
 * commandCenter, ...), so a mismatch names the field that moved.
 *
 * The digests are exact: numbers are written in full, -0, NaN and the
 * infinities are kept distinct, and keys are sorted. A refactor that reorders
 * floating-point arithmetic shows up here even where the run's own
 * reproducibility hash, rounded to 12 decimals, would not.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryCompany } from "../src/components/data-entry/companyRegistry";
import { ACTIVE_MARKET_PACKS, packVintage } from "../src/engine/marketPacks";
import { loadQualitySidecar } from "./lib/auditCompanyRun";
import { runLibraryCompany } from "./lib/libraryCompanyRun";

const PROJECT_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REGISTRY_PATH = join(PROJECT_ROOT, "public", "data", "companies", "registry.json");
/**
 * Any fixed date reproduces. The default is the audit harness's clock, the
 * pinned packs' vintage, so the packs resolve as they do in CI. A recording
 * keeps its date, and a comparison across a pack refresh says so.
 */
const DEFAULT_AS_OF = packVintage(ACTIVE_MARKET_PACKS);
const FINANCIAL_LIBRARY_TYPES = new Set<string>(["bank", "nbfc", "insurance"]);

interface CompanyParity {
  readonly status: string;
  readonly basis: string | null;
  readonly code: string | null;
  readonly reproducibilityHash: string | null;
  readonly artifacts: readonly string[];
  readonly diagnostics: string;
  readonly materialization: Readonly<Record<string, string>>;
}

interface ParityRecording {
  readonly asOf: string;
  readonly companies: Readonly<Record<string, CompanyParity>>;
}

function exactStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Object.is(value, -0)) return "-0";
    return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (value instanceof Map) return `Map(${exactStringify([...value.entries()])})`;
  if (value instanceof Set) return `Set(${exactStringify([...value.values()])})`;
  if (ArrayBuffer.isView(value)) return `Bytes(${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")})`;
  if (Array.isArray(value)) return `[${value.map(exactStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // An absent key and one set to undefined serialize alike, as JSON would.
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${exactStringify(record[key])}`).join(",")}}`;
  }
  return `<${typeof value}>`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(exactStringify(value), "utf-8").digest("hex");
}

async function recordCompany(company: LibraryCompany, asOf: string): Promise<CompanyParity> {
  const { quality } = loadQualitySidecar(PROJECT_ROOT, company.folder);
  const state = await runLibraryCompany(PROJECT_ROOT, company, {
    now: new Date(`${asOf}T00:00:00.000Z`),
    bankQuality: FINANCIAL_LIBRARY_TYPES.has(company.type) ? quality : null,
  });
  if (state.status !== "ready") {
    return { status: `load-${state.status}`, basis: null, code: state.message, reproducibilityHash: null, artifacts: [], diagnostics: "", materialization: {} };
  }
  const result = state.result;
  const code = result.status === "blocked" ? result.reasonCode : result.status === "failed" ? result.errorCode : null;
  return {
    status: result.status,
    basis: state.basis ?? null,
    code,
    reproducibilityHash: result.run?.reproducibilityHash ?? null,
    artifacts: result.artifacts.map((artifact) => `${artifact.ref.kind}:${artifact.ref.contentHash}`),
    diagnostics: digest(result.diagnostics),
    materialization: Object.fromEntries(
      Object.entries(result.materialization).map(([key, value]) => [key, digest(value)]),
    ),
  };
}

function compare(before: ParityRecording, after: ParityRecording): string[] {
  const problems: string[] = [];
  if (before.asOf !== after.asOf) problems.push(`clock: recorded as of ${before.asOf}, now ${after.asOf}`);
  const folders = [...new Set([...Object.keys(before.companies), ...Object.keys(after.companies)])].sort();
  for (const folder of folders) {
    const a = before.companies[folder];
    const b = after.companies[folder];
    if (!a || !b) {
      problems.push(`${folder}: ${a ? "missing now" : "not in the baseline"}`);
      continue;
    }
    for (const field of ["status", "basis", "code", "reproducibilityHash", "diagnostics"] as const) {
      if (a[field] !== b[field]) problems.push(`${folder}: ${field} ${a[field]} -> ${b[field]}`);
    }
    if (a.artifacts.length !== b.artifacts.length) {
      problems.push(`${folder}: ${a.artifacts.length} artifacts -> ${b.artifacts.length}`);
    }
    a.artifacts.forEach((artifact, index) => {
      if (b.artifacts[index] !== undefined && b.artifacts[index] !== artifact) {
        problems.push(`${folder}: artifact ${index} ${artifact} -> ${b.artifacts[index]}`);
      }
    });
    const keys = [...new Set([...Object.keys(a.materialization), ...Object.keys(b.materialization)])].sort();
    for (const key of keys) {
      if (a.materialization[key] !== b.materialization[key]) problems.push(`${folder}: materialization.${key} differs`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  let out: string | null = null;
  let baseline: string | null = null;
  let asOf = DEFAULT_AS_OF ?? "";
  let ticker: string | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg.startsWith("--compare=")) baseline = arg.slice("--compare=".length);
    else if (arg.startsWith("--as-of=")) asOf = arg.slice("--as-of=".length);
    else if (arg.startsWith("--ticker=")) ticker = arg.slice("--ticker=".length).toUpperCase();
    else {
      console.log("Usage: npm run parity -- [--out=FILE] [--compare=FILE] [--as-of=YYYY-MM-DD] [--ticker=TICKER]");
      process.exit(arg === "--help" ? 0 : 2);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);

  const registry: LibraryCompany[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  const companies = ticker
    ? registry.filter((company) => company.ticker.toUpperCase() === ticker || company.folder.toUpperCase() === ticker)
    : registry;
  const recorded: Record<string, CompanyParity> = {};
  for (const company of companies) {
    const started = Date.now();
    recorded[company.folder] = await recordCompany(company, asOf);
    const entry = recorded[company.folder]!;
    console.log(`${company.folder.padEnd(28)} ${entry.status.padEnd(10)} ${(entry.code ?? "").padEnd(36)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const recording: ParityRecording = { asOf, companies: recorded };
  if (out) writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");

  if (baseline) {
    const before = JSON.parse(readFileSync(baseline, "utf-8")) as ParityRecording;
    const scoped: ParityRecording = ticker
      ? { asOf: before.asOf, companies: Object.fromEntries(Object.entries(before.companies).filter(([folder]) => folder in recorded)) }
      : before;
    const problems = compare(scoped, recording);
    if (problems.length) {
      console.log(`\nParity FAILED: ${problems.length} difference(s)`);
      for (const problem of problems) console.log(`  ${problem}`);
      process.exit(1);
    }
    console.log(`\nParity holds for ${Object.keys(recorded).length} companies.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
