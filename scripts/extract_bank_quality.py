"""
Bank Quality Indicators Extractor — Phase B5.5
Extracts GNPA, NNPA, CRAR, Tier-1, PCR, CASA, slippage, advances/deposits growth
from Annual Report PDFs using text extraction + regex.

Usage:
  python extract_bank_quality.py HDFCBANK
  python extract_bank_quality.py ICICIBANK
  python extract_bank_quality.py SBIN
  python extract_bank_quality.py KOTAKBANK
"""

import fitz  # pymupdf
import re
import json
import sys
import os
from pathlib import Path

import os

# Phase rigor-8: AR_BASE is configurable via PENMAN_AR_BASE env var.
# Default is now the in-repo location (gitignored). Override with
# `PENMAN_AR_BASE=/path/to/annual_reports` for alternate locations.
AR_BASE = Path(os.environ.get(
    "PENMAN_AR_BASE",
    r"C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\annual_reports",
))
OUTPUT_BASE = Path(r"C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\companies")

# Map ticker to company folder in penman-v2-analysis
TICKER_TO_FOLDER = {
    "HDFCBANK": "HDFC Bank",
    "ICICIBANK": "ICICI Bank",
    "SBIN": "SBIN",
    "KOTAKBANK": "KOTAKBANK",
    "BAJFINANCE": "Bajaj Finance",
}

TICKER_TO_NAME = {
    "HDFCBANK": "HDFC Bank Ltd",
    "ICICIBANK": "ICICI Bank Ltd",
    "SBIN": "State Bank of India",
    "KOTAKBANK": "Kotak Mahindra Bank Ltd",
    "BAJFINANCE": "Bajaj Finance Ltd",
}


def fiscal_year_end(fy_label: str) -> str:
    """Convert FY2025 or 2024-25 to 2025-03-31."""
    if "FY" in fy_label:
        year = int(fy_label.replace("FY", ""))
        if year < 100:
            year += 2000
        return f"{year}-03-31"
    # Format: 2024-25
    m = re.match(r"(\d{4})-(\d{2})", fy_label)
    if m:
        year = int(m.group(1)) + 1  # 2024-25 ends in March 2025
        return f"{year}-03-31"
    return fy_label


def extract_10year_highlights(doc) -> dict:
    """Extract Tier-1 and CRAR from the 10-Year Financial Highlights table."""
    results = {}
    
    for p in range(len(doc)):
        text = doc[p].get_text()
        if "10 YEAR" not in text.upper() and "10-YEAR" not in text.upper() and "TEN YEAR" not in text.upper() and "LAST 10 YEARS" not in text.upper() and "KEY FINANCIAL INDICATORS" not in text.upper():
            continue
        if "Tier" not in text and "Capital" not in text and "capital" not in text:
            continue
        
        lines = text.split("\n")
        years = []
        tier1_vals = []
        crar_vals = []
        
        # Find year row — look for line with multiple YYYY-YY patterns
        # Some ARs have all years on one line, others have one year per line
        for i, line in enumerate(lines):
            year_matches = re.findall(r"(\d{4}-\d{2})", line)
            if len(year_matches) >= 5:
                years = year_matches
                break
        
        # If not found on one line, collect consecutive lines with year patterns
        if not years:
            for i, line in enumerate(lines):
                m = re.match(r"\s*(\d{4}-\d{2})\s*$", line.strip())
                if m:
                    # Start collecting
                    years = [m.group(1)]
                    for j in range(i + 1, min(i + 15, len(lines))):
                        m2 = re.match(r"\s*(\d{4}-\d{2})\s*$", lines[j].strip())
                        if m2:
                            years.append(m2.group(1))
                        else:
                            break
                    if len(years) >= 5:
                        break
                    else:
                        years = []
        
        # ICICI format: plain 4-digit years (2016, 2017, ..., 2025)
        if not years:
            for i, line in enumerate(lines):
                m = re.match(r"\s*(\d{4})\s*$", line.strip())
                if m and 2005 <= int(m.group(1)) <= 2030:
                    candidate = [m.group(1)]
                    for j in range(i + 1, min(i + 15, len(lines))):
                        m2 = re.match(r"\s*(\d{4})\s*$", lines[j].strip())
                        if m2 and 2005 <= int(m2.group(1)) <= 2030:
                            candidate.append(m2.group(1))
                        else:
                            break
                    if len(candidate) >= 5:
                        # Convert plain years to YYYY-YY format (fiscal year ending March)
                        years = [f"{int(y)-1}-{y[2:]}" for y in candidate]
                        break
        
        if not years:
            continue
        
        num_years = len(years)
        
        # Find Tier 1 and Total capital ratio — values are on subsequent lines
        for i, line in enumerate(lines):
            if re.search(r"Tier\s*[1I]\s*(?:capital\s*)?ratio|Tier\s*[1I]\s*\(%\)", line, re.IGNORECASE):
                # Collect next N lines that look like percentages
                vals = []
                for j in range(1, num_years + 5):
                    if i + j < len(lines):
                        m = re.match(r"\s*(\d+\.?\d*)%?\s*$", lines[i + j])
                        if m and 5 < float(m.group(1)) < 30:
                            vals.append(float(m.group(1)))
                        elif vals:  # Stop if we hit a non-percentage line after collecting some
                            break
                if len(vals) >= num_years:
                    tier1_vals = vals[:num_years]
                    
            elif re.search(r"Total\s*capital\s*(?:adequacy)?\s*(?:ratio)?|Capital\s*Adequacy\s*Ratio", line, re.IGNORECASE):
                # Skip footnote reference lines like "ratio1"
                start_j = 1
                if i + 1 < len(lines) and re.match(r"\s*ratio\d?\s*$", lines[i + 1]):
                    start_j = 2
                vals = []
                for j in range(start_j, num_years + 5):
                    if i + j < len(lines):
                        m = re.match(r"\s*(\d+\.?\d*)%?\s*$", lines[i + j])
                        if m and 5 < float(m.group(1)) < 30:
                            vals.append(float(m.group(1)))
                        elif vals:
                            break
                if len(vals) >= num_years:
                    crar_vals = vals[:num_years]
        
        for i, yr in enumerate(years):
            pe = fiscal_year_end(yr)
            if pe not in results:
                results[pe] = {}
            if tier1_vals and i < len(tier1_vals):
                results[pe]["tier1_pct"] = tier1_vals[i]
            if crar_vals and i < len(crar_vals):
                results[pe]["crar_pct"] = crar_vals[i]
        
        if results:
            print(f"  10-Year Highlights found on page {p+1}: {len(years)} years, tier1={len(tier1_vals)}, crar={len(crar_vals)}")
            break
    
    return results


def extract_gnpa_nnpa(doc) -> dict:
    """Extract GNPA and NNPA from MD&A text across all pages."""
    results = {}
    
    for p in range(len(doc)):
        text = doc[p].get_text()
        
        # Pattern: "Gross NPA ratio ... X.XX per cent" or "GNPA ... X.XX%"
        # Also capture "as against Y.YY per cent" for prior year
        
        # Current year GNPA — require it to be a standalone statement, not "to total gross NPAs"
        gnpa_matches = re.finditer(
            r"(?:Gross\s*(?:Non-?\s*Performing\s*Asset|NPA)s?\s*(?:\(GNPAs?\))?\s*(?:ratio|to\s*(?:Gross|Net)\s*Advances))\s*(?:stood\s*at\s*|(?:was|were|is)\s*(?:at\s*)?)?(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        for m in gnpa_matches:
            val = float(m.group(1))
            if 0 < val < 30:  # Plausibility check
                if "current_gnpa" not in results:
                    results["current_gnpa"] = val
                elif "prior_gnpa" not in results and val != results["current_gnpa"]:
                    results["prior_gnpa"] = val
        
        # NNPA
        nnpa_matches = re.finditer(
            r"(?:Net\s*(?:Non-?\s*Performing\s*Asset|NPA)s?\s*(?:\(NNPAs?\))?|NNPA)\s*(?:ratio\s*)?(?:stood\s*at\s*|(?:was|were|is)\s*(?:at\s*)?)?(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        for m in nnpa_matches:
            val = float(m.group(1))
            if 0 <= val < 30:
                if "current_nnpa" not in results:
                    results["current_nnpa"] = val
                elif "prior_nnpa" not in results:
                    results["prior_nnpa"] = val
        
        # "as against X.XX per cent" pattern for prior year
        against_matches = re.finditer(
            r"(?:Gross\s*(?:Non-?\s*Performing|NPA)[^.]*?)(\d+\.?\d*)\s*(?:per\s*cent|%)[^.]*?as\s*against\s*(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        for m in against_matches:
            current = float(m.group(1))
            prior = float(m.group(2))
            if 0 < current < 30 and 0 < prior < 30:
                results["current_gnpa"] = current
                results["prior_gnpa"] = prior
        
        against_nnpa = re.finditer(
            r"(?:Net\s*(?:Non-?\s*Performing|NPA)[^.]*?)(\d+\.?\d*)\s*(?:per\s*cent|%)[^.]*?as\s*against\s*(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        for m in against_nnpa:
            current = float(m.group(1))
            prior = float(m.group(2))
            if 0 <= current < 30 and 0 <= prior < 30:
                results["current_nnpa"] = current
                results["prior_nnpa"] = prior
    
    return results


def extract_casa(doc) -> float | None:
    """Extract CASA ratio from MD&A.

    The CASA section of bank ARs contains many "CASA ... X%" sentences. Most
    are growth phrases ("CASA deposits increased by 11.7%") not the ratio we
    want ("CASA ratio was 39.0%"). The previous extractor matched the FIRST
    number, which was usually wrong (typically a deposit-growth percentage).

    Strategy:
      1. Scan all pages, build a list of (value, phrasing_score, context).
      2. REJECT growth phrasings: "increased by", "grew by", "rose by",
         "increased  X% from", "decreased by", year-on-year growth.
      3. SCORE positive matches by phrasing strength:
           +3 for "CASA ratio was/of/stood at X%"
           +3 for "CASA ratio (increased|decreased) (from|to) X%"
           +2 for "X% of total (average) deposits"
           +2 for "average CASA ratio ... X%"
           +1 for any other "CASA ... X%" within plausibility band
      4. Plausibility band: 25-60% for Indian private/public banks.
      5. Pick highest-scored candidate; tie-break by frequency (mode).
    """
    band_lo, band_hi = 25.0, 60.0
    candidates: list[tuple[float, int, str]] = []

    # Phrasings that signal GROWTH (volume change), not RATIO. Critical: only
    # mask BY-clauses ("increased by X%"), NOT "increased from X% to Y%" — the
    # latter describes a ratio change where X and Y are both ratios.
    reject_patterns = [
        # "CASA deposits increased by X%" — explicit volume growth
        r"CASA[^.]{0,80}?(?:deposits?\s+)?(?:increased|grew|rose|expanded|decreased)\s+by\s+(\d+\.?\d*)\s*(?:per\s*cent|%)",
        # "year-on-year growth in CASA deposits was X%"
        r"(?:year[-\s]on[-\s]year\s+)?growth\s+in\s+CASA[^.]{0,40}?(\d+\.?\d*)\s*(?:per\s*cent|%)",
        # "Average CASA deposits increased by X%"
        r"average\s+CASA[^.]{0,40}?(?:increased|grew|rose|decreased)\s+by\s+(\d+\.?\d*)\s*(?:per\s*cent|%)",
        # "average current account deposits rose by X% while average savings accounts ..."
        r"average\s+(?:current|savings)\s+account[^.]{0,80}?(?:rose|grew|increased)\s+by\s+(\d+\.?\d*)\s*(?:per\s*cent|%)",
    ]

    # Phrasings that signal RATIO — score these
    accept_specs = [
        # "CASA ratio was/is/of/stands/stood at X%" — strongest. Allow up to 40
        # extra chars between "ratio" and the verb (e.g. "CASA ratio of your
        # Bank stood at 45.28%" in SBIN ARs).
        (r"(?:Average\s+)?CASA\s+(?:\(?ratio\)?|deposits?\s+ratio)[^.\n]{0,40}?\s+(?:was|is|of|stood\s+at|stands\s+at)\s*(\d+\.?\d*)\s*(?:per\s*cent|%)", 3),
        # "improved its CASA ratio to X%" / "CASA ratio improved to X%" (SBIN)
        (r"(?:improved|raised|reduced|lifted|brought)\s+(?:its|our|the)\s+CASA\s+(?:\(?ratio\)?)\s+to\s+(\d+\.?\d*)\s*(?:per\s*cent|%)", 3),
        (r"CASA\s+(?:\(?ratio\)?)\s+(?:improved|raised|reduced|lifted)\s+to\s+(\d+\.?\d*)\s*(?:per\s*cent|%)", 3),
        # "CASA ratio increased/decreased to X%" (capture Y% — current period)
        (r"CASA\s+(?:\(?ratio\)?)\s+(?:increased|decreased|grew|rose|fell|moved)\s+(?:from\s+\d+\.?\d*\s*(?:per\s*cent|%)\s+(?:at\s+March\s+\d+,?\s+\d+\s+)?)?to\s+(\d+\.?\d*)\s*(?:per\s*cent|%)", 3),
        # "CASA Deposits accounted for X per cent of Total Deposits" (HDFC AR)
        (r"CASA\s+[Dd]eposits\s+accounted\s+for\s+(\d+\.?\d*)\s*(?:per\s*cent|%)\s+of\s+(?:total\s+)?deposits?", 3),
        # "average CASA deposits ... increased from X% of total ... to Y% of total" — capture Y% (current FY ratio)
        (r"average\s+CASA[^.]{0,80}?(?:increased|decreased)\s+from\s+\d+\.?\d*\s*(?:per\s*cent|%)\s+of\s+(?:total\s+)?(?:average\s+)?deposits?[^.]{0,80}?to\s+(\d+\.?\d*)\s*(?:per\s*cent|%)\s+of\s+(?:total\s+)?(?:average\s+)?deposits?", 3),
        # "X% of total (average) deposits"
        (r"(?:CASA[^.]{0,40}?\s+(?:were?|was|is|are))\s+(\d+\.?\d*)\s*(?:per\s*cent|%)\s+of\s+(?:total\s+)?(?:average\s+)?deposits?", 2),
        # "average CASA ratio ... X%" (table snippet)
        (r"average\s+CASA\s+ratio[^.]{0,40}?(\d+\.?\d*)\s*(?:per\s*cent|%)", 2),
        # Inverse ordering: "X% ... CASA ratio" (table caption)
        (r"(\d+\.?\d*)\s*(?:per\s*cent|%)\s*[\|\s]*(?:Average\s+)?CASA\s+\(?[Rr]atio\)?", 2),
    ]

    for p in range(len(doc)):
        text = doc[p].get_text()
        if "CASA" not in text:
            continue

        # Mask reject regions so accept patterns can't claim them
        masked = text
        for rej in reject_patterns:
            masked = re.sub(rej, lambda m: " " * len(m.group(0)), masked, flags=re.IGNORECASE)

        for pat, score in accept_specs:
            for m in re.finditer(pat, masked, re.IGNORECASE):
                try:
                    val = float(m.group(1))
                except (ValueError, IndexError):
                    continue
                if not (band_lo <= val <= band_hi):
                    continue
                # Capture context for diagnostics
                start = max(0, m.start() - 30)
                end = min(len(text), m.end() + 30)
                ctx = text[start:end].replace("\n", " | ")[:120]
                candidates.append((val, score, ctx))

    if not candidates:
        return None

    # Pick highest-scored candidate; ties broken by mode (most common value within 0.5pp)
    candidates.sort(key=lambda c: -c[1])
    best_score = candidates[0][1]
    top = [c for c in candidates if c[1] == best_score]

    if len(top) == 1:
        return round(top[0][0], 2)

    # Mode: most common value within 0.5pp tolerance
    from collections import Counter
    rounded = [round(c[0] * 2) / 2 for c in top]  # snap to 0.5pp grid
    mode_val, _ = Counter(rounded).most_common(1)[0]
    return round(mode_val, 2)


def extract_crar_mdna(doc) -> float | None:
    """Extract CRAR / Total Capital Adequacy Ratio from MD&A as a fallback when
    the 10-Year Highlights table didn't yield a value (Capitaline RBI NHB also
    leaves crar=0 for SBIN and similar cases).

    Patterns observed across SBIN/HDFC/ICICI ARs:
      - "Capital Adequacy Ratio (CAR) ... stands at X%"
      - "Capital Adequacy Ratio of X% demonstrating ..."
      - "CRAR stood at X%"
      - "Total Capital Ratio (%) | X%" (10-year table cell)

    Reject:
      - "regulatory minimum of X per cent" (regulatory floor, not actual)
      - "CRAR of X per cent on an ongoing basis" (regulatory floor language)
      - Tier-1 / CET-1 mentions

    Plausibility band: 9-30% (RBI Basel III floor is ~11.5%, max realistic ~25%).
    """
    band_lo, band_hi = 9.0, 30.0
    candidates: list[tuple[float, int]] = []

    accept_specs = [
        # "Capital Adequacy Ratio (CAR/CRAR) stands/stood at X%"
        (r"(?:Capital\s+Adequacy\s+Ratio|CRAR|Total\s+Capital\s+Ratio)\s*\(?(?:CAR|CRAR)?\)?[^.]{0,80}?(?:stands?|stood)\s+at\s+(\d+\.?\d*)\s*(?:per\s*cent|%)", 3),
        # "Capital Adequacy Ratio of X%"
        (r"Capital\s+Adequacy\s+Ratio\s+of\s+(\d+\.?\d*)\s*(?:per\s*cent|%)", 3),
        # "Total Capital Ratio (%) | X%" — 10-year table cell pattern
        (r"Total\s+Capital\s+Ratio\s*\(?%?\)?\s*[\|\s]+(\d+\.?\d*)\s*(?:per\s*cent|%)?", 2),
        # "CRAR (%) ... X%" — table snippet
        (r"CRAR\s*\(?%?\)?\s*[\|\s]+(\d+\.?\d*)\s*(?:per\s*cent|%)?", 1),
    ]

    reject_patterns = [
        r"(?:regulatory\s+)?minimum\s+(?:of\s+)?(?:CRAR|capital)?\s*(?:of\s+)?(\d+\.?\d*)\s*(?:per\s*cent|%)",
        r"CRAR\s+of\s+(\d+\.?\d*)\s*(?:per\s*cent|%)\s+on\s+an?\s+ongoing\s+basis",
        r"CRAR\s+(?:at\s+or\s+)?(?:above|below)\s+(?:the\s+regulatory\s+minimum\s+of\s+)?(\d+\.?\d*)\s*(?:per\s*cent|%)",
        # Tier-1 / CET-1 specifically — handled separately
        r"(?:Tier\s*[1I]|CET\s*1|Common\s+Equity\s+Tier\s*1)\s*(?:capital\s*)?(?:ratio\s*)?(?:was|is|of|stood\s+at|stands\s+at)?\s*(\d+\.?\d*)\s*(?:per\s*cent|%)",
    ]

    for p in range(len(doc)):
        text = doc[p].get_text()
        if "Capital Adequacy" not in text and "CRAR" not in text and "Total Capital Ratio" not in text:
            continue

        masked = text
        for rej in reject_patterns:
            masked = re.sub(rej, lambda m: " " * len(m.group(0)), masked, flags=re.IGNORECASE)

        for pat, score in accept_specs:
            for m in re.finditer(pat, masked, re.IGNORECASE):
                try:
                    val = float(m.group(1))
                except (ValueError, IndexError):
                    continue
                if not (band_lo <= val <= band_hi):
                    continue
                candidates.append((val, score))

    if not candidates:
        return None

    candidates.sort(key=lambda c: -c[1])
    best_score = candidates[0][1]
    top = [c for c in candidates if c[1] == best_score]

    if len(top) == 1:
        return round(top[0][0], 2)

    from collections import Counter
    rounded = [round(c[0] * 20) / 20 for c in top]
    mode_val, _ = Counter(rounded).most_common(1)[0]
    return round(mode_val, 2)


def extract_pcr(doc) -> float | None:
    """Extract Provision Coverage Ratio."""
    for p in range(len(doc)):
        text = doc[p].get_text()
        m = re.search(
            r"(?:Provision\s*Coverage\s*(?:Ratio)?|PCR)\s*[^.]*?(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        if m:
            val = float(m.group(1))
            if 30 < val < 100:
                return val
    return None


def extract_advances_deposits_growth(doc) -> tuple:
    """Extract advances and deposits growth from MD&A."""
    adv_growth = None
    dep_growth = None
    
    for p in range(len(doc)):
        text = doc[p].get_text()
        
        # Advances growth
        m = re.search(
            r"(?:advances|loan\s*book)\s*(?:grew|growth|increased|rose)\s*(?:by\s*)?(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        if m and adv_growth is None:
            adv_growth = float(m.group(1))
        
        # Deposits growth
        m = re.search(
            r"(?:total\s*)?deposits?\s*(?:grew|growth|increased|rose)\s*(?:by\s*)?(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        if m and dep_growth is None:
            dep_growth = float(m.group(1))
    
    return adv_growth, dep_growth


def process_single_ar(pdf_path: str, fy_label: str) -> dict:
    """Process a single Annual Report PDF and return extracted indicators."""
    print(f"  Processing {fy_label}...")
    doc = fitz.open(pdf_path)
    
    period_end = fiscal_year_end(fy_label)
    record = {
        "period_end": period_end,
        "fiscal_label": fy_label,
        "gnpa_pct": None,
        "nnpa_pct": None,
        "pcr_pct": None,
        "slippage_pct": None,
        "restructured_pct": None,
        "crar_pct": None,
        "tier1_pct": None,
        "cet1_pct": None,
        "casa_pct": None,
        "advances_growth_pct": None,
        "deposits_growth_pct": None,
        "source_doc": os.path.basename(pdf_path),
        "source_page": None,
        "source_notes": ""
    }
    
    # 1. 10-Year highlights (Tier-1 + CRAR)
    highlights = extract_10year_highlights(doc)
    if period_end in highlights:
        h = highlights[period_end]
        record["tier1_pct"] = h.get("tier1_pct")
        record["crar_pct"] = h.get("crar_pct")

    # 1b. CRAR MD&A fallback — fires when 10-Year table didn't yield CRAR
    # (e.g. SBIN where the table format breaks the row-collection logic).
    if record["crar_pct"] is None:
        crar_mdna = extract_crar_mdna(doc)
        if crar_mdna:
            record["crar_pct"] = crar_mdna
    
    # 2. GNPA / NNPA from MD&A
    npa_data = extract_gnpa_nnpa(doc)
    if "current_gnpa" in npa_data:
        record["gnpa_pct"] = npa_data["current_gnpa"]
    if "current_nnpa" in npa_data:
        record["nnpa_pct"] = npa_data["current_nnpa"]
    
    # 3. CASA
    casa = extract_casa(doc)
    if casa:
        record["casa_pct"] = casa
    
    # 4. PCR
    pcr = extract_pcr(doc)
    if pcr:
        record["pcr_pct"] = pcr
    
    # 5. Advances / Deposits growth
    adv, dep = extract_advances_deposits_growth(doc)
    record["advances_growth_pct"] = adv
    record["deposits_growth_pct"] = dep
    
    doc.close()
    return record


def process_bank(ticker: str):
    """Process all ARs for a bank and output quality_indicators.json."""
    ar_dir = AR_BASE / ticker
    if not ar_dir.exists():
        print(f"ERROR: AR directory not found: {ar_dir}")
        return
    
    pdfs = sorted(ar_dir.glob("*.pdf"))
    print(f"Processing {ticker}: {len(pdfs)} ARs found")
    
    periods = []
    for pdf in pdfs:
        # Extract FY label from filename: HDFCBANK_AR_FY2025.pdf -> FY2025
        m = re.search(r"FY(\d{4})", pdf.name)
        if m:
            fy_label = f"FY{m.group(1)}"
        else:
            continue
        
        record = process_single_ar(str(pdf), fy_label)
        periods.append(record)
    
    # Sort by period_end
    periods.sort(key=lambda r: r["period_end"])
    
    # Backfill: Use the LATEST AR's 10-Year Highlights table to fill
    # Tier-1 and CRAR for all periods (the latest AR carries all 10 years)
    latest_pdf = pdfs[-1] if pdfs else None
    if latest_pdf:
        print(f"  Backfilling from latest AR: {latest_pdf.name}")
        doc = fitz.open(str(latest_pdf))
        highlights = extract_10year_highlights(doc)
        doc.close()
        
        for record in periods:
            pe = record["period_end"]
            if pe in highlights:
                if record["tier1_pct"] is None and "tier1_pct" in highlights[pe]:
                    record["tier1_pct"] = highlights[pe]["tier1_pct"]
                if record["crar_pct"] is None and "crar_pct" in highlights[pe]:
                    record["crar_pct"] = highlights[pe]["crar_pct"]
    
    # Build output JSON
    latest_pe = periods[-1]["period_end"] if periods else "unknown"
    output = {
        "schema_version": "2026-05-bank-quality-v1",
        "company_name": TICKER_TO_NAME.get(ticker, ticker),
        "as_of_date": latest_pe,
        "source_notes": f"FY{int(periods[0]['period_end'][:4])}-FY{int(periods[-1]['period_end'][:4])}, extracted from Annual Reports via pymupdf text + regex.",
        "periods": periods
    }
    
    # Write output
    folder = TICKER_TO_FOLDER.get(ticker, ticker)
    out_dir = OUTPUT_BASE / folder
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "quality_indicators.json"
    
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\nOutput: {out_path}")
    print(f"Periods: {len(periods)}")
    
    # Summary
    filled = 0
    total = 0
    for p in periods:
        for k in ["gnpa_pct", "nnpa_pct", "pcr_pct", "crar_pct", "tier1_pct", "casa_pct"]:
            total += 1
            if p.get(k) is not None:
                filled += 1
    print(f"Field coverage: {filled}/{total} ({100*filled//total}%)")
    
    return output


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_bank_quality.py HDFCBANK|ICICIBANK|SBIN|KOTAKBANK|ALL")
        sys.exit(1)
    
    ticker = sys.argv[1].upper()
    if ticker == "ALL":
        for t in ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK"]:
            process_bank(t)
            print()
    else:
        process_bank(ticker)
