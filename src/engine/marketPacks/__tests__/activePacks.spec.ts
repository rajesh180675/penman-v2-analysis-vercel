/* ================================================================
   Pack activation — that every capital-cost call site is accounted for.

   Most assertions here inspect source rather than call a function. That
   is deliberate, and it is because of how a pack reaches the resolver:
   as an argument, never a default.

   `resolveCostOfCapitalFromConfig({ config })` returns the *unpinned*
   rate — the same undated `rf + sectorBeta × erp` it always did — and it
   does so silently, with no error and no tier a caller would notice was
   wrong. So the failure activation has to prevent is not "the pack is
   wrong". It is "a call site forgot the pack", which yields two
   different discount rates for one run: the number the app prints and
   the number the run recorded. That is the S-9.4C violation, and no
   behavioural test of the resolver can see it, because the resolver
   behaved correctly both times.

   What can see it is the set of call sites, so the census below owns
   that set. Every module that resolves a capital cost must be in
   exactly one of three lists, and the last test derives the real set
   from the tree so a new one cannot appear unlisted.

   The unit is one *call*, not one file, and that distinction is the
   whole guard rather than a refinement of it. The first version of this
   spec asked whether a file contained the text `ACTIVE_MARKET_PACKS`
   anywhere — and passed `ValuationReport.tsx`, which supplied the packs
   when resolving its displayed ke and omitted them in the
   `buildValuationCommandCenter` fallback thirty lines further down. A
   file-level check cannot see that, because the file satisfies it on the
   strength of the call that was already correct. So each call is parsed
   and classified on its own arguments.
================================================================ */

import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACTIVE_MARKET_PACKS, analysisAsOfToday } from "../activePacks";
import { INDIA_EQUITY_BETA_PACK } from "../indiaEquityBetaPack";
import { INDIA_MACRO_PACK } from "../indiaMacroPack";
import { resolveMacroPack } from "../macroPack";
import { resolveEquityBeta } from "../equityBetaPack";
import { resolveCostOfCapitalFromConfig } from "../../costOfCapital";
import { DEFAULT_CONFIG, type EngineConfig } from "../../types";

/**
 * Supplies the packs: everything whose resolved rate a reviewer reads, or
 * that records one. Every capital-cost call in these must name
 * `ACTIVE_MARKET_PACKS`.
 */
const SUPPLIES_PACKS = [
  "src/app/useAuditAnalysis.ts",
  "src/components/dashboard/DashboardView.tsx",
  "src/components/ValuationReport.tsx",
  "src/components/ComparisonReport.tsx",
  "src/components/ForecastReport.tsx",
  "src/components/V3AnalyticsPanel.tsx",
  "src/components/AcademicReport.tsx",
  "src/components/InvestmentThesis.tsx",
];

/**
 * The tenth supply site, and the one the census cannot classify: it resolves
 * no capital cost of its own. It assembles the run input, and the executor is
 * what reaches a resolver — so what has to be asserted here is the spread onto
 * that input, not a call.
 */
const RUN_INPUT_SITE = "src/app/analysisRun/useAnalysisRunExecution.ts";

/**
 * Takes the packs from its caller. Every capital-cost call in these must
 * forward what it was given, and these files must NOT name
 * `ACTIVE_MARKET_PACKS`: importing it would make a spec that calls one of
 * these directly resolve production packs, which is exactly the
 * supplied-never-inferred contract the resolver's testability rests on.
 */
const PASSES_PACKS_THROUGH = [
  "src/engine/valuationCommandCenter/core.ts",
  "src/engine/analysisCase/assumptionResolution.ts",
  "src/engine/grahamDoddEPV.ts",
  "src/engine/v3Analytics/compute.ts",
  // The run executor. It builds the command center through an injected
  // `dependencies.buildCommandCenter`, so the callee is spelled differently
  // from every other site — which is why `buildCommandCenter` is a matched
  // name below. It forwards `input.macroPack`/`input.betaPack` against the
  // run's frozen `metadata.asOf` rather than the clock, which is what makes a
  // replayed run reproduce its provenance tier.
  "src/engine/analysisRun/legacyExecutor.ts",
];

/**
 * Deliberately still unpinned, each for a stated reason. Listed rather
 * than skipped so the exemption is a decision on the record instead of an
 * omission — and so the list can be worked down.
 */
const KNOWN_UNPINNED: ReadonlyArray<readonly [string, string]> = [
  // Recast layer. Its ke feeds `ri.RE` and the anomaly series, not a
  // discount rate — and `processCompanyDataFull` is the entry point the CLI
  // audit harness and refresh-expectations.ts share, so pinning it moves the
  // captured baselines for all 33 companies. Separate change, with a
  // baseline re-capture.
  ["src/engine/pipeline.ts", "recast RI; shared with the baseline harness"],
  // Bank/NBFC family, reached only through `pipeline.ts` above. Pinning
  // these without it would fork the same recast two ways.
  ["src/engine/bankValuation/computeBankValuation.ts", "downstream of pipeline.ts"],
  ["src/engine/financialInstitutionFramework.ts", "downstream of pipeline.ts"],
  ["src/engine/moatScoring/bank.ts", "downstream of pipeline.ts"],
  ["src/engine/capitalAllocationScoring/bank.ts", "downstream of pipeline.ts"],
  // Workbook cover sheets. They print a ke for the reader, so these are a
  // real gap — but both are export-time renderers with no pack in scope,
  // and threading them means changing the export entry signatures.
  ["src/engine/bankExcelExport.ts", "export renderer; no pack in scope"],
  ["src/engine/excelExport/sheetsCore.ts", "export renderer; no pack in scope"],
  // Regression and guardrail harnesses. These compare the engine against
  // itself, so an undated rate on both sides of the comparison is the
  // point; a pinned rate that lapses would move the benchmark.
  ["src/engine/baselineGuardrails.ts", "self-comparison; undated on both sides"],
  ["src/engine/regressionHarness.ts", "self-comparison; undated on both sides"],
  // The CLI audit harness, and the exemption worth understanding rather than
  // scanning past. It pins `generatedAt` to 2026-06-04 so 33 company audits
  // reproduce byte-for-byte, and it passes no `analysisAsOf` at all. Both facts
  // matter, and neither makes activation here a one-line change:
  //
  //   - Handing it the packs *without* an as-of date is the worse option, not
  //     the easy one: `resolveMacroObservation` skips staleness AND look-ahead
  //     entirely when the date is falsy, so the harness would honour these
  //     observations forever, including long after they lapse.
  //   - Handing it the packs *with* its own pinned date splits them. The
  //     risk-free rate (2026-07-24) and every beta window (ending 2026-07-19)
  //     postdate 2026-06-04, so they resolve as look-ahead and `unusable` — a
  //     pinned run cannot consume observations from its own future. The ERP
  //     (2026-01-05) predates it and would resolve `sourced`. That leaves ke
  //     part-sourced and part-prior, which `CoreBuildContext.betaPack` warns
  //     against by name: pass both or neither.
  //
  // The consequence today is real and not hidden: the harness scores the
  // assumption-provenance gate on undated priors while the app scores it on
  // sourced observations, so the two disagree about production-readiness.
  // Closing it means a pack vintage matched to the harness's own as-of, not
  // today's pack and not today's clock.
  ["scripts/lib/auditCompanyRun.ts", "pinned as-of predates two of three observations"],
];

/* ── The census machinery ─────────────────────────────────────────
   Parsed rather than pattern-matched, so that what is being asked is
   "does *this call* receive the packs" and not "does this file mention
   them somewhere". A comment, a type annotation or an import cannot
   satisfy any assertion below.
────────────────────────────────────────────────────────────────── */

/**
 * The functions that turn a config into a capital cost, plus the two that
 * wrap one. `buildCommandCenter` is the injected alias the run executor calls
 * through — matched on the property name, since a dependency-injected call
 * site is still a call site.
 */
const RESOLVER_NAMES = new Set([
  "resolveCostOfCapitalFromConfig",
  "buildValuationCommandCenter",
  "buildCommandCenter",
  "computeEPV",
  "computeV3Analytics",
]);

/** Names that count as handing packs down from a parameter. */
const FORWARDED_NAMES = new Set(["packs", "macroPack", "betaPack"]);

type SupplyMode = "active" | "forwarded" | "none";

interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly callee: string;
  readonly mode: SupplyMode;
  /**
   * Whether this call also hands over a usable `analysisAsOf` — see
   * `datesTheCall`, which rejects the falsy literals rather than accepting the
   * property name.
   *
   * Tracked separately from `mode`, and asserted separately, because packs
   * without a date is its own mistake and the worse of the two: both resolvers
   * gate their age checks on the date being truthy (`macroPack.ts` and
   * `equityBetaPack.ts`), so an undated call skips staleness *and* look-ahead
   * and resolves `sourced` forever — including long after the observation
   * lapses. Folding this into `mode` would report "not active" for two
   * different errors and leave the reviewer guessing which one they made.
   */
  readonly dated: boolean;
}

function describeCall(call: CallSite): string {
  return `${call.file}:${call.line} ${call.callee}(…) supplies: ${call.mode}`;
}

function describeUndated(call: CallSite): string {
  return `${call.file}:${call.line} ${call.callee}(…) supplies packs with no analysisAsOf`;
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/**
 * The identifiers this call actually hands over: spread expressions, property
 * names, and bare identifier arguments. Deliberately shallow — a pack has to
 * arrive as an argument of this call, so a name mentioned in a nested
 * expression is not the same thing as one supplied.
 */
function suppliedNames(call: ts.CallExpression, sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const arg of call.arguments) {
    if (ts.isIdentifier(arg)) {
      names.add(arg.text);
      continue;
    }
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const property of arg.properties) {
      if (ts.isSpreadAssignment(property)) {
        names.add(property.expression.getText(sf));
      } else if (property.name && ts.isIdentifier(property.name)) {
        names.add(property.name.text);
      }
    }
  }
  return names;
}

function classify(names: Set<string>): SupplyMode {
  if (names.has("ACTIVE_MARKET_PACKS")) return "active";
  for (const name of FORWARDED_NAMES) if (names.has(name)) return "forwarded";
  return "none";
}

/**
 * Whether this call hands over a *usable* `analysisAsOf`.
 *
 * The property name alone is not enough, and the gap is the same shape as the
 * one #45 closed: `analysisAsOf: undefined` reads as supplied and behaves as
 * omitted, because both resolvers only ever test the date for truthiness. So
 * the three falsy literals are rejected here.
 *
 * Anything computed — a call, a property access, a bare identifier — is taken
 * at face value. Source cannot evaluate it, and a check that demanded a literal
 * date would reject `analysisAsOfToday()`, which is the correct way to date a
 * live surface. A date arriving inside a spread is likewise invisible; that
 * reads as undated, which fails loudly rather than passing quietly.
 */
function datesTheCall(call: ts.CallExpression): boolean {
  for (const arg of call.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const property of arg.properties) {
      if (!property.name || !ts.isIdentifier(property.name)) continue;
      if (property.name.text !== "analysisAsOf") continue;
      // Shorthand (`{ analysisAsOf }`) forwards whatever is in scope.
      if (!ts.isPropertyAssignment(property)) return true;
      return !isFalsyLiteral(property.initializer);
    }
  }
  return false;
}

function isFalsyLiteral(expression: ts.Expression): boolean {
  if (expression.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(expression) && expression.text === "undefined") return true;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text.length === 0;
  }
  return false;
}

/** Every capital-cost call in one file, with what each one supplies. */
function callSitesIn(file: string): CallSite[] {
  return callSitesInSource(file, source(file));
}

/**
 * The classifier proper, over text rather than a path, so the falsy-date cases
 * can be asserted on a snippet. They cannot be asserted on the tree: no file in
 * the repo writes `analysisAsOf: undefined` today, which is the point — the
 * check exists so the first one that does fails.
 */
function callSitesInSource(file: string, text: string): CallSite[] {
  // Cheap skip for the tree walk: a call needs its callee's identifier text to
  // appear somewhere in the file, so a file naming none of them has none.
  if (![...RESOLVER_NAMES].some((name) => text.includes(name))) return [];

  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: CallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee && RESOLVER_NAMES.has(callee)) {
        const names = suppliedNames(node, sf);
        found.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          callee,
          mode: classify(names),
          dated: datesTheCall(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function source(path: string): string {
  return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf-8");
}

describe("pack activation — the packs themselves", () => {
  it("names the two shipped packs", () => {
    // Identity, not shape: a copy would satisfy a shape check while drifting
    // from the pack the CI freshness gate actually measures.
    expect(ACTIVE_MARKET_PACKS.macroPack).toBe(INDIA_MACRO_PACK);
    expect(ACTIVE_MARKET_PACKS.betaPack).toBe(INDIA_EQUITY_BETA_PACK);
  });

  it("resolves today's date in the format the staleness checks parse", () => {
    const asOf = analysisAsOfToday();
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The mechanism keys off this being real wall-clock rather than a pinned
    // constant, which would make the packs look permanently fresh. So assert
    // it agrees with the clock, not with a literal.
    expect(asOf).toBe(new Date().toISOString().slice(0, 10));
  });

  it("earns sourced macro tiers at today's date", () => {
    // The claim activation actually makes, and it is time-dependent: it holds
    // while the pinned observations are inside their windows.
    // `npm run lint:pack-freshness` fails in CI before they lapse, so this
    // failing means that gate was ignored, not that the test is brittle.
    const resolution = resolveMacroPack(ACTIVE_MARKET_PACKS.macroPack, analysisAsOfToday());
    expect(resolution.riskFreeRate.status).toBe("usable");
    expect(resolution.equityRiskPremium.status).toBe("usable");
  });

  it("resolves a regressed beta for a registry ticker at today's date", () => {
    const beta = resolveEquityBeta(ACTIVE_MARKET_PACKS.betaPack, "TCS", {
      analysisAsOf: analysisAsOfToday(),
    });
    expect(beta.status).toBe("usable");
  });

  it("moves ke away from the unpinned derivation", () => {
    // Non-vacuity for the census: if supplying the packs changed nothing,
    // every "must supply the packs" assertion would assert nothing.
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services", ticker: "TCS" };
    const pinned = resolveCostOfCapitalFromConfig({
      config,
      ...ACTIVE_MARKET_PACKS,
      analysisAsOf: analysisAsOfToday(),
    }).ke;
    const unpinned = resolveCostOfCapitalFromConfig({ config }).ke;
    expect(Math.abs(pinned - unpinned)).toBeGreaterThan(0.001);
  });

  it("falls back to the sector prior for an issuer outside the pack", () => {
    // A manual upload gets an arbitrary company id, so this is reachable and
    // has to degrade rather than throw.
    const config: EngineConfig = { ...DEFAULT_CONFIG, ticker: "NOT-IN-PACK" };
    const result = resolveCostOfCapitalFromConfig({
      config,
      ...ACTIVE_MARKET_PACKS,
      analysisAsOf: analysisAsOfToday(),
    });
    expect(result.assumptions?.beta.tier).toBe("prior");
    // rf and ERP still come from the pack, so one missing constituent does not
    // throw the run back to fully undated inputs.
    expect(result.assumptions?.riskFreeRate.tier).toBe("sourced");
  });
});

describe("pack activation — the call-site census", () => {
  it("classifies the parse it depends on", () => {
    // Guards the machinery, not the wiring. Every assertion below reads
    // `mode`, so a parse that silently found nothing — a `typescript` import
    // that resolved oddly, a walk rooted wrong — would make all of them pass
    // vacuously. Assert instead that the classifier separates a call that
    // supplies the packs from one that does not, on a file known to hold both.
    const dashboard = callSitesIn("src/components/dashboard/DashboardView.tsx");
    expect(dashboard.length).toBeGreaterThanOrEqual(2);
    expect(dashboard.every((call) => call.mode === "active")).toBe(true);
    expect(callSitesIn("src/engine/pipeline.ts").every((call) => call.mode === "none")).toBe(true);
  });

  it.each(SUPPLIES_PACKS)("%s supplies the active packs at every call", (path) => {
    const calls = callSitesIn(path);
    // A file that resolved nothing would otherwise pass by having no calls to
    // check, which is how a surface silently leaves this list.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.mode !== "active").map(describeCall)).toEqual([]);
  });

  it.each(SUPPLIES_PACKS)("%s dates every call it supplies packs to", (path) => {
    // The second half of activation, and the half the census used to miss. A
    // call can name `ACTIVE_MARKET_PACKS`, satisfy every assertion above, and
    // still resolve `sourced` forever: both resolvers gate their age checks on
    // `analysisAsOf` being truthy, so an undated call skips staleness *and*
    // look-ahead. That is worse than omitting the packs, because omitting them
    // yields a visibly undated `prior` tier while this yields a confident
    // `sourced` tier on an observation that lapsed months ago.
    const calls = callSitesIn(path);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => !call.dated).map(describeUndated)).toEqual([]);
  });

  it("does not accept a date that is only nominally there", () => {
    // `analysisAsOf: undefined` supplies the property and supplies no date, and
    // the two are indistinguishable downstream: both resolvers gate on
    // truthiness, so the falsy value takes the same branch as the missing one.
    // A name-only check would call this dated and let it through, which is the
    // #45 mistake — satisfying the guard on the strength of the spelling.
    const dated = (snippet: string): boolean => {
      const calls = callSitesInSource("fixture.ts", snippet);
      expect(calls).toHaveLength(1);
      return calls[0]!.dated;
    };
    const call = (asOf: string): string =>
      `buildValuationCommandCenter({ ...ACTIVE_MARKET_PACKS, analysisAsOf: ${asOf} });`;

    expect(dated(call("undefined"))).toBe(false);
    expect(dated(call("null"))).toBe(false);
    expect(dated(call('""'))).toBe(false);
    // Positive controls, so this test cannot pass by rejecting everything. The
    // computed forms are what the live surfaces actually use, and source cannot
    // evaluate them — taking them at face value is deliberate.
    expect(dated(call("analysisAsOfToday()"))).toBe(true);
    expect(dated(call('"2026-07-24"'))).toBe(true);
    expect(dated(call("run.metadata.asOf"))).toBe(true);
    expect(dated("buildValuationCommandCenter({ ...ACTIVE_MARKET_PACKS, analysisAsOf });")).toBe(true);
  });

  it("reports an undated call as undated", () => {
    // Non-vacuity for the assertion above: if `dated` were true for everything,
    // it would pass on all eight files while checking nothing. These two resolve
    // capital costs with no date at all — `pipeline.ts` by exemption, and the
    // audit harness for the reason KNOWN_UNPINNED records — so the checker has
    // to be able to say so.
    const pipeline = callSitesIn("src/engine/pipeline.ts");
    expect(pipeline.length).toBeGreaterThan(0);
    expect(pipeline.every((call) => !call.dated)).toBe(true);
    const harness = callSitesIn("scripts/lib/auditCompanyRun.ts");
    expect(harness.length).toBeGreaterThan(0);
    expect(harness.every((call) => !call.dated)).toBe(true);
  });

  it(`${RUN_INPUT_SITE} spreads the packs onto the run input`, () => {
    // No call to classify: this hands the packs to the executor, which is what
    // reaches a resolver. Asserting zero calls too, so that adding one here
    // fails rather than going unchecked — it would belong in SUPPLIES_PACKS.
    expect(source(RUN_INPUT_SITE)).toContain("...ACTIVE_MARKET_PACKS");
    expect(callSitesIn(RUN_INPUT_SITE)).toEqual([]);
  });

  it.each(PASSES_PACKS_THROUGH)("%s forwards the packs it was given", (path) => {
    const calls = callSitesIn(path);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.mode !== "forwarded").map(describeCall)).toEqual([]);
    // ...and does not reach for the production set itself.
    expect(source(path)).not.toContain("ACTIVE_MARKET_PACKS");
  });

  it.each(KNOWN_UNPINNED)("%s is a recorded exemption (%s)", (path) => {
    // Asserted so a fixed exemption cannot sit here looking unfixed: once one
    // of these starts supplying packs, move it to the list that says so.
    const calls = callSitesIn(path);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.mode !== "none").map(describeCall)).toEqual([]);
  });

  it("finds no capital-cost resolution outside the three lists", () => {
    // Derived from the tree rather than trusting the lists above to be
    // current. Test files are excluded: a spec asserting the pack-less
    // behaviour is the contract working, not a call site that forgot.
    const accounted = new Set<string>([
      ...SUPPLIES_PACKS,
      ...PASSES_PACKS_THROUGH,
      ...KNOWN_UNPINNED.map(([path]) => path),
    ]);

    const unaccounted: string[] = [];
    // `scripts` is in scope deliberately: the CLI audit harness resolves a
    // capital cost and reports a rigor level from it, and an earlier draft of
    // this census walked only `src`, which is exactly why that file went
    // unnoticed. A guard that cannot see a call site is not a guard.
    for (const root of ["src/app", "src/components", "src/engine", "scripts"]) {
      for (const file of walk(root)) {
        if (/__tests__|\.spec\.|\.test\./.test(file)) continue;
        if (accounted.has(file)) continue;
        // Note what no longer needs exempting: `costOfCapital/resolver.ts` and
        // `activePacks.ts` had to be listed while this matched text, because a
        // function declaration and a doc-comment example read the same as a
        // call. Parsing tells them apart.
        if (callSitesIn(file).length > 0) unaccounted.push(file);
      }
    }

    // Named rather than counted: the failure has to say which file, so the
    // reviewer can decide which of the three lists it belongs in.
    expect(unaccounted).toEqual([]);
  });
});

/** Depth-first walk of a repo-relative directory, returning repo-relative paths. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(`../../../../${dir}`, import.meta.url), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(next));
    else if (/\.tsx?$/.test(entry.name)) out.push(next);
  }
  return out;
}
