# Persistence-Led Terminal Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make driver forecasting and terminal economics explicitly persistence-led so company evidence drives forecast construction inside bounded template guardrails.

**Architecture:** Extend `forecastDriverModel.ts` from a summary helper into a persistence-led planning module, then make `terminalEconomics.ts` derive terminal posture from that plan and `BusinessModelProfile`. Keep `forecastingEngine.ts` as the orchestration layer that applies scenario posture and guardrails, translates the plan into scenario driver arrays, and preserves downstream compatibility.

**Tech Stack:** TypeScript, Vitest, existing Penman valuation engine modules

---

## File map

- Modify: `src/engine/types.ts`
  - Add typed contracts for the persistence-led driver plan and richer terminal rationale.
- Modify: `src/engine/forecastDriverModel.ts`
  - Replace summary-only output with a persistence-led planning API while preserving minimal narrative compatibility.
- Modify: `src/engine/terminalEconomics.ts`
  - Make terminal economics derive from the driver plan plus business-model persistence context.
- Modify: `src/engine/forecastingEngine.ts`
  - Orchestrate the new plan + terminal pipeline inside `derivePersistenceForecastScenario`.
- Modify: `src/engine/valuationCommandCenter.ts`
  - Pass full period history into `derivePersistenceForecastScenario` after its signature expands beyond `latest` only.
- Modify: `src/engine/__tests__/forecastingEngine.spec.ts`
  - Add scenario-level regression coverage for persistence-led drivers and terminal posture.
- Create: `src/engine/__tests__/forecastDriverModel.spec.ts`
  - Add focused tests for driver-plan generation.
- Create: `src/engine/__tests__/terminalEconomics.spec.ts`
  - Add focused tests for terminal posture derivation.

### Task 1: Add failing tests for the new contracts

**Files:**
- Modify: `src/engine/__tests__/forecastingEngine.spec.ts`
- Create: `src/engine/__tests__/forecastDriverModel.spec.ts`
- Create: `src/engine/__tests__/terminalEconomics.spec.ts`
- Reference: `src/engine/forecastDriverModel.ts`
- Reference: `src/engine/terminalEconomics.ts`
- Reference: `src/engine/forecastingEngine.ts:225-436`

- [ ] **Step 1: Write the failing driver-plan test**

```ts
import { describe, expect, it } from "vitest";
import { buildBusinessModelProfile } from "../forecastingEngine";
import { buildCyclicalNormalization } from "../cyclicalNormalization";
import { buildDriverForecastModel } from "../forecastDriverModel";
import { Ratios, RecastPeriod } from "../types";

function mkPeriod(period_end: string, overrides: Partial<Ratios>): RecastPeriod {
  const base = mkLatest(period_end);
  return {
    ...base,
    ratios: {
      ...(base.ratios ?? {} as Ratios),
      Sales_growth: 0.08,
      CoreSalesPM: 0.14,
      PM: 0.14,
      ATO: 1.25,
      SPREAD: 0.08,
      cash_conversion_ratio: 0.82,
      NOA_growth: 0.09,
      FLEV: 0.2,
      ...overrides,
    } as Ratios,
  };
}

describe("buildDriverForecastModel", () => {
  it("builds a persistence-led plan that tightens fragile businesses", () => {
    const data = [
      mkPeriod("2021-03-31", { Sales_growth: 0.05, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.32, cash_conversion_ratio: 0.83, NOA_growth: 0.07, FLEV: 0.2 }),
      mkPeriod("2022-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.125, PM: 0.125, ATO: 1.31, cash_conversion_ratio: 0.81, NOA_growth: 0.08, FLEV: 0.22 }),
      mkPeriod("2023-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.13, PM: 0.13, ATO: 1.29, cash_conversion_ratio: 0.78, NOA_growth: 0.09, FLEV: 0.25 }),
      mkPeriod("2024-03-31", { Sales_growth: 0.24, CoreSalesPM: 0.24, PM: 0.24, ATO: 1.18, cash_conversion_ratio: 0.48, NOA_growth: 0.28, FLEV: 0.78 }),
    ];
    const businessModel = buildBusinessModelProfile(data);
    const normalized = buildCyclicalNormalization(data);

    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel,
      normalized,
      scenarioKey: "base",
      template: {
        normalizedGrowth: 0.09,
        terminalGrowthFloor: 0.03,
        terminalGrowthCap: 0.05,
        growthFadeAlpha: 0.8,
        marginFadeAlpha: 0.9,
        atoFadeAlpha: 0.95,
        companyEvidenceMaxWeight: 0.8,
        growthGuardrailBand: 0.035,
        marginGuardrailBand: 0.04,
        atoGuardrailBand: 0.4,
      },
    });

    expect(plan.persistenceBand).toBe("fragile");
    expect(plan.workingCapitalPressure).toBe("high");
    expect(plan.reinvestmentPosture).toBe("heavy");
    expect(plan.year1.salesGrowth).toBeLessThan(0.2);
    expect(plan.targets.salesGrowth).toBeLessThan(plan.year1.salesGrowth);
    expect(plan.targets.ato).toBeGreaterThan(plan.year1.ato);
    expect(plan.narrative.some((item) => item.toLowerCase().includes("working-capital"))).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing terminal-economics test**

```ts
import { describe, expect, it } from "vitest";
import { buildTerminalEconomics } from "../terminalEconomics";
import { buildBusinessModelProfile } from "../forecastingEngine";
import { buildCyclicalNormalization } from "../cyclicalNormalization";
import { buildDriverForecastModel } from "../forecastDriverModel";

describe("buildTerminalEconomics", () => {
  it("compresses terminal posture when persistence and reinvestment quality are weak", () => {
    const data = makeFragileHistory();
    const businessModel = buildBusinessModelProfile(data);
    const normalized = buildCyclicalNormalization(data);
    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel,
      normalized,
      scenarioKey: "base",
      template: {
        normalizedGrowth: 0.09,
        terminalGrowthFloor: 0.03,
        terminalGrowthCap: 0.05,
        growthFadeAlpha: 0.8,
        marginFadeAlpha: 0.9,
        atoFadeAlpha: 0.95,
      },
    });

    const terminal = buildTerminalEconomics({
      latest: data[data.length - 1],
      normalized,
      businessModel,
      driverPlan: plan,
      requiredReturn: 0.1,
      terminalGrowthFloor: 0.03,
      terminalGrowthCap: 0.05,
    });

    expect(terminal.competitionPressure).toBe("high");
    expect(terminal.fadeYears).toBeLessThanOrEqual(4);
    expect(terminal.terminalGrowth).toBeLessThanOrEqual(0.035);
    expect(terminal.rationale.some((item) => item.toLowerCase().includes("reinvestment"))).toBe(true);
  });
});
```

- [ ] **Step 3: Extend the existing forecasting-engine spec with failing scenario assertions**

```ts
it("keeps terminal assumptions aligned with the persistence-led driver plan", () => {
  const data = makeDurableHistory();
  const businessModel = buildBusinessModelProfile(data);
  const scenario = derivePersistenceForecastScenario({
    scenarioKey: "base",
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

  expect(scenario.forecastPolicy?.terminalAnchorSource).toBe("company-evidence");
  expect(scenario.forecastPolicy?.reinvestmentBurden).toBe("light");
  expect(scenario.forecastPolicy?.terminalFadeYears).toBeGreaterThanOrEqual(5);
  expect(scenario.forecastPolicy?.terminalEconomicsRationale?.length).toBeGreaterThan(0);
  expect(scenario.drivers.sales_growth[0]).toBeGreaterThan(scenario.drivers.sales_growth[4]);
  expect(scenario.drivers.g_terminal).toBeLessThanOrEqual(0.05);
});
```

- [ ] **Step 4: Run the new failing tests**

Run:
```bash
npx vitest run src/engine/__tests__/forecastDriverModel.spec.ts src/engine/__tests__/terminalEconomics.spec.ts src/engine/__tests__/forecastingEngine.spec.ts
```

Expected: FAIL with missing argument/type errors such as `buildDriverForecastModel` not accepting the new object input, `buildTerminalEconomics` missing `driverPlan`, and `ForecastPolicySurface` lacking the new terminal fields.

- [ ] **Step 5: Commit the failing tests**

```bash
git add src/engine/__tests__/forecastDriverModel.spec.ts src/engine/__tests__/terminalEconomics.spec.ts src/engine/__tests__/forecastingEngine.spec.ts
git commit -m "test: add persistence-led driver and terminal coverage"
```

### Task 2: Add shared types for the driver plan and terminal rationale

**Files:**
- Modify: `src/engine/types.ts:268-403`
- Test: `src/engine/__tests__/forecastDriverModel.spec.ts`
- Test: `src/engine/__tests__/terminalEconomics.spec.ts`
- Test: `src/engine/__tests__/forecastingEngine.spec.ts`

- [ ] **Step 1: Add failing type definitions to `types.ts`**

```ts
export interface PersistenceScenarioTemplate {
  normalizedGrowth: number;
  terminalGrowthFloor: number;
  terminalGrowthCap: number;
  growthFadeAlpha: number;
  marginFadeAlpha: number;
  atoFadeAlpha: number;
  companyEvidenceMaxWeight?: number;
  growthGuardrailBand?: number;
  marginGuardrailBand?: number;
  atoGuardrailBand?: number;
}

export interface DriverForecastPlan {
  persistenceBand: "durable" | "mixed" | "fragile";
  companyEvidenceWeight: number;
  templateGuardrailStrength: number;
  operatingMode: "cost-bridge" | "margin";
  workingCapitalPressure: "low" | "medium" | "high";
  reinvestmentPosture: "light" | "moderate" | "heavy";
  balanceSheetFlexibility: "strong" | "adequate" | "tight";
  year1: {
    salesGrowth: number;
    coreMargin: number;
    ato: number;
  };
  targets: {
    salesGrowth: number;
    coreMargin: number;
    ato: number;
  };
  fade: {
    growthAlpha: number;
    marginAlpha: number;
    atoAlpha: number;
  };
  capitalIntensityNarrative: string[];
  narrative: string[];
}

export interface TerminalEconomicsOutput {
  terminalRoic: number | null;
  terminalGrowth: number;
  terminalReinvestmentRate: number | null;
  fadeYears: number;
  competitionPressure: "low" | "medium" | "high";
  summary: string;
  rationale: string[];
}
```

- [ ] **Step 2: Extend `ForecastPolicySurface` to expose terminal alignment fields**

```ts
export interface ForecastPolicySurface {
  companyEvidenceWeight?: number;
  persistenceScore?: number;
  templateGuardrailStrength?: number;
  terminalAnchorSource?: "company-evidence" | "blended" | "template";
  workingCapitalPressure?: "low" | "medium" | "high";
  reinvestmentBurden?: "light" | "moderate" | "heavy";
  balanceSheetFlexibility?: "strong" | "adequate" | "tight";
  operatingMode?: "cost-bridge" | "margin";
  terminalFadeYears?: number;
  terminalEconomicsRationale?: string[];
  narrative?: string[];
}
```

- [ ] **Step 3: Run tests to confirm type layer now compiles further but still fails in implementation**

Run:
```bash
npx vitest run src/engine/__tests__/forecastDriverModel.spec.ts src/engine/__tests__/terminalEconomics.spec.ts src/engine/__tests__/forecastingEngine.spec.ts
```

Expected: FAIL in implementation paths, no longer on missing exported types.

- [ ] **Step 4: Commit the shared type changes**

```bash
git add src/engine/types.ts
git commit -m "refactor: add persistence-led forecast contracts"
```

### Task 3: Refactor the driver model into a persistence-led planning module

**Files:**
- Modify: `src/engine/forecastDriverModel.ts:1-48`
- Reference: `src/engine/cyclicalNormalization.ts:1-40`
- Reference: `src/engine/types.ts:268-403`
- Test: `src/engine/__tests__/forecastDriverModel.spec.ts`

- [ ] **Step 1: Replace the current function signature with the new planning API**

```ts
export function buildDriverForecastModel(args: {
  data: RecastPeriod[];
  latest: RecastPeriod;
  businessModel: BusinessModelProfile;
  normalized: CyclicalNormalizationOutput;
  scenarioKey: "stress" | "base" | "bull" | "historical-panic";
  template: PersistenceScenarioTemplate;
}): DriverForecastPlan {
  const { data, latest, businessModel, normalized, scenarioKey, template } = args;
  // implementation added in later steps
}
```

- [ ] **Step 2: Implement the persistence-led planning logic**

```ts
const persistenceBand = businessModel.persistenceScore >= 65 ? "durable"
  : businessModel.persistenceScore >= 45 ? "mixed"
  : "fragile";

const workingCapitalPressure = cashConversion != null && cashConversion < 0.65
  ? "high"
  : cashConversion != null && cashConversion < 0.82
    ? "medium"
    : "low";

const reinvestmentPosture = noaGrowth != null && salesGrowth != null && (
  noaGrowth > salesGrowth + 0.08
  || ((cashConversion ?? 1) < 0.55 && noaGrowth > salesGrowth + 0.02)
  || ((cashConversion ?? 1) < 0.6 && noaGrowth > 0.22)
)
  ? "heavy"
  : noaGrowth != null && salesGrowth != null && noaGrowth > salesGrowth + 0.02
    ? "moderate"
    : "light";

const companyEvidenceWeight = clamp(
  0.25
    + (businessModel.persistenceScore / 100) * 0.55
    - (workingCapitalPressure === "high" ? 0.08 : workingCapitalPressure === "medium" ? 0.03 : 0)
    - (reinvestmentPosture === "heavy" ? 0.05 : reinvestmentPosture === "moderate" ? 0.02 : 0),
  0.25,
  template.companyEvidenceMaxWeight ?? 0.8,
);
```

- [ ] **Step 3: Return the structured plan with narrative and fade coefficients**

```ts
return {
  persistenceBand,
  companyEvidenceWeight,
  templateGuardrailStrength: clamp(1 - companyEvidenceWeight, 0.2, 0.75),
  operatingMode,
  workingCapitalPressure,
  reinvestmentPosture,
  balanceSheetFlexibility,
  year1: {
    salesGrowth: growthStart,
    coreMargin: marginStart,
    ato: atoStart,
  },
  targets: {
    salesGrowth: growthTarget,
    coreMargin: marginTarget,
    ato: atoTarget,
  },
  fade: {
    growthAlpha,
    marginAlpha,
    atoAlpha,
  },
  capitalIntensityNarrative: [
    `ATO anchor ${(atoTarget * 100).toFixed(0)} bps vs latest ${(latest.ratios?.ATO ?? 0).toFixed(2)}x`,
    workingCapitalPressure === "high"
      ? "Working-capital drag is elevated and reduces persistence confidence."
      : "Working-capital drag is contained enough to avoid extra fade pressure.",
  ],
  narrative: [
    ...businessModel.evidence,
    `Scenario ${scenarioKey} starts at ${(growthStart * 100).toFixed(1)}% growth and fades toward ${(growthTarget * 100).toFixed(1)}%.`,
  ],
};
```

- [ ] **Step 4: Run the focused driver-plan test**

Run:
```bash
npx vitest run src/engine/__tests__/forecastDriverModel.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the driver-plan refactor**

```bash
git add src/engine/forecastDriverModel.ts src/engine/types.ts src/engine/__tests__/forecastDriverModel.spec.ts
git commit -m "feat: add persistence-led driver forecast planning"
```

### Task 4: Make terminal economics derive from the driver plan

**Files:**
- Modify: `src/engine/terminalEconomics.ts:1-45`
- Reference: `src/engine/forecastDriverModel.ts`
- Reference: `src/engine/types.ts`
- Test: `src/engine/__tests__/terminalEconomics.spec.ts`

- [ ] **Step 1: Replace the terminal-economics input contract**

```ts
export function buildTerminalEconomics(args: {
  latest: RecastPeriod;
  normalized: CyclicalNormalizationOutput;
  businessModel: BusinessModelProfile;
  driverPlan: DriverForecastPlan;
  requiredReturn: number;
  terminalGrowthFloor: number;
  terminalGrowthCap: number;
}) {
  const {
    latest,
    normalized,
    businessModel,
    driverPlan,
    requiredReturn,
    terminalGrowthFloor,
    terminalGrowthCap,
  } = args;
```

- [ ] **Step 2: Implement persistence-led terminal derivation**

```ts
const currentRoic = latest.ratios?.ROCE ?? latest.ratios?.RNOA ?? null;
const normalizedRoic = normalized.normalizedRoic ?? currentRoic ?? null;
const persistenceLift = driverPlan.persistenceBand === "durable" ? 0.015
  : driverPlan.persistenceBand === "mixed" ? 0.005
  : -0.01;
const reinvestmentPenalty = driverPlan.reinvestmentPosture === "heavy" ? 0.01
  : driverPlan.reinvestmentPosture === "moderate" ? 0.005
  : 0;
const workingCapitalPenalty = driverPlan.workingCapitalPressure === "high" ? 0.008
  : driverPlan.workingCapitalPressure === "medium" ? 0.003
  : 0;
const cyclicalPenalty = normalized.cyclical ? 0.01 : 0;

const terminalRoic = normalizedRoic != null
  ? Math.max(requiredReturn + 0.005, normalizedRoic + persistenceLift - reinvestmentPenalty - workingCapitalPenalty - cyclicalPenalty)
  : null;
const terminalGrowthBase = driverPlan.targets.salesGrowth * (driverPlan.persistenceBand === "durable" ? 0.55 : driverPlan.persistenceBand === "mixed" ? 0.42 : 0.3);
const terminalGrowth = clamp(terminalGrowthBase, terminalGrowthFloor, terminalGrowthCap);
const fadeYears = driverPlan.persistenceBand === "durable"
  ? (normalized.cyclical ? 6 : 5)
  : driverPlan.persistenceBand === "mixed"
    ? (normalized.cyclical ? 5 : 4)
    : (normalized.cyclical ? 4 : 3);
```

- [ ] **Step 3: Return rationale-rich output**

```ts
const rationale = [
  driverPlan.persistenceBand === "fragile"
    ? "Persistence is fragile, so excess returns compress quickly toward the cost of capital."
    : driverPlan.persistenceBand === "mixed"
      ? "Persistence is mixed, so terminal economics keep only limited credit for current excess returns."
      : "Persistence is durable enough to retain some excess returns within bounded guardrails.",
  driverPlan.reinvestmentPosture === "heavy"
    ? "Heavy reinvestment burden lowers terminal confidence."
    : "Reinvestment burden does not force extra terminal compression.",
  driverPlan.workingCapitalPressure === "high"
    ? "Weak working-capital discipline lowers terminal growth confidence."
    : "Working-capital discipline does not materially weaken terminal posture.",
];

return {
  terminalRoic,
  terminalGrowth,
  terminalReinvestmentRate: terminalRoic != null && terminalRoic > 0 ? terminalGrowth / terminalRoic : null,
  fadeYears,
  competitionPressure:
    terminalRoic == null ? "medium"
    : terminalRoic - requiredReturn > 0.05 ? "low"
    : terminalRoic - requiredReturn > 0.02 ? "medium"
    : "high",
  summary: rationale[0],
  rationale,
} satisfies TerminalEconomicsOutput;
```

- [ ] **Step 4: Run the focused terminal-economics test**

Run:
```bash
npx vitest run src/engine/__tests__/terminalEconomics.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the terminal-economics refactor**

```bash
git add src/engine/terminalEconomics.ts src/engine/__tests__/terminalEconomics.spec.ts
git commit -m "feat: derive terminal economics from persistence-led drivers"
```

### Task 5: Wire the new plan and terminal outputs through the forecasting engine

**Files:**
- Modify: `src/engine/forecastingEngine.ts:225-436`
- Modify: `src/engine/valuationCommandCenter.ts:613-645`
- Reference: `src/engine/forecastDriverModel.ts`
- Reference: `src/engine/terminalEconomics.ts`
- Reference: `src/engine/types.ts`
- Test: `src/engine/__tests__/forecastingEngine.spec.ts`
- Test: `src/engine/__tests__/valuationCommandCenter.spec.ts`

- [ ] **Step 0: Expand the scenario-derivation call sites to pass history**

```ts
const derivedScenarios = {
  stress: derivePersistenceForecastScenario({
    scenarioKey: "stress",
    periods: recastData,
    latest,
    businessModel,
    horizon,
    template: sectorTemplate,
    riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
  }),
  base: derivePersistenceForecastScenario({
    scenarioKey: "base",
    periods: recastData,
    latest,
    businessModel,
    horizon,
    template: sectorTemplate,
    riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
  }),
  bull: derivePersistenceForecastScenario({
    scenarioKey: "bull",
    periods: recastData,
    latest,
    businessModel,
    horizon,
    template: sectorTemplate,
    riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
  }),
  historicalPanic: derivePersistenceForecastScenario({
    scenarioKey: "historical-panic",
    periods: recastData,
    latest,
    businessModel,
    horizon,
    template: sectorTemplate,
    riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
  }),
};
```

Expected: Typecheck now points `derivePersistenceForecastScenario` to the new `periods` input until the function implementation is updated.

- [ ] **Step 1: Import and call the new planning modules**

```ts
import { buildDriverForecastModel } from "./forecastDriverModel";
import { buildTerminalEconomics } from "./terminalEconomics";
```

```ts
const normalized = buildCyclicalNormalization(periods);
const driverPlan = buildDriverForecastModel({
  data: periods,
  latest,
  businessModel,
  normalized,
  scenarioKey,
  template,
});
const terminalEconomics = buildTerminalEconomics({
  latest,
  normalized,
  businessModel,
  driverPlan,
  requiredReturn: riskInputs.kw,
  terminalGrowthFloor: template.terminalGrowthFloor,
  terminalGrowthCap: template.terminalGrowthCap,
});
```

- [ ] **Step 2: Replace duplicated persistence calculations with the driver plan**

```ts
const terminalAnchorSource = driverPlan.companyEvidenceWeight >= 0.65
  ? "company-evidence"
  : driverPlan.companyEvidenceWeight >= 0.45
    ? "blended"
    : "template";

return {
  name: preset.name,
  probability: preset.probability,
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

- [ ] **Step 3: Build the scenario arrays from the driver plan and terminal result**

```ts
drivers: {
  sales_growth: makeFadeArray(driverPlan.year1.salesGrowth, driverPlan.fade.growthAlpha, driverPlan.targets.salesGrowth, horizon),
  core_sales_pm: makeFadeArray(driverPlan.year1.coreMargin, driverPlan.fade.marginAlpha, driverPlan.targets.coreMargin, horizon),
  ato: makeFadeArray(driverPlan.year1.ato, driverPlan.fade.atoAlpha, driverPlan.targets.ato, horizon),
  flev: Array(horizon).fill(flevBase),
  nbc: Array(horizon).fill(nbcBase),
  g_terminal: terminalEconomics.terminalGrowth,
  ke: preset.ke,
  kw: preset.kw,
},
```

- [ ] **Step 4: Run the forecasting-engine and command-center regression suite**

Run:
```bash
npx vitest run src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the forecasting-engine integration**

```bash
git add src/engine/forecastingEngine.ts src/engine/valuationCommandCenter.ts src/engine/types.ts src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts
git commit -m "feat: wire persistence-led driver and terminal forecasting"
```

### Task 6: Run the full targeted validation sweep

**Files:**
- Test: `src/engine/__tests__/forecastDriverModel.spec.ts`
- Test: `src/engine/__tests__/terminalEconomics.spec.ts`
- Test: `src/engine/__tests__/forecastingEngine.spec.ts`
- Reference: `src/engine/__tests__/valuationCommandCenter.spec.ts`

- [ ] **Step 1: Run the focused engine tests**

Run:
```bash
npx vitest run src/engine/__tests__/forecastDriverModel.spec.ts src/engine/__tests__/terminalEconomics.spec.ts src/engine/__tests__/forecastingEngine.spec.ts src/engine/__tests__/valuationCommandCenter.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff before finalizing**

Run:
```bash
git diff -- src/engine/types.ts src/engine/forecastDriverModel.ts src/engine/terminalEconomics.ts src/engine/forecastingEngine.ts src/engine/__tests__/forecastDriverModel.spec.ts src/engine/__tests__/terminalEconomics.spec.ts src/engine/__tests__/forecastingEngine.spec.ts
```

Expected: Shows only the persistence-led contract, implementation, and test changes described above.

- [ ] **Step 4: Commit the validation-safe final state**

```bash
git add src/engine/types.ts src/engine/forecastDriverModel.ts src/engine/terminalEconomics.ts src/engine/forecastingEngine.ts src/engine/__tests__/forecastDriverModel.spec.ts src/engine/__tests__/terminalEconomics.spec.ts src/engine/__tests__/forecastingEngine.spec.ts
git commit -m "test: validate persistence-led terminal driver integration"
```
