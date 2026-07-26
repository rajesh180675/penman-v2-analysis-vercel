import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("production platform runtime module boundary", () => {
  it("loads under the Node tsx loader without requiring Vite-only YAML handling", () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx/esm", "-e",
      "import('./server/platform/defaultRuntime.ts').then(m => console.log(`${typeof m.createPlatformRuntime}:${typeof m.createDefaultProductionPlatformRuntime}`))",
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(output.trim()).toBe("function:function");
    // Own timeout, not the global 5000ms. This test cold-starts a child Node
    // process and a tsx loader, so its wall time tracks machine load rather than
    // anything about the code under test: it takes ~1.7s alone and exceeded 5s
    // under `npm run test:sharded`, which runs three vitest processes at once.
    //
    // Worth the explicit number because of how that failure presented. The
    // sharded script passes `--kill-others-on-fail`, so this one timeout
    // SIGTERM'd the other two shards, which then exited non-zero with no summary
    // at all — three shards reported failing, no verdict from two of them. A real
    // failure elsewhere could hide behind that. Raising the global testTimeout
    // instead would slow down every genuine failure to accommodate one
    // subprocess test.
  }, 60_000);
});
