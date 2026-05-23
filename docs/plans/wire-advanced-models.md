# Plan: Wire Advanced Models into Dashboard

## Context
8 engine modules exist but aren't called from the UI. They need to be:
1. Computed in DashboardView (or a hook)
2. Displayed in new/existing panels

## Tasks

### Task 1: Create `useAdvancedModels` hook
- File: `src/hooks/useAdvancedModels.ts`
- Imports all 8 engines, calls them with recast data + config
- Returns computed results (memoized)
- Inputs: data, config, segmentData, marketData, shares

### Task 2: Create `FadeRatePanel` component
- File: `src/components/dashboard/FadeRatePanel.tsx`
- Shows: ω estimate, confidence, structural break, margin vs turnover persistence
- Visual: persistence bar, competitive advantage label, industry prior comparison

### Task 3: Create `PenmanExpectedReturnPanel` component
- File: `src/components/dashboard/PenmanExpectedReturnPanel.tsx`
- Shows: expected return %, verdict badge, EPV layers breakdown
- Visual: layered bar chart (asset value / EPV / growth premium / market price)

### Task 4: Create `ReverseDCFPanel` component
- File: `src/components/dashboard/ReverseDCFPanel.tsx`
- Shows: implied growth/RNOA/fade, CAP years, sensitivity table
- Visual: price decomposition pie, implied vs historical comparison

### Task 5: Create `AdvancedSegmentPanel` component
- File: `src/components/dashboard/AdvancedSegmentPanel.tsx`
- Shows: segment RNOA quadrant map, lifecycle badges, capital allocation verdict
- Visual: 2x2 quadrant scatter, conglomerate discount bar

### Task 6: Wire hook into DashboardView
- Edit: `src/components/dashboard/DashboardView.tsx`
- Import useAdvancedModels, pass data/config/segments/market
- Render new panels in appropriate sections
- Gate panels behind data availability (show only when inputs exist)
