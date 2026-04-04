# Persistence-Led Scenario Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scenario probability weighting and report surfaces explicitly persistence-led so scenario interpretation is driven by business-model durability instead of mostly static presets and manual UI inputs.

**Architecture:** Keep `forecastingEngine.ts` responsible for per-scenario construction, but move scenario probability and scenario spread policy into typed, testable policy logic that derives from `BusinessModelProfile`, driver-plan evidence weight, and terminal posture. Then update valuation/report consumers to render the new policy surfaces and use policy-derived probabilities as defaults while preserving user-editable controls where they already exist.

**Tech Stack:** TypeScript, React, Vitest, existing Penman valuation engine modules

---

## File map

- Modify: `src/engine/types.ts`
  - Add typed scenario-policy contracts and expose richer forecast-policy fields needed by UI/report consumers.
- Modify: `src/engine/forecastingEngine.ts`
  - Derive persistence-led scenario probability and spread posture alongside the existing driver-plan and terminal-economics flow.
- Modify: `src/engine/valuationCommandCenter.ts`
  - Consume scenario policy outputs instead of relying on hard-coded scenario probabilities alone.
- Modify: `src/components/ForecastReport.tsx`
  - Surface the persistence-led scenario policy and align default scenario probabilities with engine policy.
- Modify: `src/engine/__tests__/forecastingEngine.spec.ts`
  - Add scenario-policy regression coverage.
- Modify: `src/engine/__tests__/valuationCommandCenter.spec.ts`
  - Add command-center assertions for persistence-led scenario weighting.
- Create: `src/components/__tests__/ForecastReport.spec.tsx`
  - Add focused UI coverage for rendering the scenario-policy surface.

### Task 1: Add failing tests for persistence-led scenario policy

**Files:**
- Modify: `src/engine/__tests__/forecastingEngine.spec.ts`
- Modify: `src/engine/__tests__/valuationCommandCenter.spec.ts`
- Create: `src/components/__tests__/ForecastReport.spec.tsx`
- Reference: `src/engine/forecastingEngine.ts:222-333`
- Reference: `src/engine/valuationCommandCenter.ts:613-657`
- Reference: `src/components/ForecastReport.tsx:147-230`

- [ ] **Step 1: Extend the forecasting-engine spec with failing scenario-policy assertions**

```ts
it("derives persistence-led scenario probabilities and spread posture", () => {
  const data: RecastPeriod[] = [
    {
      ...mkLatest("2021-03-31"),
      ratios: {
        ...(mkLatest("2021-03-31").ratios ?? {} as Ratios),
        Sales_growth: 0.07, CoreSalesPM: 0.14, PM: 0.14, ATO: 1.28, SPREAD: 0.09, cash_conversion_ratio: 0.89, NOA_growth: 0.07, FLEV: 0.16,
      } as Ratios,
    },
    {
      ...mkLatest("2022-03-31"),
      ratios: {
        ...(mkLatest("2022-03-31").ratios ?? {} as Ratios),
        Sales_growth: 0.08, CoreSalesPM: 0.145, PM: 0.145, ATO: 1.29, SPREAD: 0.095, cash_conversion_ratio: 0.90, NOA_growth: 0.08, FLEV: 0.17,
      } as Ratios,
    },
    {
      ...mkLatest("2023-03-31"),
      ratios: {
        ...(mkLatest("2023-03-31").ratios ?? {} as Ratios),
        Sales_growth: 0.08, CoreSalesPM: 0.148, PM: 0.148, ATO: 1.30, SPREAD: 0.10, cash_conversion_ratio: 0.91, NOA_growth: 0.08, FLEV: 0.18,
      } as Ratios,
    },
    {
      ...mkLatest("2024-03-31"),
      ratios: {
        ...(mkLatest("2024-03-31").ratios ?? {} as Ratios),
        Sales_growth: 0.09, CoreSalesPM: 0.15, PM: 0.15, ATO: 1.31, SPREAD: 0.105, cash_conversion_ratio: 0.92, NOA_growth: 0.08, FLEV: 0.18,
      } as Ratios,
    },
  ];

  const businessModel = buildBusinessModelProfile(data);
  const scenario = derivePersistenceForecastScenario({
    scenarioKey: "base",
    periods: data,
    latest: data[data.length - 1],
    businessModel,
    horizon: 5,
    template: {
      normalizedGrowth: 0.08,
      terminalGrowthFloor: 0.03,
      terminalGrowthCap: 0.05,
      growthFadeAlpha: 0.82,
      marginFadeAlpha: 0.9,
      atoFadeAlpha: 0.94,
      companyEvidenceMaxWeight: 0.8,
      growthGuardrailBand: 0.03,
      marginGuardrailBand: 0.04,
      atoGuardrailBand: 0.35,
    },
    riskInputs: { ke: 0.12, kw: 0.1, riskFreeRate: 0.07 },
  });

  expect(scenario.probability).toBeGreaterThanOrEqual(0.4);
  expect(scenario.forecastPolicy?.scenarioWeighting?.base).toBeGreaterThan(scenario.forecastPolicy?.scenarioWeighting?.stress ?? 0);
  expect(scenario.forecastPolicy?.scenarioSpread).toBe("contained");
  expect(scenario.forecastPolicy?.scenarioWeightRationale?.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Extend the command-center spec with failing weighting assertions**

```ts
it("uses persistence-led scenario weighting in the command center", () => {
  const data = [
    mkPeriod(2023, 1000, 180, 130, 520, 760),
    mkPeriod(2024, 1100, 205, 150, 590, 820),
    mkPeriod(2025, 1210, 232, 172, 665, 885),
  ];

  const out = buildValuationCommandCenter({
    data,
    config: {
      ...DEFAULT_CONFIG,
      shares_outstanding: 620,
      market_price: 1,
    },
    marketData: {
      symbol: "ASIANPAINT.BSE",
      provider: "Alpha Vantage",
      fetchedAt: "2026-03-30T16:00:00.000Z",
      price: 1,
      previousClose: 1.1,
      changePct: -0.09,
      marketCap: null,
      enterpriseValue: null,
      sharesOutstanding: null,
      riskFreeRate: 0.07,
      priceAsOf: "2026-03-30T15:59:00.000Z",
      history: buildHistorySeries("2026-03-28", 1.05, 260),
    },
    analysisStatus: productionReadyStatus,
  });

  const stress = out.scenarios.find((card) => card.key === "stress");
  const base = out.scenarios.find((card) => card.key === "base");
  const bull = out.scenarios.find((card) => card.key === "bull");

  expect(base?.scenario.probability ?? 0).toBeGreaterThan(stress?.scenario.probability ?? 0);
  expect(base?.scenario.probability ?? 0).toBeGreaterThan(bull?.scenario.probability ?? 0);
  expect(base?.forecastPolicy?.scenarioSpread).toBeDefined();
  expect((base?.forecastPolicy?.scenarioWeightRationale ?? []).length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Add a failing report UI spec for the policy surface**

```ts
import { render, screen } from "@testing-library/react";
import ForecastReport from "../ForecastReport";
import { DEFAULT_CONFIG } from "../../engine/types";

it("renders persistence-led scenario policy guidance", () => {
  render(<ForecastReport data={makeForecastReportHistory()} config={{ ...DEFAULT_CONFIG, market_price: 100, shares_outstanding: 10 }} />);

  expect(screen.getByText(/scenario policy/i)).toBeInTheDocument();
  expect(screen.getByText(/default weighting/i)).toBeInTheDocument();
  expect(screen.getByText(/spread posture/i)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the new failing tests**

Run:
```bash
npx vitest run src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts src/components/__tests__/ForecastReport.spec.tsx
```

Expected: FAIL because `ForecastPolicySurface` does not yet expose scenario-policy fields and the report does not render the new policy block.

- [ ] **Step 5: Commit the failing tests**

```bash
git add src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts src/components/__tests__/ForecastReport.spec.tsx
git commit -m "test: add persistence-led scenario policy coverage"
```

### Task 2: Add shared scenario-policy contracts

**Files:**
- Modify: `src/engine/types.ts:423-455`
- Test: `src/engine/__tests__/forecastingEngine.spec.ts`
- Test: `src/engine/__tests__/valuationCommandCenter.spec.ts`
- Test: `src/components/__tests__/ForecastReport.spec.tsx`

- [ ] **Step 1: Add scenario-weighting and spread types**

```ts
export interface ScenarioWeightingSurface {
  stress: number;
  base: number;
  bull: number;
  historicalPanic: number;
}

export type ScenarioSpreadPosture = "contained" | "balanced" | "wide";
```

- [ ] **Step 2: Extend `ForecastPolicySurface` with scenario-policy fields**

```ts
export interface ForecastPolicySurface {
  companyEvidenceWeight?: number;
  persistenceScore?: number;
  templateGuardrailStrength?: number;
  terminalAnchorSource?: 'company-evidence'|'blended'|'template';
  workingCapitalPressure?: 'low' | 'medium' | 'high';
  reinvestmentBurden?: 'light' | 'moderate' | 'heavy';
  balanceSheetFlexibility?: 'strong' | 'adequate' | 'tight';
  operatingMode?: 'cost-bridge' | 'margin';
  terminalFadeYears?: number;
  terminalEconomicsRationale?: string[];
  scenarioWeighting?: ScenarioWeightingSurface;
  scenarioSpread?: ScenarioSpreadPosture;
  scenarioWeightRationale?: string[];
  narrative?: string[];
}
```

- [ ] **Step 3: Run tests so type failures move into implementation paths**

Run:
```bash
npx vitest run src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts src/components/__tests__/ForecastReport.spec.tsx
```

Expected: FAIL in `forecastingEngine.ts` and `ForecastReport.tsx`, not on missing exported types.

- [ ] **Step 4: Commit the shared type changes**

```bash
git add src/engine/types.ts
git commit -m "refactor: add persistence-led scenario policy contracts"
```

### Task 3: Derive persistence-led scenario weighting in the forecasting engine

**Files:**
- Modify: `src/engine/forecastingEngine.ts:222-333`
- Reference: `src/engine/forecastDriverModel.ts`
- Reference: `src/engine/terminalEconomics.ts`
- Reference: `src/engine/types.ts:423-455`
- Test: `src/engine/__tests__/forecastingEngine.spec.ts`

- [ ] **Step 1: Add a helper that derives scenario weighting and spread posture**

```ts
function buildScenarioWeighting(args: {
  scenarioKey: "stress" | "base" | "bull" | "historical-panic";
  persistenceScore: number;
  companyEvidenceWeight: number;
  workingCapitalPressure: "low" | "medium" | "high";
  reinvestmentBurden: "light" | "moderate" | "heavy";
  terminalFadeYears: number;
}): {
  probability: number;
  weighting: { stress: number; base: number; bull: number; historicalPanic: number };
  spread: "contained" | "balanced" | "wide";
  rationale: string[];
} {
  const fragilityPenalty = args.persistenceScore < 45 ? 0.08 : args.persistenceScore < 65 ? 0.03 : 0;
  const evidenceLift = args.companyEvidenceWeight >= 0.65 ? 0.05 : args.companyEvidenceWeight >= 0.45 ? 0.02 : -0.02;
  const pressurePenalty = args.workingCapitalPressure === "high" ? 0.04 : args.workingCapitalPressure === "medium" ? 0.02 : 0;
  const reinvestmentPenalty = args.reinvestmentBurden === "heavy" ? 0.04 : args.reinvestmentBurden === "moderate" ? 0.02 : 0;
  const fadeLift = args.terminalFadeYears >= 5 ? 0.03 : args.terminalFadeYears === 4 ? 0 : -0.02;

  const base = clamp(0.4 + evidenceLift + fadeLift - fragilityPenalty - pressurePenalty - reinvestmentPenalty, 0.3, 0.6);
  const stress = clamp(0.24 + fragilityPenalty + pressurePenalty + reinvestmentPenalty - evidenceLift * 0.4, 0.15, 0.4);
  const bull = clamp(0.16 + evidenceLift + fadeLift - fragilityPenalty * 0.6, 0.08, 0.28);
  const historicalPanic = clamp(1 - base - stress - bull, 0.08, 0.22);
  const total = base + stress + bull + historicalPanic;
  const weighting = {
    stress: stress / total,
    base: base / total,
    bull: bull / total,
    historicalPanic: historicalPanic / total,
  };
  const spread = weighting.base >= 0.45 && weighting.stress <= 0.25 ? "contained"
    : weighting.stress >= 0.3 || weighting.historicalPanic >= 0.18 ? "wide"
      : "balanced";

  return {
    probability: weighting[args.scenarioKey],
    weighting,
    spread,
    rationale: [
      weighting.base >= 0.45
        ? "Base weight stays elevated because persistence evidence supports a narrower outcome range."
        : "Base weight is capped because persistence evidence does not support a narrow central case.",
      args.workingCapitalPressure === "high"
        ? "Working-capital stress shifts weight toward downside scenarios."
        : "Working-capital discipline does not force extra downside weighting.",
      args.reinvestmentBurden === "heavy"
        ? "Heavy reinvestment burden widens scenario dispersion."
        : "Reinvestment burden does not materially widen scenario dispersion.",
    ],
  };
}
```

- [ ] **Step 2: Replace static per-scenario probabilities with the derived policy**

```ts
const scenarioWeighting = buildScenarioWeighting({
  scenarioKey,
  persistenceScore: businessModel.persistenceScore,
  companyEvidenceWeight: driverPlan.companyEvidenceWeight,
  workingCapitalPressure: driverPlan.workingCapitalPressure,
  reinvestmentBurden: driverPlan.reinvestmentPosture,
  terminalFadeYears: terminalEconomics.fadeYears,
});
```

```ts
return {
  name: preset.name,
  probability: scenarioWeighting.probability,
  horizonT: horizon,
  forecastPolicy: {
    companyEvidenceWeight: driverPlan.companyEvidenceWeight,
    persistenceScore: businessModel.persistenceScore,
    templateGuardrailStrength: driverPlan.templateGuardrailStrength,
    terminalAnchorSource,
    workingCapitalPressure: driverPlan.workingCapitalPressure,
    reinvestmentBurden: driverPlan.reinvestmentPosture,
    balanceSheetFlexibility: driverPlan.balanceSheetFlexibility,
    operatingMode: driverPlan.operatingMode,
    terminalFadeYears: terminalEconomics.fadeYears,
    terminalEconomicsRationale: terminalEconomics.rationale,
    scenarioWeighting: scenarioWeighting.weighting,
    scenarioSpread: scenarioWeighting.spread,
    scenarioWeightRationale: scenarioWeighting.rationale,
    narrative: buildForecastPolicyNarrative({
      persistenceScore: businessModel.persistenceScore,
      companyEvidenceWeight: driverPlan.companyEvidenceWeight,
      templateGuardrailStrength: driverPlan.templateGuardrailStrength,
      workingCapitalPressure: driverPlan.workingCapitalPressure,
      reinvestmentBurden: driverPlan.reinvestmentPosture,
      balanceSheetFlexibility: driverPlan.balanceSheetFlexibility,
      terminalAnchorSource,
      businessModel,
    }),
  },
```

- [ ] **Step 3: Keep scenario spread tied to risk spreads, not just labels**

```ts
const spreadRiskAddOn = scenarioWeighting.spread === "wide" ? 0.005 : scenarioWeighting.spread === "balanced" ? 0.0025 : 0;

const scenarioPresets = {
  stress: {
    name: "bear" as const,
    ke: riskInputs.ke + 0.02 + spreadRiskAddOn,
    kw: riskInputs.kw + 0.015 + spreadRiskAddOn,
    terminalGrowth: clamp(terminalEconomics.terminalGrowth, 0.015, 0.03),
  },
  base: {
    name: "base" as const,
    ke: riskInputs.ke,
    kw: riskInputs.kw,
    terminalGrowth: terminalEconomics.terminalGrowth,
  },
  bull: {
    name: "bull" as const,
    ke: Math.max(riskInputs.ke - (0.01 - spreadRiskAddOn * 0.5), riskInputs.riskFreeRate + 0.04),
    kw: Math.max(riskInputs.kw - (0.008 - spreadRiskAddOn * 0.4), riskInputs.riskFreeRate + 0.03),
    terminalGrowth: clamp(terminalEconomics.terminalGrowth * (scenarioWeighting.spread === "contained" ? 1.06 : 1.1), template.terminalGrowthFloor, template.terminalGrowthCap),
  },
  "historical-panic": {
    name: "bear" as const,
    ke: riskInputs.ke + 0.03 + spreadRiskAddOn,
    kw: riskInputs.kw + 0.0225 + spreadRiskAddOn,
    terminalGrowth: clamp(template.terminalGrowthFloor, 0.01, 0.025),
  },
} as const;
```

- [ ] **Step 4: Run the focused forecasting-engine spec**

Run:
```bash
npx vitest run src/engine/__tests__/forecastingEngine.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the forecasting-engine scenario-policy refactor**

```bash
git add src/engine/forecastingEngine.ts src/engine/types.ts src/engine/__tests__/forecastingEngine.spec.ts
git commit -m "feat: derive persistence-led scenario weighting"
```

### Task 4: Wire persistence-led scenario policy through the valuation command center

**Files:**
- Modify: `src/engine/valuationCommandCenter.ts:613-657`
- Test: `src/engine/__tests__/valuationCommandCenter.spec.ts`
- Reference: `src/engine/types.ts`

- [ ] **Step 1: Preserve the richer scenario object inside the command-center cards**

```ts
return {
  key,
  label: key === "stress" ? "Stress case" : key === "base" ? "Base case" : key === "bull" ? "Bull case" : "Historical panic",
  scenario: scenarioWithTerminal,
  intrinsicPerShare,
  upsidePct: intrinsicPerShare != null && marketPrice != null && marketPrice > 0 ? (intrinsicPerShare - marketPrice) / marketPrice : null,
  marginOfSafetyPct,
  expectedCagr: annualizedReturn(marketPrice, intrinsicPerShare, 3),
  valuation,
  forecastPolicy: scenarioWithTerminal.forecastPolicy,
  assumptions: {
    ke: scenarioWithTerminal.drivers.ke,
    kw: scenarioWithTerminal.drivers.kw,
    g: terminalGrowth,
```

- [ ] **Step 2: Use derived probabilities for expected value instead of duplicated local weights**

```ts
const expectedValueWeightTotal = scenarios.reduce((sum, card) => sum + card.scenario.probability, 0);
const expectedIntrinsicValue = expectedValueWeightTotal > 0
  ? scenarios.reduce((sum, card) => sum + ((card.intrinsicPerShare ?? 0) * card.scenario.probability), 0) / expectedValueWeightTotal
  : null;
```

- [ ] **Step 3: Add regression assertions for the scenario-policy payload**

```ts
const base = out.scenarios.find((card) => card.key === "base");
expect(base?.scenario.probability ?? 0).toBeGreaterThan(0.35);
expect(base?.forecastPolicy?.scenarioWeighting?.base ?? 0).toBeGreaterThan(base?.forecastPolicy?.scenarioWeighting?.stress ?? 0);
expect(base?.forecastPolicy?.scenarioSpread).toMatch(/contained|balanced|wide/);
```

- [ ] **Step 4: Run the command-center spec**

Run:
```bash
npx vitest run src/engine/__tests__/valuationCommandCenter.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the command-center integration**

```bash
git add src/engine/valuationCommandCenter.ts src/engine/__tests__/valuationCommandCenter.spec.ts
git commit -m "feat: apply persistence-led scenario policy in command center"
```

### Task 5: Surface scenario policy in the forecast report

**Files:**
- Modify: `src/components/ForecastReport.tsx:147-230`
- Create: `src/components/__tests__/ForecastReport.spec.tsx`
- Reference: `src/engine/forecastingEngine.ts`
- Reference: `src/engine/types.ts`

- [ ] **Step 1: Build the base persistence-led scenario once for report defaults**

```ts
const persistenceScenario = useMemo(() => derivePersistenceForecastScenario({
  scenarioKey: "base",
  periods: data,
  latest,
  businessModel,
  horizon,
  template: {
    normalizedGrowth: cyclicalNormalization.normalizedSalesGrowth ?? NP_SG,
    terminalGrowthFloor: 0.02,
    terminalGrowthCap: 0.05,
    growthFadeAlpha: 0.8,
    marginFadeAlpha: 0.9,
    atoFadeAlpha: 0.95,
  },
  riskInputs: { ke: ke_inp / 100, kw: kwDerived, riskFreeRate: config.risk_free_rate },
}), [data, latest, businessModel, horizon, cyclicalNormalization, NP_SG, ke_inp, kwDerived, config.risk_free_rate]);
```

- [ ] **Step 2: Align the report’s default probabilities to engine policy while preserving user overrides**

```ts
const policyWeights = persistenceScenario.forecastPolicy?.scenarioWeighting;
const [pBull, setPBull] = useState(policyWeights?.bull ?? 0.25);
const [pBase, setPBase] = useState(policyWeights?.base ?? 0.5);
const [pBear, setPBear] = useState((policyWeights?.stress ?? 0.25));
```

```ts
useEffect(() => {
  if (!policyWeights) return;
  setPBull((current) => Number.isFinite(current) ? current : policyWeights.bull);
  setPBase((current) => Number.isFinite(current) ? current : policyWeights.base);
  setPBear((current) => Number.isFinite(current) ? current : policyWeights.stress);
}, [policyWeights]);
```

- [ ] **Step 3: Render a dedicated scenario-policy card**

```tsx
<div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
  <h3 className="text-base font-bold text-slate-800 mb-2">Scenario Policy</h3>
  <div className="grid gap-2 text-sm text-slate-700">
    <div>Spread posture: <strong>{persistenceScenario.forecastPolicy?.scenarioSpread ?? "—"}</strong></div>
    <div>
      Default weighting: <strong>
        Stress {(policyWeights?.stress ?? 0).toFixed(2)} · Base {(policyWeights?.base ?? 0).toFixed(2)} · Bull {(policyWeights?.bull ?? 0).toFixed(2)} · Panic {(policyWeights?.historicalPanic ?? 0).toFixed(2)}
      </strong>
    </div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      {(persistenceScenario.forecastPolicy?.scenarioWeightRationale ?? []).join(" ")}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Add a focused component test**

```ts
it("renders persistence-led scenario policy guidance", () => {
  render(<ForecastReport data={makeForecastReportHistory()} config={{ ...DEFAULT_CONFIG, market_price: 100, shares_outstanding: 10 }} />);

  expect(screen.getByText(/scenario policy/i)).toBeInTheDocument();
  expect(screen.getByText(/spread posture/i)).toBeInTheDocument();
  expect(screen.getByText(/default weighting/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Run the report UI spec**

Run:
```bash
npx vitest run src/components/__tests__/ForecastReport.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the report surfacing**

```bash
git add src/components/ForecastReport.tsx src/components/__tests__/ForecastReport.spec.tsx
git commit -m "feat: surface persistence-led scenario policy in report"
```

### Task 6: Run the validation sweep

**Files:**
- Test: `src/engine/__tests__/forecastingEngine.spec.ts`
- Test: `src/engine/__tests__/valuationCommandCenter.spec.ts`
- Test: `src/components/__tests__/ForecastReport.spec.tsx`
- Reference: `src/components/ForecastReport.tsx`
- Reference: `src/engine/forecastingEngine.ts`
- Reference: `src/engine/valuationCommandCenter.ts`
- Reference: `src/engine/types.ts`

- [ ] **Step 1: Run the focused tranche tests**

Run:
```bash
npx vitest run src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts src/components/__tests__/ForecastReport.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:
```bash
npm run build
```

Expected: PASS with Vite build output in `dist/`.

- [ ] **Step 4: Inspect the final diff**

Run:
```bash
git diff -- src/engine/types.ts src/engine/forecastingEngine.ts src/engine/valuationCommandCenter.ts src/components/ForecastReport.tsx src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts src/components/__tests__/ForecastReport.spec.tsx
```

Expected: Shows only scenario-policy contract, engine wiring, command-center propagation, report surfacing, and related tests.

- [ ] **Step 5: Commit the validation-safe final state**

```bash
git add src/engine/types.ts src/engine/forecastingEngine.ts src/engine/valuationCommandCenter.ts src/components/ForecastReport.tsx src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts src/components/__tests__/ForecastReport.spec.tsx
git commit -m "test: validate persistence-led scenario policy tranche"
```
