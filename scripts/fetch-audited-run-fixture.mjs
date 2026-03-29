#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const [, , baseUrl, runId, token, outputPath] = process.argv;
  if (!baseUrl || !runId || !token || !outputPath) {
    console.error("Usage: node scripts/fetch-audited-run-fixture.mjs <baseUrl> <runId> <auditToken> <outputPath>");
    process.exit(1);
  }

  const url = new URL("/api/audit/runs", baseUrl);
  url.searchParams.set("runId", runId);
  url.searchParams.set("includePayload", "1");

  const response = await fetch(url, {
    headers: {
      "x-audit-token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`Audit fetch failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const run = payload?.run ?? payload?.runs?.[0] ?? null;
  const snapshotEvent = run?.timeline?.find((event) => event.eventType === "analysis-snapshot");
  const snapshot = snapshotEvent?.payload ?? null;

  if (!snapshot?.rawData) {
    throw new Error("Run payload did not contain an analysis snapshot with rawData.");
  }

  const fixture = {
    source: "vercel-audit",
    runId,
    capturedAt: snapshotEvent?.createdAt ?? new Date().toISOString(),
    companyId: snapshot.companyId ?? run?.companyId ?? null,
    sourceMode: run?.sourceMode ?? null,
    latestPeriod: snapshot.latestPeriod ?? null,
    rawData: snapshot.rawData,
  };

  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(fixture)}\n`, "utf8");
  console.log(`Wrote audited fixture to ${resolved}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
