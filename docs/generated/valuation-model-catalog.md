# Valuation Model Catalog

- Schema: `2026-07-model-catalog-v1`
- Catalog: `2026-07-10-current-models-v2`
- Entries: 44
- Production intrinsic/relative definitions: 21
- Independent production evidence groups: 11

| Model ID | Lifecycle | Category | Families | Independence group | Integration | Implementation |
|---|---|---|---|---|---|---|
| `advanced.credit-spread-wacc` | experimental | diagnostic | cross-family | capital-cost-diagnostic | not-wired | `src/engine/valuation/creditSpreadWacc.ts#buildWacc` |
| `advanced.esg-adjusted-ke` | experimental | diagnostic | cross-family | capital-cost-diagnostic | partially-wired | `src/engine/analysisRun/legacyExecutor.ts#executeLegacyAnalysisRun:advancedModelExecutions` |
| `advanced.fx-neutral-revenue` | experimental | diagnostic | industrial, telecom, utility | operational-driver | partially-wired | `src/engine/analysisRun/legacyExecutor.ts#executeLegacyAnalysisRun:advancedModelExecutions` |
| `advanced.lease-capitalization` | experimental | diagnostic | industrial, telecom, utility | accounting-adjustment | partially-wired | `src/engine/analysisRun/legacyExecutor.ts#executeLegacyAnalysisRun:advancedModelExecutions` |
| `advanced.peer-data-sotp` | experimental | intrinsic | industrial, telecom, utility | segment-sotp | not-wired | `src/engine/valuation/sotpValuation.ts#sotpValuation` |
| `advanced.real-options-rd-pipeline` | experimental | intrinsic | industrial, telecom, utility | optionality | wired | `src/engine/analysisRun/legacyExecutor.ts#executeLegacyAnalysisRun:advancedModelExecutions` |
| `cross-family.peer-relative` | production | relative | cross-family | peer-market | wired | `src/engine/peerRelativeValuation.ts#computePeerRelativeValuation:compositeFairValue` |
| `fi.bank.equity-residual-income` | production | intrinsic | bank, nbfc | fi-book-residual-income | wired | `src/engine/bankValuation/coreModels.ts#equityResidualIncome` |
| `fi.bank.justified-pb-gordon` | production | intrinsic | bank, nbfc | fi-book-residual-income | wired | `src/engine/bankValuation/coreModels.ts#justifiedPBGordon` |
| `fi.bank.relative-multiples` | experimental | relative | bank, nbfc | peer-market | not-wired | `src/engine/relativeValuation.ts#computeBankMultiples:impliedFairValueComposite` |
| `fi.bank.scenario-bundle` | production | aggregator | bank, nbfc | aggregation | wired | `src/engine/bankValuation/scenarios.ts#buildBankScenarioBundle` |
| `fi.bank.sustainable-ddm` | production | intrinsic | bank, nbfc | fi-distribution | wired | `src/engine/bankValuation/coreModels.ts#sustainableDDM` |
| `fi.insurance.embedded-value-vnb` | production | intrinsic | insurance | actuarial-embedded-value | wired | `src/engine/bankValuation/coreModels.ts#evBasedValuation` |
| `fi.median-triangulation` | production | aggregator | bank, nbfc, insurance | aggregation | wired | `src/engine/bankValuation/computeBankValuation.ts#computeBankValuation:triangulatedValue` |
| `fi.nbfc.p-aum` | production | relative | nbfc | fi-asset-market-multiple | wired | `src/engine/bankValuation/nbfcLenses.ts#pAumLens` |
| `fi.nbfc.roa-leverage-residual-income` | production | intrinsic | nbfc | fi-book-residual-income | wired | `src/engine/bankValuation/nbfcLenses.ts#roaLeverageRI` |
| `fi.segment-sotp` | experimental | intrinsic | bank, nbfc, insurance | segment-sotp | not-wired | `src/engine/bankValuation/sotp.ts#buildBankSOTP` |
| `industrial.cash-statement-fcff-dcf` | production | intrinsic | industrial, telecom, utility | cash-statement | wired | `src/engine/cashFlowDcf.ts#computeCashFlowDcf` |
| `industrial.clean-surplus-check` | production | diagnostic | industrial, telecom, utility | accounting-quality | wired | `src/engine/valuation/cleanSurplus.ts#checkCleanSurplus` |
| `industrial.damodaran-capm-cross-check` | production | diagnostic | industrial, telecom, utility | capital-cost-diagnostic | wired | `src/engine/valuation/damodaranCapm.ts#capmKe` |
| `industrial.ev-ebitda-peer` | production | relative | industrial, telecom, utility | peer-market | wired | `src/engine/evEbitdaCrossCheck.ts#computeEvEbitdaCrossCheck:equityFromMedian` |
| `industrial.evidence-weighted-synthesis` | production | aggregator | industrial, telecom, utility | aggregation | wired | `src/engine/valuationEvidence/evidenceWeightedSynthesis.ts#buildEvidenceWeightedSynthesis` |
| `industrial.graham-dodd-epv` | production | intrinsic | industrial, telecom, utility | earnings-power | wired | `src/engine/grahamDoddEPV.ts#computeEPV` |
| `industrial.historical-relative-multiples` | production | relative | industrial, telecom, utility | peer-market | wired | `src/engine/relativeValuation.ts#computeIndustrialMultiples:impliedFairValueComposite` |
| `industrial.loss-maker-profitability-path` | production | diagnostic | industrial, telecom, utility | operational-driver | wired | `src/engine/lossMakerValuation.ts#computeLossMakerValuation:profitabilityPath` |
| `industrial.loss-maker-revenue-multiple` | production | relative | industrial, telecom, utility | peer-market | wired | `src/engine/lossMakerValuation.ts#computeLossMakerValuation:revenueMultiple.perShareValue` |
| `industrial.loss-maker-reverse-dcf` | production | market-implied | industrial, telecom, utility | market-price | wired | `src/engine/lossMakerValuation.ts#computeLossMakerValuation:reverseDCF` |
| `industrial.owner-earnings-dcf` | production | intrinsic | industrial, telecom, utility | owner-earnings-cash | wired | `src/engine/valuationCommandCenter/solvers.ts#computeOwnerEarningsDcf` |
| `industrial.penman.aeg-cross-check` | production | diagnostic | industrial, telecom, utility | accrual-residual-income | wired | `src/engine/PenmanNissimEngine.ts#computeValuation:aeg.V_AEG` |
| `industrial.penman.ddm-cross-check` | production | diagnostic | industrial, telecom, utility | accrual-residual-income | wired | `src/engine/PenmanNissimEngine.ts#computeValuation:perShare.intrinsic_ddm_per_share` |
| `industrial.penman.fcfe-cross-check` | production | diagnostic | industrial, telecom, utility | accrual-residual-income | wired | `src/engine/PenmanNissimEngine.ts#computeValuation:fcf.V_FCFE` |
| `industrial.penman.fcff-cross-check` | production | diagnostic | industrial, telecom, utility | accrual-residual-income | wired | `src/engine/PenmanNissimEngine.ts#computeValuation:fcf.EV_FCFF` |
| `industrial.penman.residual-income` | production | intrinsic | industrial, telecom, utility | accrual-residual-income | wired | `src/engine/PenmanNissimEngine.ts#computeValuation:V_RE_CV3` |
| `industrial.penman.residual-operating-income` | production | intrinsic | industrial, telecom, utility | accrual-residual-income | wired | `src/engine/PenmanNissimEngine.ts#computeValuation:V_ReOI_CV03` |
| `industrial.reverse-dcf` | production | market-implied | industrial, telecom, utility | market-price | wired | `src/engine/reverseDCF.ts#computeReverseDCF` |
| `industrial.reverse-dcf-monte-carlo` | production | market-implied | industrial, telecom, utility | market-price | wired | `src/engine/valuation/reverseDcfMonteCarlo.ts#runReverseDcfMonteCarlo` |
| `industrial.scenario-headline` | production | aggregator | industrial, telecom, utility | aggregation | wired | `src/engine/valuationCommandCenter/helpers.ts#computeScenarioIntrinsicPerShare` |
| `industrial.segment-sotp` | production | intrinsic | industrial, telecom, utility | segment-sotp | wired | `src/engine/sotpValuation.ts#buildSOTPValuation` |
| `industrial.working-capital-gate` | production | diagnostic | industrial, telecom, utility | operational-driver | wired | `src/engine/valuation/workingCapitalGate.ts#evaluateWorkingCapitalGate` |
| `sector.cyclical.mid-cycle-fcff` | production | intrinsic | industrial | operational-driver | partially-wired | `src/engine/sectorCases/calculators.ts#executeSectorCase:cyclical-mid-cycle` |
| `sector.nbfc.funding-justified-pb` | production | intrinsic | nbfc | fi-book-residual-income | partially-wired | `src/engine/sectorCases/calculators.ts#executeSectorCase:nbfc-funding` |
| `sector.retail.unit-economics-fcff` | production | intrinsic | industrial | operational-driver | partially-wired | `src/engine/sectorCases/calculators.ts#executeSectorCase:retail-unit-economics` |
| `sector.telecom.subscriber-fcff` | production | intrinsic | telecom | operational-driver | partially-wired | `src/engine/sectorCases/calculators.ts#executeSectorCase:telecom-network` |
| `sector.utility.rab-ddm` | production | intrinsic | utility | operational-driver | partially-wired | `src/engine/sectorCases/calculators.ts#executeSectorCase:utility-rab` |

> Counts come from explicit finite computed results at runtime. Catalog presence, applicability, and strategy labels never count as computation.
