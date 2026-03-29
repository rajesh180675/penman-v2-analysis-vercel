const [, , baseUrlArg, runIdArg] = process.argv;

if (!baseUrlArg) {
  console.error("Usage: node scripts/audit-tail.mjs <baseUrl> [runId]");
  process.exit(1);
}

const token = process.env.AUDIT_ADMIN_TOKEN;
if (!token) {
  console.error("Set AUDIT_ADMIN_TOKEN in the environment before running this script.");
  process.exit(1);
}

const baseUrl = baseUrlArg.replace(/\/$/, "");
const seen = new Set();

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "x-audit-token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function poll() {
  const pathname = runIdArg
    ? `/api/audit/runs?runId=${encodeURIComponent(runIdArg)}`
    : "/api/audit/runs";
  const payload = await fetchJson(pathname);

  if (!runIdArg) {
    console.clear();
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
  const ordered = [...timeline].reverse();
  for (const item of ordered) {
    const key = `${item.pathname}:${item.createdAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      JSON.stringify(
        {
          at: item.createdAt,
          eventType: item.eventType,
          payloadSummary: item.payloadSummary,
        },
        null,
        2
      )
    );
  }
}

await poll();
setInterval(() => {
  void poll().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
  });
}, 5000);
