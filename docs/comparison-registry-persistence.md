# Comparison Registry Persistence

## Why This Change Exists

The comparison tab had already learned to show a shared trust gate and per-company trust rows, but the loaded peer registry first lived only in React memory and then only in browser-local storage. That solved same-browser reloads, but peer trust still did not roam into the shared/server-backed research surfaces already used by the rest of the workspace.

## What Changed

- added [`src/lib/companyRegistrySnapshot.ts`](../src/lib/companyRegistrySnapshot.ts) as the shared comparison-registry snapshot contract
- `src/lib/companyRegistryStore.ts` now persists a versioned local snapshot and still falls back to the legacy local-storage key
- `src/lib/sharedResearchApi.ts` now reads and writes a shared comparison-registry payload through `/api/research`
- [`api/research/index.js`](../api/research/index.js) now supports `kind: "comparison-registry"` and stores the latest shared peer snapshot in blob-backed research storage
- `src/App.tsx` now hydrates comparison state from both local storage and the shared research API, merges them safely, and only starts server sync after remote hydration has had a chance to land

The stored payload still carries the same company records the comparison view already depends on:

- company id and label
- raw data
- recast data
- traceability envelope

Traceability restoration now follows the `2026-04-traceability-v8` envelope shape rather than accepting arbitrary objects as trusted comparison state. Malformed snapshots fail closed, and malformed per-company traceability drops back to `null` instead of rehydrating a fake trust envelope.

## Validation

- [`src/lib/__tests__/companyRegistryStore.spec.ts`](../src/lib/__tests__/companyRegistryStore.spec.ts)
  - confirms round-trip persistence for a company record with recast data and v8 traceability
  - confirms legacy local-storage fallback still hydrates
  - confirms malformed snapshots fail closed
  - confirms stale/non-v8 traceability is dropped instead of trusted
  - confirms merge logic prefers richer shared peer state without discarding local records
- [`src/components/__tests__/ComparisonReport.spec.tsx`](../src/components/__tests__/ComparisonReport.spec.tsx)
  - still passes with the persisted-registry wiring in place
- `npm run typecheck`
- `npm test` (`39` files, `120` tests)
- `npm run build`

## Remaining Gap

This now solves both reload-safe local comparison state and a single shared/server-backed comparison snapshot. It still does not distinguish multiple independent workspaces or user-scoped peer sets, so the next step would be explicit workspace/user partitioning if shared comparison contexts need to coexist.
