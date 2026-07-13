import { createPlatformRuntime } from "../../server/platform/defaultRuntime";
import { cronAuthorizationMatches, runScheduledOutbox } from "../../server/platform/scheduledOperations";

export default async function handler(request: any, response: any) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).json({ error: "Method not allowed." }); return; }
  if (!cronAuthorizationMatches(request.headers?.authorization, process.env.CRON_SECRET)) { response.status(401).json({ error: "Unauthorized." }); return; }
  try {
    const { sql } = createPlatformRuntime();
    const result = await runScheduledOutbox({ sql, now: new Date().toISOString(), workerId: `vercel-${process.env.VERCEL_REGION ?? "unknown"}-${Date.now()}`, limit: Number(process.env.PLATFORM_OUTBOX_BATCH_SIZE ?? 100) });
    response.status(result.failed ? 503 : 200).json({ ok: result.failed === 0, ...result });
  } catch (error) {
    console.error("Scheduled platform outbox failed", error instanceof Error ? error.name : "UnknownError");
    response.status(503).json({ ok: false, error: "PLATFORM_OUTBOX_UNAVAILABLE" });
  }
}
