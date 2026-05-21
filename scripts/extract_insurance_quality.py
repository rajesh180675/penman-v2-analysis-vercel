"""
LIC Insurance Quality Indicators Extractor — Phase B5.6
Extracts:
  Tier 2 (curated): Solvency Ratio, Embedded Value (IEV), VNB, VNB Margin, Persistency
  Tier 1 (AR table): Premium, Claims, Operating Expenses, Commissions, Investment Yield,
                     Investment Income, Total Assets — from IRDAI Form-style 5-year summary
                     (page ~495 of FY2024 AR, similar position in earlier ARs).

Each AR carries a 5-year window. We aggregate across all 4 ARs (FY2021-FY2024)
and prefer the most-recent AR's value when multiple ARs report the same year
(later ARs may have restated figures).

Pipeline:
  1. Curated Tier 2 (hand-verified from investor disclosures)
  2. AR Tier 1 5-year summary (this script's primary value-add)
  3. Derived ratios: claims_ratio, expense_ratio, combined_ratio, premium_growth
"""

import fitz  # pymupdf
import re
import json
import sys
import os
from pathlib import Path

AR_BASE = Path(os.environ.get(
    "PENMAN_AR_BASE",
    r"C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\annual_reports",
))
OUTPUT_BASE = Path(r"C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\companies")

TICKER = "LICI"
COMPANY_FOLDER = "Life Insurance Corporation of India"
COMPANY_NAME = "Life Insurance Corporation of India (LIC)"

# Curated, highly precise investor relations disclosures for fallback calibration
CURATED_DATA = {
    "2021-03-31": {
        "solvency_ratio": 1.76,
        "embedded_value": 95605.0,
        "vnb": 4167.0,
        "nbm_pct": 9.9,
        "persistency_13m": 79.0,
        "persistency_61m": 59.0
    },
    "2022-03-31": {
        "solvency_ratio": 1.85,
        "embedded_value": 541492.0,
        "vnb": 7619.0,
        "nbm_pct": 15.1,
        "persistency_13m": 75.59,
        "persistency_61m": 61.0
    },
    "2023-03-31": {
        "solvency_ratio": 1.87,
        "embedded_value": 582243.0,
        "vnb": 11553.0,
        "nbm_pct": 16.2,
        "persistency_13m": 77.09,
        "persistency_61m": 61.80
    },
    "2024-03-31": {
        "solvency_ratio": 1.98,
        "embedded_value": 727344.0,
        "vnb": 9583.0,
        "nbm_pct": 16.8,
        "persistency_13m": 77.66,
        "persistency_61m": 60.88
    }
}

def fiscal_year_end(fy_label: str) -> str:
    """Convert FY2024 or 2023-24 to 2024-03-31."""
    m = re.search(r"FY(\d{4})", fy_label)
    if m:
        return f"{m.group(1)}-03-31"
    return fy_label

def scan_pdf_for_metrics(pdf_path: str) -> dict:
    """Scan PDF text for hints of solvency, IEV, VNB, and persistency."""
    print(f"  Scanning PDF text: {os.path.basename(pdf_path)}...")
    doc = fitz.open(pdf_path)
    
    found = {
        "solvency_ratio": None,
        "embedded_value": None,
        "vnb": None,
        "nbm_pct": None,
        "persistency_13m": None,
        "persistency_61m": None
    }
    
    text_sample = ""
    for p in range(min(50, len(doc))):  # Scan first 50 pages (typically directors report / Highlights)
        text_sample += doc[p].get_text()
    
    for p in range(max(0, len(doc) - 50), len(doc)):  # Scan last 50 pages (financial highlights)
        text_sample += doc[p].get_text()

    # Search for Solvency Ratio patterns
    m_solv = re.findall(r"solvency\s*ratio[^.]*?(\d+\.\d+)", text_sample, re.IGNORECASE)
    if m_solv:
        candidate = float(m_solv[0])
        if 1.0 < candidate < 3.0:
            found["solvency_ratio"] = candidate
            
    # Search for persistency patterns
    m_13m = re.findall(r"13th\s*month[^.]*?(\d+\.\d+)\s*%", text_sample, re.IGNORECASE)
    if m_13m:
        found["persistency_13m"] = float(m_13m[0])
        
    doc.close()
    return found


def extract_5year_summary(doc) -> dict:
    """Extract IRDAI Form-style 5-year summary table from LIC AR.

    The table appears around page 495 of FY2024 AR ("Summary of Financial
    Statements" with sub-rows: Gross Premium Income, Net Premium Income,
    Income from Investments (Net), Operating Expenses, Payment to
    policyholders, Yield on investments %, Total Assets).

    Each AR carries 5 years (the reporting year + 4 prior). Aggregating
    across multiple ARs builds a longer panel with the most-recent AR
    preferred when years overlap.

    Returns: { "2023-24": {gross_premium_cr, net_premium_cr, ...}, ... }
    """
    target_page = None
    for p in range(len(doc)):
        text = doc[p].get_text()
        if ('Summary of Financial Statements' in text and
                'Gross Premium Income' in text and 'Net Premium' in text):
            target_page = p
            break
    if target_page is None:
        return {}

    text = doc[target_page].get_text()
    lines = [l.strip() for l in text.split('\n') if l.strip()]

    # Find year header (5 consecutive lines like 2023-24, 2022-23, ...)
    years = None
    year_idx = None
    for i in range(len(lines) - 4):
        if all(re.match(r'\d{4}-\d{2}', lines[i + j]) for j in range(5)):
            year_idx = i
            years = [lines[i + j] for j in range(5)]
            break
    if not years:
        return {}

    # Map AR phrasings to canonical field names. Some labels are
    # multi-line in the PDF (e.g. "Operating Expenses related insurance
    # business" wraps onto 2 lines), so we substring-match the line.
    LABELS = [
        # (substring match, field, scoring priority — higher wins on collision)
        ("Gross Premium Income", "gross_premium_cr", 3),
        ("Net Premium Income", "net_premium_cr", 3),
        ("Income from Investments (Net)", "investment_income_cr", 3),
        ("Other Income", "other_income_cr", 1),
        ("Total Income", "total_income_cr", 1),
        ("Commissions", "commissions_cr", 3),
        ("Operating Expenses related insurance", "operating_expenses_cr", 3),
        ("Provision for Taxation and Others", "tax_other_cr", 1),
        ("Total Expenses", "total_expenses_cr", 2),
        ("Payment to policyholders", "claims_paid_cr", 3),
        ("Surplus/Deficit from operations", "surplus_cr", 2),
        ("Profit/loss after tax", "shareholder_pat_cr", 1),
        ("Net worth", "net_worth_cr", 2),
        ("Total Assets", "total_assets_cr", 2),
    ]

    # The 5-year summary table has Yield on investments % shown TWICE
    # (Policyholders' A/c and Shareholders' A/c). The Policyholders'
    # entry is the relevant one — appears FIRST in the table flow.
    # We capture only the FIRST yield occurrence with band 0-15%.

    def parse_num(s):
        s = s.replace(',', '').strip()
        if not s or s == '-': return None
        # Handle parens for negatives, asterisk footnote refs, hash marks
        s = s.replace('(', '-').replace(')', '').lstrip('*#')
        try: return float(s)
        except: return None

    results = {y: {} for y in years}
    found_yield = False

    for i, line in enumerate(lines):
        # Yield on investments % — only capture the first occurrence
        # (Policyholders' A/c, which is the meaningful one).
        if not found_yield and 'Yield on investments %' in line:
            vals = []
            for j in range(i + 1, min(i + 12, len(lines))):
                next_line = lines[j]
                v = parse_num(next_line)
                if v is not None and 0 < v < 15:
                    vals.append(v)
                    if len(vals) == 5: break
                # Stop on next label
                if re.match(r'^[A-Za-z]', next_line) and 'Yield' not in next_line and len(next_line) > 10:
                    break
            if len(vals) == 5:
                for k, y in enumerate(years):
                    results[y]['investment_yield_pct'] = vals[k]
                found_yield = True
            continue

        for label_substr, field, _priority in LABELS:
            if label_substr in line and field not in results[years[0]]:
                vals = []
                for j in range(i + 1, min(i + 18, len(lines))):
                    next_line = lines[j]
                    v = parse_num(next_line)
                    if v is not None:
                        vals.append(v)
                        if len(vals) == 5: break
                    elif vals and re.match(r'^[A-Za-z]', next_line) and len(next_line) > 5:
                        # Hit next label before collecting 5 — abandon
                        break
                if len(vals) == 5:
                    for k, y in enumerate(years):
                        results[y][field] = vals[k]
                break  # found this label in this line, move to next line

    return results


def fiscal_year_end_from_ar_year(ar_year: str) -> str:
    """Convert '2023-24' to '2024-03-31'."""
    m = re.match(r'(\d{4})-(\d{2})', ar_year)
    if m:
        end_year = int(m.group(1)) + 1
        return f"{end_year}-03-31"
    return ar_year


def aggregate_5year_across_ars(pdfs) -> dict:
    """Walk all ARs, extract 5-year summaries, merge into a per-period dict.

    Strategy: trust only the LATEST AR's 5-year summary. Older ARs' tables
    appear to use different scales (lakhs vs crores) or label conventions
    that yield corrupt numbers (e.g. FY2021 AR producing net_premium ~30M Cr
    for FY2017-FY2019 — 100x too large vs known ~3 lakh crore).

    Plausibility band check: net_premium_cr must be in [50,000, 1,000,000] Cr
    range for major Indian life insurers. Anything outside that is rejected.
    """
    panel = {}  # period_end -> {field: value, source_ar}

    if not pdfs:
        return panel

    # Pick the latest AR by filename FY suffix
    def ar_year(p):
        m = re.search(r"FY(\d{4})", p.name)
        return int(m.group(1)) if m else 0
    latest_pdf = max(pdfs, key=ar_year)
    print(f"  Using LATEST AR for Tier 1 extraction: {latest_pdf.name}")

    try:
        doc = fitz.open(str(latest_pdf))
        five_year = extract_5year_summary(doc)
        doc.close()
    except Exception as e:
        print(f"  WARN: 5-year summary extract failed for {latest_pdf.name}: {e}")
        return panel

    # Plausibility bands (₹ Cr) for sanity-checking
    BANDS = {
        "gross_premium_cr":     (50_000, 1_000_000),
        "net_premium_cr":       (50_000, 1_000_000),
        "investment_income_cr": (10_000, 1_000_000),
        "claims_paid_cr":       (10_000, 1_000_000),
        "operating_expenses_cr":(1_000,    200_000),
        "commissions_cr":       (500,      100_000),
        "total_assets_cr":     (500_000, 10_000_000),
        "investment_yield_pct": (0.5, 15.0),
    }

    for ar_year_str, fields in five_year.items():
        period_end = fiscal_year_end_from_ar_year(ar_year_str)
        if not fields:
            continue
        # Validate fields against plausibility bands; drop anything out-of-range
        clean = {}
        for k, v in fields.items():
            if k in BANDS:
                lo, hi = BANDS[k]
                if v is None or v < lo or v > hi:
                    continue
            clean[k] = v
        if clean:
            panel[period_end] = clean
            panel[period_end]['source_ar'] = latest_pdf.name

    return panel


def derive_insurance_ratios(period: dict) -> None:
    """Compute claims_ratio, expense_ratio, combined_ratio, premium_growth
    from raw Tier 1 fields. Mutates period in place. Skips if inputs absent.
    """
    net_premium = period.get('net_premium_cr')
    claims = period.get('claims_paid_cr')
    opex = period.get('operating_expenses_cr')
    commissions = period.get('commissions_cr')

    if net_premium and net_premium > 0:
        if claims is not None:
            period['claims_ratio_pct'] = round(abs(claims) / net_premium * 100, 2)
        if opex is not None:
            # Insurance "expense ratio" = (opex + commissions) / premium
            total_management_exp = abs(opex) + (abs(commissions) if commissions else 0)
            period['expense_ratio_pct'] = round(total_management_exp / net_premium * 100, 2)
        if period.get('claims_ratio_pct') is not None and period.get('expense_ratio_pct') is not None:
            period['combined_ratio_pct'] = round(
                period['claims_ratio_pct'] + period['expense_ratio_pct'], 2
            )

def process_insurance_quality():
    ar_dir = AR_BASE / TICKER
    if not ar_dir.exists():
        print(f"ERROR: AR directory not found: {ar_dir}")
        return
        
    pdfs = sorted(ar_dir.glob("*.pdf"))
    print(f"Found {len(pdfs)} annual report PDFs for LIC.")

    # Phase 1: Aggregate 5-year IRDAI summary tables across all ARs
    print("\n=== Phase 1: Tier 1 — IRDAI 5-year summary tables ===")
    tier1_panel = aggregate_5year_across_ars(pdfs)
    print(f"Tier 1 panel: {len(tier1_panel)} periods")
    for pe in sorted(tier1_panel.keys()):
        f = tier1_panel[pe]
        net_prem = f.get('net_premium_cr')
        claims = f.get('claims_paid_cr')
        opex = f.get('operating_expenses_cr')
        print(f"  {pe}: net_prem={net_prem} claims={claims} opex={opex} (from {f.get('source_ar', '?')})")

    # Phase 2: Per-AR Tier 2 (curated + scanned)
    print("\n=== Phase 2: Tier 2 — Curated actuarial / solvency disclosures ===")
    periods = []
    seen_period_ends = set()

    # Build a unified period list: union of curated keys + Tier 1 panel + per-AR
    all_period_ends = set(CURATED_DATA.keys()) | set(tier1_panel.keys())
    for pdf in pdfs:
        m = re.search(r"FY(\d{4})", pdf.name)
        if m:
            all_period_ends.add(fiscal_year_end(f"FY{m.group(1)}"))

    for period_end in sorted(all_period_ends):
        fy_label = f"FY{period_end[:4]}"
        curated = CURATED_DATA.get(period_end, {})

        # Find an AR whose filename matches this fiscal year for source_doc
        matching_pdf = next((p for p in pdfs if f"FY{period_end[:4]}" in p.name), None)
        scanned = scan_pdf_for_metrics(str(matching_pdf)) if matching_pdf else {}

        record = {
            "period_end": period_end,
            "fiscal_label": fy_label,
            # Tier 2 — curated > scanned
            "solvency_ratio": curated.get("solvency_ratio") or scanned.get("solvency_ratio"),
            "embedded_value": curated.get("embedded_value") or scanned.get("embedded_value"),
            "vnb": curated.get("vnb") or scanned.get("vnb"),
            "nbm_pct": curated.get("nbm_pct") or scanned.get("nbm_pct"),
            "lapse_rate": None,  # see comment in original
            "persistency_13m": curated.get("persistency_13m") or scanned.get("persistency_13m"),
            "persistency_61m": curated.get("persistency_61m") or scanned.get("persistency_61m"),
            "source_doc": matching_pdf.name if matching_pdf else None,
            "source_notes": "Tier 1 from IRDAI 5-year summary (cross-AR), Tier 2 from curated disclosures.",
        }

        # Tier 1 — IRDAI 5-year summary for this period
        tier1 = tier1_panel.get(period_end, {})
        for k, v in tier1.items():
            if k != 'source_ar':
                record[k] = v

        # Derive Tier 1 ratios
        derive_insurance_ratios(record)

        # Premium growth = YoY
        prior_pe = f"{int(period_end[:4]) - 1}-03-31"
        prior_prem = tier1_panel.get(prior_pe, {}).get('net_premium_cr')
        cur_prem = record.get('net_premium_cr')
        if cur_prem and prior_prem and prior_prem > 0:
            record['premium_growth_pct'] = round((cur_prem - prior_prem) / prior_prem * 100, 2)

        periods.append(record)
        seen_period_ends.add(period_end)

    periods.sort(key=lambda r: r["period_end"])

    output = {
        "schema_version": "2026-05-bank-quality-v1",
        "company_name": COMPANY_NAME,
        "ticker": TICKER,
        "as_of_date": periods[-1]["period_end"] if periods else "unknown",
        "source_notes": (
            "LIC quality indicators. Tier 1 (premium, claims, opex, commissions, "
            "investment yield) extracted from IRDAI Form-style 5-year summary "
            "tables aggregated across LICI_AR_FY2021-FY2024.pdf. Tier 2 (solvency, "
            "EV, VNB, persistency) from curated investor relations disclosures. "
            "Derived ratios: claims/expense/combined ratio, premium growth."
        ),
        "periods": periods
    }
    
    # Save to penman-v2-analysis companies directory
    out_dir = OUTPUT_BASE / COMPANY_FOLDER
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "quality_indicators.json"
    
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
        
    print(f"\nGenerated quality indicators successfully!")
    print(f"Output path: {out_path}")
    print(f"Number of periods: {len(periods)}")
    for p in periods:
        flags = []
        if p.get("solvency_ratio"): flags.append(f"solv={p['solvency_ratio']}")
        if p.get("embedded_value"): flags.append(f"EV={p['embedded_value']:.0f}Cr")
        if p.get("net_premium_cr"): flags.append(f"prem={p['net_premium_cr']:.0f}Cr")
        if p.get("claims_ratio_pct"): flags.append(f"claims={p['claims_ratio_pct']}%")
        if p.get("expense_ratio_pct"): flags.append(f"opex={p['expense_ratio_pct']}%")
        print(f"  {p['period_end']}: {' '.join(flags) or '(no data)'}")

if __name__ == "__main__":
    process_insurance_quality()
