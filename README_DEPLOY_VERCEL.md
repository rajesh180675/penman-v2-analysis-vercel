# Deploying to Vercel

This project is configured as a Vite static app and is ready for Vercel.

## What was added

- `vercel.json` with explicit:
  - `framework: "vite"`
  - `installCommand: "npm install"`
  - `buildCommand: "npm run build"`
  - `outputDirectory: "dist"`

## Deploy steps

1. Push this repository to GitHub/GitLab/Bitbucket.
2. In Vercel, click **Add New Project**.
3. Import the repository.
4. Vercel should auto-detect settings from `vercel.json`.
5. Click **Deploy**.

## Recommended Vercel project settings

- Node.js version: `22.x` (or `20.x` minimum)
- Build cache: enabled
- Optional single-file build: set env var `VITE_SINGLE_FILE=1` only if you explicitly need inlined JS/CSS output
- To persist uploaded inputs and generated outputs, add `BLOB_READ_WRITE_TOKEN`
- To protect audit reads, add `AUDIT_ADMIN_TOKEN`
- To allow scheduled monitoring, add `CRON_SECRET`
- Optional: set `AUDIT_MONITOR_ENABLED=true`
- Optional: set `AUDIT_MONITOR_LOOKBACK_LIMIT=25`
- Optional: set `AUDIT_MONITOR_STALL_MINUTES=5`
- Optional: set `AUDIT_MONITOR_ARTIFACT_GRACE_MINUTES=3`
- Optional for automatic GitHub issue creation: `GITHUB_MONITOR_REPO` and `GITHUB_MONITOR_TOKEN`
- Optional: set `VITE_AUDIT_CAPTURE_ENABLED=false` to disable capture in the browser

## Local pre-check

Run:

```bash
npm install
npm run build
```

If build succeeds locally, Vercel build should succeed with the same commands.

## Audit Capture

This app now includes server-backed audit capture for:

- uploaded input files,
- text/manual input payloads,
- analysis snapshots after processing,
- exported report artifacts (`PDF`, `ZIP`, `XLSX`).

Stored objects are written under Vercel Blob with this prefix:

```text
audit-runs/<runId>/
```

### Required environment variables

```bash
BLOB_READ_WRITE_TOKEN=...
AUDIT_ADMIN_TOKEN=choose-a-long-random-secret
CRON_SECRET=choose-another-long-random-secret
AUDIT_MONITOR_ENABLED=true
AUDIT_MONITOR_LOOKBACK_LIMIT=25
AUDIT_MONITOR_STALL_MINUTES=5
AUDIT_MONITOR_ARTIFACT_GRACE_MINUTES=3
GITHUB_MONITOR_REPO=owner/repo
GITHUB_MONITOR_TOKEN=github_pat_...
```

### Readback endpoints

- `GET /api/audit/events?runId=<runId>&kind=events`
- `GET /api/audit/events?runId=<runId>&kind=artifacts`
- `GET /api/audit/events?pathname=<full-blob-path>`
- `GET /api/audit/runs`
- `GET /api/audit/runs?runId=<runId>`
- `GET /api/audit/monitor`
- `GET /api/audit/monitor?runId=<runId>`
- `POST /api/audit/monitor`

When `AUDIT_ADMIN_TOKEN` is set, send:

```bash
x-audit-token: <AUDIT_ADMIN_TOKEN>
```

### Near real-time inspection

`/api/audit/runs` is a pollable run index.

- `GET /api/audit/runs` returns recent run IDs with input, event, and artifact counts.
- `GET /api/audit/runs?runId=<runId>` returns the latest timeline entries plus referenced input and artifact blobs for that run.
- The app now emits lifecycle events including `run-started`, `input-ingested`, `run-status-data-loaded`, `run-status-analysis-ready`, `run-status-error`, and `ui-tab-changed`.

For terminal polling, you can also run:

```bash
AUDIT_ADMIN_TOKEN=... node scripts/audit-tail.mjs https://<your-deployment-url> <runId>
```

This gives near real-time visibility, not autonomous agent execution. I can inspect these runs quickly when asked, but I do not independently monitor future executions or modify code without a new request in a live session.

## Automated Monitoring

This repo now includes a production cron monitor at `/api/cron/monitor-audit`.

- `vercel.json` schedules it once daily by default so it works on all Vercel plans.
- On Vercel Pro you can tighten the schedule to hourly or every few minutes.
- The cron route requires `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured.
- The monitor evaluates recent runs, persists a health report under `audit-monitor/reports/`, and can automatically open a GitHub issue for non-OK runs.
- Automatic issue creation is deduplicated per run under `audit-monitor/issues/<runId>.json`.

This is the closest practical substitute for autonomous oversight: your infrastructure can watch runs continuously, classify failures, and create actionable records without waiting for manual inspection.

### Security note

This feature is intentionally invasive. If you enable it in production, uploaded financial statements, derived analysis snapshots, and exported report files become persistently stored server-side. Treat Blob access and the admin token as sensitive secrets.
