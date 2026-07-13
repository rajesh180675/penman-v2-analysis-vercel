import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("production platform runtime module boundary", () => {
  it("loads under the Node tsx loader without requiring Vite-only YAML handling", () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx/esm", "-e",
      "import('./server/platform/defaultRuntime.ts').then(m => console.log(`${typeof m.createPlatformRuntime}:${typeof m.createDefaultProductionPlatformRuntime}`))",
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(output.trim()).toBe("function:function");
  });
});
