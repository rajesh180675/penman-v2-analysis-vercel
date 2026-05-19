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

AR_BASE = Path(r"C:\Users\rajesh\WindsurfAPI\ITC-valuation-template\public\data\annual_reports")
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
    """Extract CASA ratio from MD&A."""
    for p in range(len(doc)):
        text = doc[p].get_text()
        # "CASA ratio ... X.X%" or "CASA ... accounted for X.X per cent"
        m = re.search(
            r"CASA[^.]*?(\d+\.?\d*)\s*(?:per\s*cent|%)",
            text, re.IGNORECASE
        )
        if m:
            val = float(m.group(1))
            if 10 < val < 80:  # Plausibility
                return val
    return None


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
