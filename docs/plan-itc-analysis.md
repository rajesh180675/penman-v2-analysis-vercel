# Penman V2 — ITC Analysis Plan

## Current State Assessment

### Data Pipeline
- **3 Capitaline files** (BS, PL, CF) parsed successfully into ~3,200+ unique metric keys per period × 15 years
- **Parser** handles Angular HTML via 4 strategies — confirmed working
- **Mapping spec** (`mappingSpec.ts`) covers ~200 canonical Penman labels → ~6% of available keys
- **Recast engine** converts mapped metrics into standardized BS/IS/CF statements
- **Rigor gates** check identity/sanity before allowing valuation

### Identified Issues (Prioritized)

| # | Issue | Severity | Area | Fix |
|---|-------|----------|------|-----|
| 1 | **Mapping coverage ~6%** — 3,234 keys parsed, ~200 mapped | HIGH | mappingSpec.ts | Add missing Capitaline labels to mapping |
| 2 | **No segment-level mapping** — SegmentFinance_.xls data ignored | MEDIUM | engine | No segment-aware valuation in engine |
| 3 | **Mixed scoped/unscoped keys** in fixture | MEDIUM | parser/mapping | ~50% of keys lack statement scope |
| 4 | **Sign conventions inconsistent** — capex/dividends +/varies | LOW | parser | Normalize signs per Capitaline convention |
| 5 | **Cash Flow granularity** — detailed CF works with existing parser | LOW | none | Already detailed (1,298 cells) |
| 6 | **ITC Hotels demerger** — FY2025 structural event not handled | MEDIUM | engine | Need proforma restatement module |
| 7 | **SOTP for conglomerates** — ITC has 5 segments, single valuation | MEDIUM | engine | Multi-terminal valuation architecture |

## Phase Plan

### Phase 1: Map More Labels (Immediate)
**Goal**: Increase mapping coverage from ~200 to ~500 canonical labels
- Audit current 3,234 keys for which are valuation-critical but unmapped
- Add to `mappingSpec.ts` missing BS/IS labels (segment revenue, expense detail)
- Add missing CF labels (investment purchases/sales, debt details)
- Verify with `npm run test:golden` that ITC still passes

### Phase 2: Sign Normalization (Short)
**Goal**: Consistent sign conventions
- Capitaline outputs capex/dividends as positive → recast expects negative
- Add sign-flip logic in `pickOneWithSource()` or mapping spec
- Test with VST/NETCASH fixtures

### Phase 3: Segment Data Pipeline (Medium)
**Goal**: Consume SegmentFinance_ files
- Recognize "segment" filenames → `SegmentData` output type
- Map segment labels to canonical segment names (FMCG-Cigarettes, FMCG-Other, etc.)
- Store alongside company data for SOTP

### Phase 4: Conglomerate Valuation (Long)
**Goal**: SOTP for ITC
- `buildBusinessModelProfile` → `conglomerate-capital-allocator` classification
- Segment-specific terminal growth, fade rates, margins
- Conglomerate discount (15-25%)

## Success Criteria
- [ ] Mapping coverage >15% of 3,234 keys
- [ ] All cash flow metrics mapped and sign-consistent
- [ ] ITC passes `structurally-reconciled` gate
- [ ] Segment data pipeline reads SegmentFinance files
- [ ] First-pass SOTP valuation on ITC
