# Session Handoff — Business-Model Realism / Persistence Work

Date: 2026-04-03

## Resume point

The current implementation has completed the **first major tranche** of the approved business-model realism plan.

The latest code push before this handoff was:
- `417bfc4` — `Add persistence-aware business model evidence to valuation signals`

If resuming next session, start from this file and the approved planning direction focused on:
- business-model realism
- persistence judgment
- reducing dependence on single-period ratio spikes
- eventually moving from template-led valuation to company-evidence-led valuation

## What is now implemented

### 1. Business-model evidence layer exists in the valuation command center

Implemented in:
- `src/engine/valuationCommandCenter.ts`

Added a `businessModel` profile with:
- `persistenceScore`
- `demandStabilityScore`
- `marginDurabilityScore`
- `capitalIntensityScore`
- `workingCapitalDisciplineScore`
- `reinvestmentQualityScore`
- `historicalAnchors`
- `evidence[]`

This is based on recast historical data rather than only the latest period.

### 2. One-period spike protection is now active

The base scenario no longer blindly trusts the latest period.

Scenario anchors now blend:
- latest period metrics
- multi-year historical anchors
- persistence-sensitive fade behavior

This was specifically added so a one-year margin/growth spike does not automatically get treated as durable economics.

### 3. Persistence now affects valuation discipline

Still in:
- `src/engine/valuationCommandCenter.ts`

Persistence weakness now:
- widens required margin of safety
- lowers terminal growth normalization
- accelerates fade behavior
- caps aggressive conviction / signal escalation

### 4. UI surfaces now expose the persistence layer

Implemented in:
- `src/components/ValuationReport.tsx`
- `src/components/ValuationWorkbench.tsx`
- `src/lib/researchWorkspace.ts`

The valuation report now shows:
- persistence score
- business-model realism section
- historical anchors
- evidence strings explaining why persistence is capped or supported

Workspace persistence now stores the new fields as well.

### 5. Focused regression tests were added

Implemented in:
- `src/engine/__tests__/valuationCommandCenter.spec.ts`

Added coverage for:
- one-period spike should not dominate valuation assumptions
- weak persistence should cap conviction even if headline upside looks attractive

## Verification already completed successfully

These passed after implementation:
- `npm run typecheck`
- `npx vitest run src/engine/__tests__/valuationCommandCenter.spec.ts`
- `npx vitest run src/engine/__tests__/analysisStatus.spec.ts src/engine/__tests__/excelExport.spec.ts`
- `npm run test:golden`
- `npm run build`

## Honest status vs approved plan

The work is **not the full plan yet**.

Best estimate of completion against the approved roadmap:
- **~35–45% complete**

What is done:
- initial business-model evidence layer
- persistence scoring
- persistence-aware scenario anchoring
- persistence-aware conviction caps
- UI surfacing of the first persistence layer
- focused regression tests

What is still missing:
- deeper persistence-aware forecast shaping inside `src/engine/forecastingEngine.ts`
- stronger sector-template guardrail logic in `src/engine/valuationSectorTemplates.ts`
- explicit persistence integration into `src/engine/analysisStatus.ts`
- explicit persistence integration into `src/engine/valuationPolicy.ts`
- broader golden / release test expansion around persistence cases
- full UI explanation across every planned surface

## Exact next recommended implementation order

### Next tranche (recommended order)

#### Step 1 — Move persistence logic deeper into forecasting

Primary file:
- `src/engine/forecastingEngine.ts`

Goal:
- stop keeping most persistence logic only in command-center scenario shaping
- make forecast construction itself persistence-aware

Specifically:
- use business-model evidence to shape driver paths more directly
- reduce dependence on generic ratio fades
- connect reinvestment, working-capital drag, and margin persistence more tightly

#### Step 2 — Reduce sector-template dominance

Primary files:
- `src/engine/valuationSectorTemplates.ts`
- `src/engine/valuationCommandCenter.ts`

Goal:
- templates should be guardrails and priors, not the full thesis

Specifically:
- keep template caps/floors
- let company-specific evidence dominate within those bounds
- add clearer persistence-related template constraints

#### Step 3 — Wire persistence into trust/status policy

Primary files:
- `src/engine/analysisStatus.ts`
- `src/engine/valuationPolicy.ts`

Goal:
- confidence should reflect not only accounting contamination but also business-model fragility where appropriate

This should be done carefully so persistence uncertainty does not get conflated with parser failure.

#### Step 4 — Expand regression / release discipline

Primary files:
- `src/engine/__tests__/goldenCompanySuite.spec.ts`
- `src/engine/__tests__/releaseGate.spec.ts`
- optionally more focused test fixtures if needed

Goal:
- prove persistence-sensitive cases stay conservative
- keep aggressive labels intentionally rare

## Important caution for next session

Do **not** claim institution-grade completion yet.

Current state is better than before, but still transitional:
- accounting/recast backbone is strong
- persistence logic has begun
- forecasting architecture is still not fully company-evidence-led

So next session should continue from this exact point rather than starting a new redesign.

## Files most important to read first next session

1. `docs/session-handoff-business-model-persistence.md`
2. `src/engine/valuationCommandCenter.ts`
3. `src/engine/__tests__/valuationCommandCenter.spec.ts`
4. `src/components/ValuationReport.tsx`
5. `src/components/ValuationWorkbench.tsx`
6. `src/lib/researchWorkspace.ts`
7. `src/engine/forecastingEngine.ts`
8. `src/engine/valuationSectorTemplates.ts`

## Short resume instruction

If continuing next session, the correct prompt is effectively:

> Continue the approved business-model realism / persistence roadmap from the current first-tranche implementation. Next, move persistence-aware business logic into forecasting, reduce sector-template dominance, and then integrate persistence into trust/status policy without conflating it with parser contamination.
