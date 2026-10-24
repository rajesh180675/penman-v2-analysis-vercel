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
 *
 * To see what moved, dump both recordings and compare the dumps:
 *
 *   npm run parity -- --out=before.json --dump=before-dump
 *   npm run parity -- --compare=before.json --dump=after-dump --baseline-dump=before-dump
 *
 * A dump keeps each company's diagnostics and engine outputs (not the inputs
 * the run echoes back), and a comparison with both dumps lists every leaf that
 * moved. With --tolerance=X a company whose only moved leaves are numbers
 * within X of each other (relative, or absolute below 1) passes: a change
 * that reorders arithmetic, or computes the same value another way, is then
 * proved to move nothing else. Its status, code, diagnostics and artifact
 * count must still match exactly.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
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
/** Inputs the run echoes back unchanged; their digests show any move, so a dump leaves them out. */
const INPUT_ECHOES = new Set(["rawData", "config", "marketSnapshot", "segmentData", "bankQuality", "sourceArtifactHashes", "debugInfo", "parserDiagnostics"]);
/** JSON has no -0, NaN or infinities; a dump writes them as tagged strings. */
const NUMBER_TAG = "__number:";
/** Moved leaves listed per company. */
const LISTED_CHANGES = 8;

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

function dumpPath(directory: string, folder: string): string {
  return join(directory, `${folder.replace(/[^A-Za-z0-9]+/g, "-")}.json.gz`);
}

function writeDump(directory: string, folder: string, payload: unknown): void {
  const json = JSON.stringify(payload, (_key, value: unknown) =>
    typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))
      ? `${NUMBER_TAG}${Object.is(value, -0) ? "-0" : String(value)}`
      : value);
  writeFileSync(dumpPath(directory, folder), gzipSync(json));
}

function readDump(directory: string, folder: string): unknown {
  const path = dumpPath(directory, folder);
  return existsSync(path) ? JSON.parse(gunzipSync(readFileSync(path)).toString("utf-8")) : null;
}

interface LeafChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
  /** Relative gap (absolute below 1) for two numbers; Infinity for anything else. */
  readonly gap: number;
}

function changedLeaves(before: unknown, after: unknown, path: string, out: LeafChange[]): void {
  if (typeof before === "number" && typeof after === "number") {
    const gap = Math.abs(before - after) / Math.max(1, Math.abs(before), Math.abs(after));
    if (gap > 0) out.push({ path, before, after, gap });
    return;
  }
  if (before && after && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after)) {
    const a = before as Record<string, unknown>;
    const b = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) changedLeaves(a[key], b[key], path ? `${path}.${key}` : key, out);
    return;
  }
  if (before !== after) out.push({ path, before, after, gap: Number.POSITIVE_INFINITY });
}

function shown(value: unknown): string {
  const text = typeof value === "string" ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

async function recordCompany(company: LibraryCompany, asOf: string, dumpDirectory: string | null): Promise<CompanyParity> {
  const { quality } = loadQualitySidecar(PROJECT_ROOT, company.folder);
  const state = await runLibraryCompany(PROJECT_ROOT, company, {
    now: new Date(`${asOf}T00:00:00.000Z`),
    bankQuality: FINANCIAL_LIBRARY_TYPES.has(company.type) ? quality : null,
  });
  if (state.status !== "ready") {
    return { status: `load-${state.status}`, basis: null, code: state.message, reproducibilityHash: null, artifacts: [], diagnostics: "", materialization: {} };
  }
  const result = state.result;
  if (dumpDirectory) {
    writeDump(dumpDirectory, company.folder, {
      diagnostics: result.diagnostics,
      materialization: Object.fromEntries(Object.entries(result.materialization).filter(([key]) => !INPUT_ECHOES.has(key))),
    });
  }
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

/** Differences that a tolerance never excuses: what the run decided, not the values it reached. */
function exactProblems(folder: string, a: CompanyParity, b: CompanyParity): string[] {
  const problems: string[] = [];
  for (const field of ["status", "basis", "code", "diagnostics"] as const) {
    if (a[field] !== b[field]) problems.push(`${folder}: ${field} ${a[field]} -> ${b[field]}`);
  }
  if (a.artifacts.length !== b.artifacts.length) problems.push(`${folder}: ${a.artifacts.length} artifacts -> ${b.artifacts.length}`);
  return problems;
}

/** Differences in the content the run produced: hashes and materialized fields. */
function contentProblems(folder: string, a: CompanyParity, b: CompanyParity): string[] {
  const problems: string[] = [];
  if (a.reproducibilityHash !== b.reproducibilityHash) problems.push(`${folder}: reproducibilityHash ${a.reproducibilityHash} -> ${b.reproducibilityHash}`);
  const kinds = new Map<string, number>();
  a.artifacts.forEach((artifact, index) => {
    if (b.artifacts[index] !== undefined && b.artifacts[index] !== artifact) {
      const kind = artifact.slice(0, artifact.indexOf(":"));
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
  });
  if (kinds.size) {
    const changed = [...kinds.values()].reduce((sum, count) => sum + count, 0);
    problems.push(`${folder}: ${changed} of ${a.artifacts.length} artifact hashes differ (${[...kinds].map(([kind, count]) => `${kind} ${count}`).join(", ")})`);
  }
  const keys = [...new Set([...Object.keys(a.materialization), ...Object.keys(b.materialization)])].sort();
  for (const key of keys) {
    if (a.materialization[key] !== b.materialization[key]) problems.push(`${folder}: materialization.${key} differs`);
  }
  return problems;
}

async function main(): Promise<void> {
  let out: string | null = null;
  let baseline: string | null = null;
  let dumpDirectory: string | null = null;
  let baselineDumpDirectory: string | null = null;
  let tolerance = 0;
  let asOf = DEFAULT_AS_OF ?? "";
  let ticker: string | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg.startsWith("--compare=")) baseline = arg.slice("--compare=".length);
    else if (arg.startsWith("--dump=")) dumpDirectory = arg.slice("--dump=".length);
    else if (arg.startsWith("--baseline-dump=")) baselineDumpDirectory = arg.slice("--baseline-dump=".length);
    else if (arg.startsWith("--tolerance=")) tolerance = Number(arg.slice("--tolerance=".length));
    else if (arg.startsWith("--as-of=")) asOf = arg.slice("--as-of=".length);
    else if (arg.startsWith("--ticker=")) ticker = arg.slice("--ticker=".length).toUpperCase();
    else {
      console.log("Usage: npm run parity -- [--out=FILE] [--compare=FILE] [--dump=DIR] [--baseline-dump=DIR] [--tolerance=X] [--as-of=YYYY-MM-DD] [--ticker=TICKER]");
      process.exit(arg === "--help" ? 0 : 2);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error(`--tolerance must be a non-negative number, got ${tolerance}`);
  if (tolerance > 0 && !(dumpDirectory && baselineDumpDirectory)) throw new Error("--tolerance needs --dump and --baseline-dump, so the values behind each digest can be compared.");
  if (dumpDirectory) mkdirSync(dumpDirectory, { recursive: true });

  const registry: LibraryCompany[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  const companies = ticker
    ? registry.filter((company) => company.ticker.toUpperCase() === ticker || company.folder.toUpperCase() === ticker)
    : registry;
  const recorded: Record<string, CompanyParity> = {};
  for (const company of companies) {
    const started = Date.now();
    recorded[company.folder] = await recordCompany(company, asOf, dumpDirectory);
    const entry = recorded[company.folder]!;
    console.log(`${company.folder.padEnd(28)} ${entry.status.padEnd(10)} ${(entry.code ?? "").padEnd(36)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const recording: ParityRecording = { asOf, companies: recorded };
  if (out) writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");

  if (baseline) {
    const before = JSON.parse(readFileSync(baseline, "utf-8")) as ParityRecording;
    const problems: string[] = [];
    if (before.asOf !== recording.asOf) problems.push(`clock: recorded as of ${before.asOf}, now ${recording.asOf}`);
    const folders = ticker ? Object.keys(recorded).sort() : [...new Set([...Object.keys(before.companies), ...Object.keys(recorded)])].sort();
    const withinTolerance: string[] = [];
    for (const folder of folders) {
      const a = before.companies[folder];
      const b = recorded[folder];
      if (!a || !b) {
        problems.push(`${folder}: ${a ? "missing now" : "not in the baseline"}`);
        continue;
      }
      const exact = exactProblems(folder, a, b);
      const content = contentProblems(folder, a, b);
      if (!exact.length && !content.length) continue;
      const leaves: LeafChange[] = [];
      const dumped = dumpDirectory && baselineDumpDirectory;
      if (dumped) changedLeaves(readDump(baselineDumpDirectory, folder), readDump(dumpDirectory, folder), "", leaves);
      const moved = leaves.filter((leaf) => leaf.gap > tolerance);
      if (!exact.length && dumped && tolerance > 0 && moved.length === 0) {
        withinTolerance.push(`${folder}: ${leaves.length} numbers moved, the largest by ${Math.max(...leaves.map((leaf) => leaf.gap), 0).toExponential(1)}`);
        continue;
      }
      problems.push(...exact, ...content);
      if (dumped) {
        problems.push(`${folder}: ${moved.length} leaves moved${tolerance > 0 ? ` beyond ${tolerance}` : ""}`);
        for (const leaf of [...moved].sort((x, y) => y.gap - x.gap).slice(0, LISTED_CHANGES)) {
          const gap = Number.isFinite(leaf.gap) ? ` (${leaf.gap.toExponential(1)})` : "";
          problems.push(`    ${leaf.path}: ${shown(leaf.before)} -> ${shown(leaf.after)}${gap}`);
        }
      }
    }
    if (withinTolerance.length) {
      console.log(`\nWithin tolerance (${tolerance}): ${withinTolerance.length} compan${withinTolerance.length === 1 ? "y" : "ies"}`);
      for (const line of withinTolerance) console.log(`  ${line}`);
    }
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
