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

## Local pre-check

Run:

```bash
npm install
npm run build
```

If build succeeds locally, Vercel build should succeed with the same commands.