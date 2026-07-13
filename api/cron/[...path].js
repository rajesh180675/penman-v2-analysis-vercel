import monitorAudit from "./_monitor-audit.js";
import platformBackup from "./_platform-backup.ts";
import platformOutbox from "./_platform-outbox.ts";
import platformRestoreDrill from "./_platform-restore-drill.ts";
import pruneAudit from "./_prune-audit.js";

const HANDLERS = Object.freeze({
  "monitor-audit": monitorAudit,
  "platform-backup": platformBackup,
  "platform-outbox": platformOutbox,
  "platform-restore-drill": platformRestoreDrill,
  "prune-audit": pruneAudit,
});

export function resolveCronPath(request) {
  const parameter = request.query?.path;
  if (Array.isArray(parameter)) return parameter.join("/");
  if (typeof parameter === "string") return parameter.replace(/^\/+|\/+$/g, "");
  const pathname = new URL(request.url ?? "/", "https://cron.local").pathname;
  return pathname.replace(/^\/api\/cron\/?/, "").replace(/^\/+|\/+$/g, "");
}

/** Consolidated Vercel cron entrypoint; private handler modules remain independently testable. */
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const route = resolveCronPath(request);
  const selected = HANDLERS[route];
  if (!selected) {
    response.status(404).json({ error: "Cron route not found." });
    return;
  }
  await selected(request, response);
}
