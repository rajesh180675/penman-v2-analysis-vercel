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
```

### Readback endpoints

- `GET /api/audit/events?runId=<runId>&kind=events`
- `GET /api/audit/events?runId=<runId>&kind=artifacts`
- `GET /api/audit/events?pathname=<full-blob-path>`
- `GET /api/audit/runs`
- `GET /api/audit/runs?runId=<runId>`

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

### Security note

This feature is intentionally invasive. If you enable it in production, uploaded financial statements, derived analysis snapshots, and exported report files become persistently stored server-side. Treat Blob access and the admin token as sensitive secrets.
