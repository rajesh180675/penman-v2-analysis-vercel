# Comparison Registry Persistence

## Why This Change Exists

The comparison tab had already learned to show a shared trust gate and per-company trust rows, but the loaded peer registry still lived only in React memory. A reload erased the comparison set, which meant the peer trust surface did not survive the same local workspace/session flows the rest of the product already persisted.

## What Changed

- added [`src/lib/companyRegistryStore.ts`](../src/lib/companyRegistryStore.ts) as a dedicated local-storage helper for the multi-company registry
- `src/App.tsx` now hydrates the registry from that store on startup
- `src/App.tsx` now persists registry updates whenever loaded company state changes

The stored payload carries the same company records the comparison view already depends on:

- company id and label
- raw data
- recast data
- traceability envelope

Malformed or incomplete storage payloads fail closed back to an empty registry instead of partially hydrating broken peer state.

## Validation

- [`src/lib/__tests__/companyRegistryStore.spec.ts`](../src/lib/__tests__/companyRegistryStore.spec.ts)
  - confirms round-trip persistence for a company record with recast data and traceability
  - confirms malformed or incomplete payloads hydrate as an empty registry
- [`src/components/__tests__/ComparisonReport.spec.tsx`](../src/components/__tests__/ComparisonReport.spec.tsx)
  - still passes with the persisted-registry wiring in place

## Remaining Gap

This solves reload-safe local comparison state. It does not yet persist comparison context into the shared research API, so peer trust still does not roam across machines or external shared-workspace consumers.
