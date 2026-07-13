import { requireCronAuth, runAuditMonitor } from "../audit/monitor-lib.js";

export default async function handler(request, response) {
  const start = Date.now();

  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.status(405).json({ error: "Method not allowed." });
      return;
    }

    if (!requireCronAuth(request, response)) return;

    console.log(JSON.stringify({ level: "info", msg: "cron.monitor.start", route: "/api/cron/monitor-audit" }));
    const payload = await runAuditMonitor({
      limit: typeof request.query?.limit === "string" ? Number(request.query.limit) : undefined,
    });
    response.status(200).json(payload);
    console.log(JSON.stringify({ level: "info", msg: "cron.monitor.done", route: "/api/cron/monitor-audit", ms: Date.now() - start }));
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      msg: "cron.monitor.failed",
      route: "/api/cron/monitor-audit",
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - start,
    }));
    response.status(500).json({
      error: error instanceof Error ? error.message : "Cron monitor failed.",
    });
  }
}
