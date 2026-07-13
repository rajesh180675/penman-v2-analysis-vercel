import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupLocalAuditStorage } from "./auditLifecycle";

describe("local audit retention lifecycle", () => {
  let root: string | null = null;

  afterEach(async () => {
    delete process.env.PENMAN_DATA_DIR;
    if (root) await rm(root, { recursive: true, force: true });
    root = null;
  });

  it("removes expired artifacts and orphaned run directories", async () => {
    root = await mkdtemp(join(tmpdir(), "penman-retention-"));
    process.env.PENMAN_DATA_DIR = root;
    const now = new Date("2026-07-12T00:00:00.000Z");
    const runId = "active-run";
    await mkdir(join(root, "audit", "runs"), { recursive: true });
    await writeFile(join(root, "audit", "runs", `${runId}.json`), JSON.stringify({
      runId,
      startedAt: "2026-07-11T00:00:00.000Z",
      lastEventAt: "2026-07-11T00:00:00.000Z",
      retentionDays: 45,
    }));
    const artifactDir = join(root, "audit", "artifacts", runId);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "expired.json.gz"), Buffer.from([1, 2, 3]));
    await writeFile(join(artifactDir, "expired.json.gz.meta.json"), JSON.stringify({ uploadedAt: "2026-06-01T00:00:00.000Z", retentionDays: 30 }));

    const orphanDir = join(root, "audit", "artifacts", "orphan-run");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "orphan.bin"), "orphan");
    const old = new Date("2026-07-01T00:00:00.000Z");
    await utimes(orphanDir, old, old);

    const report = await cleanupLocalAuditStorage({ now, orphanGraceDays: 1 });

    expect(report.expiredArtifacts).toEqual([`audit/artifacts/${runId}/expired.json.gz`]);
    expect(report.orphanedDirectories).toContain("audit/artifacts/orphan-run");
    await expect(readFile(join(artifactDir, "expired.json.gz"))).rejects.toThrow();
    await expect(readFile(join(orphanDir, "orphan.bin"))).rejects.toThrow();
  });
});
