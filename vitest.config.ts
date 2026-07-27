import { realpathSync } from "fs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = realpathSync.native(__dirname);

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      "@": resolve(projectRoot, "src"),
    },
  },
  test: {
    // `node`, not `jsdom`. Standing up a jsdom document per file dominated the
    // clock on a suite that is overwhelmingly pure computation: `environment` was
    // 138s of one shard's 188s and 446s of another's 835s, and 238 of the 258
    // runnable specs never touch a DOM.
    //
    // The 20 that do are marked `@vitest-environment jsdom` in their own
    // docblocks, which override this default (as do the 11 that already carried
    // that marker, and 4 explicit `node` ones). The list was not derived by
    // grepping for `document`/`window` — that both over- and under-matches, since
    // it hits the word "window" in prose and misses DOM use inside a spec's
    // import graph. It came from running every directory under `--environment
    // node` and marking exactly what failed.
    //
    // A new spec now defaults to node. One that needs a DOM fails loudly on
    // `document is not defined` and wants the docblock, which is the right
    // failure mode: explicit rather than silently slow.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // Real-company Capitaline fixtures can spend >60s in beforeAll under full
    // fork contention on Windows even though the isolated suite is healthy.
    // Keep the hook timeout above the observed worst case so validation is not
    // flaky while still bounding genuinely stuck hooks.
    hookTimeout: 120_000,
    exclude: [
      "node_modules",
      "e2e",
      // Worktree checkouts under .claude/worktrees/ shadow the live src/
      // tree; vitest would otherwise pick up stale fixtures from old
      // branches and flag them as failures even when src/ is green.
      ".claude/**",
      // Hermes plans/scratch files are agent workspace artifacts, not test inputs.
      ".hermes/**",
      // Audit-all-companies specs run the full pipeline against every
      // registry company. They're heavy (40+ minutes serial), can OOM
      // workers, and are gated behind the `test:audit` npm script.
      // Skip them unless the CLI explicitly names an audit shard
      // (the spec must appear in process.argv to opt back in).
      ...(process.argv.some((a) => /audit-all-companies/.test(a))
        ? []
        : ["src/engine/__tests__/audit-all-companies*.spec.ts"]),
      // The real TCS snapshot budget check parses a full Capitaline ZIP and
      // runs the complete pipeline (~80s on Windows). Keep it as an explicit
      // validation gate without charging every ordinary `npm test` run.
      ...(process.argv.some((a) => /auditSnapshotTransport\.integration/.test(a))
        ? []
        : ["src/lib/__tests__/auditSnapshotTransport.integration.spec.ts"]),
    ],
    pool: "forks",
    maxWorkers: 2,
    // Audit shards run 10 heavy pipeline+valuation cycles per fork and
    // OOM the default Node heap (~2GB on Win32). 8GB cleared all shards
    // in local testing including the auditCompanyRun spec (6 tests, each
    // parsing full Capitaline ZIPs with pipeline + valuation).
    forks: {
    execArgv: ["--max-old-space-size=8192", "--expose-gc"],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/engine/**/*.ts", "src/lib/**/*.ts"],
      exclude: [
        "src/engine/__tests__/**",
        "src/engine/__fixtures__/**",
        "src/engine/goldenCompanySuite.ts",
        "src/**/*.spec.ts",
        "src/**/*.spec.tsx",
      ],
      // Conservative initial thresholds — tighten as coverage improves
      thresholds: {
        lines: 40,
        functions: 35,
        branches: 30,
        statements: 40,
      },
    },
  },
});
