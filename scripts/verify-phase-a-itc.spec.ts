// @vitest-environment jsdom
//
// One-shot verification: run the Phase A multi-standard parser against the
// real ITC files in public/data/companies/ITC/ and emit a coverage report.
//
// This file lives under scripts/ deliberately so it can be deleted after
// recording results — it depends on user-supplied data and isn't part of
// the permanent test suite.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";
import { parseCapitalineZip } from "../src/engine/capitalineParser";
import { STANDARD_ALIASES, type AccountingStandard } from "../src/engine/standardAliases";

const ROOT = path.resolve(__dirname, "..", "public", "data", "companies", "ITC");
const REPORT_PATH = path.resolve(__dirname, "..", "docs", "phase-a-validation-2026-05-17.md");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.xls$/i.test(entry.name)) out.push(p);
  }
  return out;
}

function fmt(n: number, w = 4): string {
  return String(n).padStart(w, " ");
}

describe("Phase A ITC validation", () => {
  it("parses the real ITC dataset and writes a coverage report", async () => {
    expect(fs.existsSync(ROOT)).toBe(true);
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(0);

    /* ─── Build a JSZip preserving relative paths ──────────────────── */
    const zip = new JSZip();
    for (const abs of files) {
      const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
      zip.file(rel, fs.readFileSync(abs));
    }
    // Capitaline HTML-tables are highly compressible Angular templates —
    // the raw bundle is ~13 MB, deflated it's well under the 25 MB cap.
    const u8 = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    // jsdom provides File/Blob in this environment.
    const zipFile = new File([u8], "ITC-bundle.zip", { type: "application/zip" });

    /* ─── Parse ────────────────────────────────────────────────────── */
    let parsed: Awaited<ReturnType<typeof parseCapitalineZip>> | null = null;
    let parseError: string | null = null;
    try {
      parsed = await parseCapitalineZip(zipFile, { companyId: "ITC" });
    } catch (e) {
      parseError = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
    }

    if (parseError || !parsed) {
      const md = [
        "# Phase A ITC Validation — 2026-05-17",
        "",
        "## P0: PARSER THREW",
        "",
        "```",
        parseError ?? "(no error captured but parsed result was null)",
        "```",
        "",
        "## Files attempted",
        "",
        ...files.map((f) => `- ${path.relative(ROOT, f).replace(/\\/g, "/")}`),
      ].join("\n");
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, md);
      throw new Error("Parser threw — report written. " + parseError);
    }

    const { periods, debug } = parsed;

    /* ─── Section 1: Period coverage ───────────────────────────────── */
    const periodCoverage = periods.map((p) => ({
      period_end: p.period_end,
      accounting_standard: p.accounting_standard ?? "unknown",
      compositeKeyCount: Object.keys(p.raw_metric_values).filter((k) => k.includes("__")).length,
      baseKeyCount: Object.keys(p.raw_metric_values).filter((k) => !k.includes("__")).length,
      nonNullCount: Object.values(p.raw_metric_values).filter((v) => v != null).length,
    }));

    /* ─── Section 2: Standard distribution ─────────────────────────── */
    const stdDist: Record<AccountingStandard, number> = {
      "ind-as": 0, "revised-sch-vi": 0, standard: 0, unknown: 0,
    };
    for (const p of periodCoverage) {
      stdDist[p.accounting_standard as AccountingStandard]++;
    }

    /* ─── Section 4: Composite-key counts by source standard ───────── */
    // Reconstruct per-period contribution by re-parsing each file individually.
    // Cheaper: trust debug.rawGrids which records header detection per file
    // plus the file's own period coverage. We re-parse standalone-style by
    // decomposing the bundle into single-file zips.
    const perFileDetail: Array<{
      file: string;
      stdGuess: AccountingStandard;
      headerDetected: boolean;
      bestMethod: string;
      rowCount: number;
      periodLabels: string[];
      errors: string[];
    }> = debug.rawGrids.map((rg) => {
      // We don't have the std guess inside the grid debug. Re-derive from
      // the file path that was zipped. The debug.files entry only stores
      // the basename, so look it up from the ROOT walk.
      const matchingAbs = files.find((f) => f.endsWith(rg.file) || path.basename(f) === rg.file);
      const relPath = matchingAbs
        ? path.relative(ROOT, matchingAbs).replace(/\\/g, "/")
        : rg.file;
      const std = stdFromPath(relPath);
      return {
        file: relPath,
        stdGuess: std,
        headerDetected: rg.headerDetected,
        bestMethod: rg.bestMethod,
        rowCount: rg.rowCount,
        periodLabels: rg.periodLabels ?? [],
        errors: rg.errors,
      };
    });

    /* ─── Section 5: Unmapped-but-populated source labels ──────────── */
    // A "source label" in this context = the ORIGINAL (non-canonical) metric
    // name as it appeared in REV/Standard files. The parser already aliases
    // a known set (STANDARD_ALIASES). We want to surface labels the parser
    // did NOT alias but that are populated in many non-Ind-AS periods AND
    // have no canonical sibling already present in the merged data.
    //
    // Strategy:
    //   - Collect composite keys (metric__statement) populated (non-null)
    //     across ALL periods.
    //   - For each key, count: (a) periods where dominantStd != ind-as
    //     and value is non-null. (b) periods where dominantStd = ind-as
    //     and value is non-null.
    //   - Candidates = keys with high (a), low (b).  These are labels that
    //     show up in REV/Standard files but never in Ind-AS — so they're
    //     either old terminology that should be aliased to a canonical
    //     Ind-AS name, or genuinely standard-specific concepts.
    //   - Filter out any key whose original-label half is already covered
    //     by an alias source in STANDARD_ALIASES.
    const aliasSources = new Set(STANDARD_ALIASES.map((a) => a.source));
    const aliasCanonicals = new Set(STANDARD_ALIASES.map((a) => a.canonical));

    type KeyStat = {
      key: string;
      metric: string;
      statement: string;
      preIndAsPeriods: number;
      indAsPeriods: number;
      alreadyAliased: boolean;
      isCanonical: boolean;
    };
    const keyStats = new Map<string, KeyStat>();

    for (const p of periods) {
      const isIndAs = (p.accounting_standard ?? "unknown") === "ind-as";
      for (const [k, v] of Object.entries(p.raw_metric_values)) {
        if (!k.includes("__")) continue; // skip base-key duplicates
        if (v == null) continue;
        const sep = k.indexOf("__");
        const metric = k.slice(0, sep);
        const stmt = k.slice(sep + 2);
        let s = keyStats.get(k);
        if (!s) {
          s = {
            key: k,
            metric,
            statement: stmt,
            preIndAsPeriods: 0,
            indAsPeriods: 0,
            alreadyAliased: aliasSources.has(metric),
            isCanonical: aliasCanonicals.has(metric),
          };
          keyStats.set(k, s);
        }
        if (isIndAs) s.indAsPeriods++;
        else s.preIndAsPeriods++;
      }
    }

    // Alias candidates: appears only / mostly in pre-Ind-AS periods, not
    // already aliased, and not itself a canonical label that the alias
    // map already produces. Also drop pure section headers (length<=2 or
    // all caps fragments) as a safety net.
    const aliasCandidates = Array.from(keyStats.values())
      .filter((s) => !s.alreadyAliased)
      .filter((s) => !s.isCanonical)
      .filter((s) => s.preIndAsPeriods >= 2)
      .filter((s) => s.indAsPeriods === 0)
      .filter((s) => s.metric.length > 2)
      .sort((a, b) => b.preIndAsPeriods - a.preIndAsPeriods || a.metric.localeCompare(b.metric));

    /* ─── Section 3: Transition-year analysis ──────────────────────── */
    // For each FY where ind-as AND another standard could overlap, did
    // ind-as win? Standards-per-period was already recorded as the
    // accounting_standard field. To check overlap, we need to know which
    // standards CONTRIBUTED — we re-derive that from per-file period
    // labels.
    const periodsByStdContribution = new Map<string, Set<AccountingStandard>>();
    for (const f of perFileDetail) {
      if (!f.headerDetected) continue;
      for (const lbl of f.periodLabels) {
        // labels look like "Mar/2017→2017-03-31"
        const arrowIdx = lbl.lastIndexOf("→");
        if (arrowIdx < 0) continue;
        const pe = lbl.slice(arrowIdx + 1);
        if (!periodsByStdContribution.has(pe)) {
          periodsByStdContribution.set(pe, new Set());
        }
        periodsByStdContribution.get(pe)!.add(f.stdGuess);
      }
    }
    const transitions: Array<{
      period_end: string;
      contributing: AccountingStandard[];
      dominant: AccountingStandard;
      overlapNote: string;
    }> = [];
    for (const p of periodCoverage) {
      const contrib = periodsByStdContribution.get(p.period_end);
      if (!contrib || contrib.size <= 1) continue;
      transitions.push({
        period_end: p.period_end,
        contributing: Array.from(contrib),
        dominant: p.accounting_standard as AccountingStandard,
        overlapNote: contrib.has("ind-as") && contrib.size > 1
          ? "Ind-AS overlap (precedence test)"
          : contrib.has("revised-sch-vi") && contrib.has("standard")
            ? "REV vs Standard boundary"
            : "Other overlap",
      });
    }
    transitions.sort((a, b) => a.period_end.localeCompare(b.period_end));

    /* ─── Section 6: Warnings ──────────────────────────────────────── */
    const warnings = debug.warnings;

    /* ─── Compose Markdown report ──────────────────────────────────── */
    const md: string[] = [];
    md.push("# Phase A ITC Validation — 2026-05-17");
    md.push("");
    md.push("Real-data validation of the multi-standard Capitaline parser.");
    md.push(`Source: \`public/data/companies/ITC/\` (${files.length} .xls files)`);
    md.push("");
    md.push("## TL;DR");
    md.push("");
    md.push(`- Periods ingested: **${periods.length}** (range ${periods[0]?.period_end} → ${periods[periods.length - 1]?.period_end})`);
    md.push(`- Standard distribution: ind-as=${stdDist["ind-as"]}, revised-sch-vi=${stdDist["revised-sch-vi"]}, standard=${stdDist.standard}, unknown=${stdDist.unknown}`);
    md.push(`- Total composite keys (across all periods): ${debug.metrics.totalCompositeKeys}`);
    md.push(`- Files where header detection failed: ${perFileDetail.filter((f) => !f.headerDetected).length}`);
    md.push(`- Parser warnings: ${warnings.length}`);
    md.push(`- Alias candidates (frequent pre-Ind-AS labels with no Ind-AS twin): **${aliasCandidates.length}**`);
    md.push("");

    md.push("## 1. Period coverage");
    md.push("");
    md.push("| period_end | dominant std | composite keys | base keys | non-null cells |");
    md.push("|---|---|---:|---:|---:|");
    for (const p of periodCoverage) {
      md.push(`| ${p.period_end} | ${p.accounting_standard} | ${p.compositeKeyCount} | ${p.baseKeyCount} | ${p.nonNullCount} |`);
    }
    md.push("");

    md.push("## 2. Standard distribution");
    md.push("");
    md.push("| standard | period count |");
    md.push("|---|---:|");
    for (const k of ["ind-as", "revised-sch-vi", "standard", "unknown"] as const) {
      md.push(`| ${k} | ${stdDist[k]} |`);
    }
    md.push("");

    md.push("## 3. Transition years (multiple standards contributing to same FY)");
    md.push("");
    if (!transitions.length) {
      md.push("_No transition-year overlaps detected._ This is unexpected — Capitaline typically reports FY2017 in both Ind-AS and Revised Sch-VI files. Investigate which file is missing FY2017.");
    } else {
      md.push("| period_end | contributing standards | dominant | note |");
      md.push("|---|---|---|---|");
      for (const t of transitions) {
        md.push(`| ${t.period_end} | ${t.contributing.join(", ")} | ${t.dominant} | ${t.overlapNote} |`);
      }
    }
    md.push("");

    md.push("## 4. Per-file ingest detail");
    md.push("");
    md.push("| file | std guess | header | best method | rows | period count |");
    md.push("|---|---|---|---|---:|---:|");
    for (const f of perFileDetail) {
      md.push(`| \`${f.file}\` | ${f.stdGuess} | ${f.headerDetected ? "✅" : "❌"} | ${f.bestMethod} | ${f.rowCount} | ${f.periodLabels.length} |`);
    }
    md.push("");
    const failedFiles = perFileDetail.filter((f) => !f.headerDetected);
    if (failedFiles.length) {
      md.push("### Files with no header detected");
      md.push("");
      for (const f of failedFiles) {
        md.push(`- \`${f.file}\` — best method: ${f.bestMethod}, rows: ${f.rowCount}, errors: ${f.errors.join("; ") || "(none)"}`);
      }
      md.push("");
    }

    md.push("## 5. Top alias candidates (unmapped source labels populated only in pre-Ind-AS periods)");
    md.push("");
    md.push("These metric labels are populated in REV / Standard files across multiple periods but never appear in Ind-AS periods, and have no entry in `STANDARD_ALIASES`. Each is a candidate to map to an Ind-AS canonical name in a focused follow-up commit.");
    md.push("");
    md.push("| rank | metric (source label) | statement | pre-Ind-AS periods populated |");
    md.push("|---:|---|---|---:|");
    const topN = aliasCandidates.slice(0, 30);
    topN.forEach((c, i) => {
      md.push(`| ${i + 1} | \`${c.metric}\` | ${c.statement} | ${c.preIndAsPeriods} |`);
    });
    md.push("");
    if (aliasCandidates.length > topN.length) {
      md.push(`_…${aliasCandidates.length - topN.length} more candidates omitted._`);
      md.push("");
    }

    md.push("## 6. Parser warnings");
    md.push("");
    if (!warnings.length) md.push("_No warnings._");
    else {
      for (const w of warnings) {
        md.push(`- **${w.file ?? "(unknown file)"}**: ${w.message}`);
        if (w.detail) {
          md.push("  ```");
          md.push("  " + w.detail.split("\n").join("\n  "));
          md.push("  ```");
        }
      }
    }
    md.push("");

    md.push("## 7. Detected periods (chronological)");
    md.push("");
    md.push("```");
    md.push(debug.detectedPeriods.join("\n"));
    md.push("```");
    md.push("");

    md.push("## Appendix A: Statement-level metric counts (totals across all periods)");
    md.push("");
    md.push("| statement | composite keys |");
    md.push("|---|---:|");
    for (const k of ["BalanceSheet", "ProfitLoss", "CashFlow", "Unknown"] as const) {
      md.push(`| ${k} | ${debug.metrics.byStatement[k] ?? 0} |`);
    }
    md.push("");

    md.push("## Appendix B: All alias candidates (ranked)");
    md.push("");
    md.push("| metric | statement | pre-Ind-AS periods |");
    md.push("|---|---|---:|");
    for (const c of aliasCandidates) {
      md.push(`| \`${c.metric}\` | ${c.statement} | ${c.preIndAsPeriods} |`);
    }
    md.push("");

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, md.join("\n"));

    /* ─── Console summary so the parent agent sees the verdict ────── */
    // eslint-disable-next-line no-console
    console.log("\n=== PHASE A VALIDATION SUMMARY ===");
    console.log(`Report written: ${REPORT_PATH}`);
    console.log(`Periods: ${periods.length}`);
    console.log(`Std dist: ind-as=${stdDist["ind-as"]} rev=${stdDist["revised-sch-vi"]} std=${stdDist.standard} unknown=${stdDist.unknown}`);
    console.log(`Composite keys: ${debug.metrics.totalCompositeKeys}`);
    console.log(`Failed-header files: ${failedFiles.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log(`Alias candidates: ${aliasCandidates.length}`);
    console.log("Top-15 alias candidates:");
    for (const c of aliasCandidates.slice(0, 15)) {
      console.log(`  ${fmt(c.preIndAsPeriods, 3)}  ${c.metric}  [${c.statement}]`);
    }
    console.log("Per-file:");
    for (const f of perFileDetail) {
      console.log(`  ${f.headerDetected ? "OK " : "❌ "} ${f.stdGuess.padEnd(15)} ${f.bestMethod.padEnd(10)} ${f.periodLabels.length} periods  ${f.file}`);
    }

    expect(periods.length).toBeGreaterThan(0);
  }, 180_000);
});

/** Replicates `standardFromFilename` so we can label per-file in the report. */
function stdFromPath(p: string): AccountingStandard {
  const lower = p.toLowerCase();
  if (lower.includes("indas")) return "ind-as";
  if (lower.includes("revised") || lower.includes("revsch") || /\brev\b/.test(lower)) return "revised-sch-vi";
  if (lower.includes("standard") || lower.includes("gaap")) return "standard";
  return "unknown";
}
