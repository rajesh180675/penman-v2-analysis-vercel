"""
NBFC Quality Indicators Extractor — Phase D2

Extracts NBFC-specific asset-quality and capital-adequacy metrics from
Annual Report PDFs that follow the IndAS 109 ECL framework (Stage 1/2/3).

Targets:
  - CRAR (Capital to Risk-Weighted Assets), Tier-I CRAR
  - Stage 3 % of gross loans (NBFC equivalent of GNPA-IRACP)
  - Stage 2 % of gross loans
  - ECL coverage % on Stage 3 (impairment loss allowance / gross Stage 3)
  - Total ECL % of gross loans
  - GNPA / Net NPA / PCR (when reported in Key Ratios table)
  - AUM (₹ Cr) and YoY AUM growth %
  - Off-book / assignment share where reported

Usage:
  py -3.14 scripts/extract_nbfc_quality.py BAJFINANCE
  py -3.14 scripts/extract_nbfc_quality.py CHOLAFIN
  py -3.14 scripts/extract_nbfc_quality.py ALL

The script is idempotent — it overwrites `quality_indicators.json` for the
named ticker each run. Field coverage is reported at the end.
"""

import fitz  # pymupdf
import re
import json
import os
import sys
from pathlib import Path

AR_BASE = Path(os.environ.get(
    "PENMAN_AR_BASE",
    r"C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\annual_reports",
))
OUTPUT_BASE = Path(r"C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\companies")

# Ticker → (folder under penman-v2-analysis/public/data/companies, AR display name)
NBFC_REGISTRY = {
    "BAJFINANCE": ("Bajaj Finance", "Bajaj Finance Ltd"),
    "MUTHOOTFIN": ("Muthoot Finance", "Muthoot Finance Ltd"),
    "SHRIRAMFIN": ("Shriram Finance", "Shriram Finance Ltd"),
}


# ─── Date helpers ────────────────────────────────────────────────────


def fiscal_year_end(fy_label: str) -> str:
    """Convert FY2025 or 2024-25 to 2025-03-31."""
    if "FY" in fy_label:
        year = int(fy_label.replace("FY", ""))
        if year < 100:
            year += 2000
        return f"{year}-03-31"
    m = re.match(r"(\d{4})-(\d{2})", fy_label)
    if m:
        year = int(m.group(1)) + 1
        return f"{year}-03-31"
    return fy_label


# ─── Extractors ──────────────────────────────────────────────────────


def _find_pages(doc, keywords):
    """Return list of (page_index, text) for pages matching all keyword lists.
    `keywords` is a list of OR-groups; a page matches when at least one term
    from EACH group appears."""
    out = []
    for p in range(len(doc)):
        text = doc[p].get_text()
        low = text.lower()
        if all(any(k in low for k in group) for group in keywords):
            out.append((p, text))
    return out


def extract_key_ratios_table(doc):
    """Bajaj-style 'Table 6: Key Ratios' page. Pulls CRAR, Tier-I, GNPA,
    Net NPA, PCR, ROA, ROE, and Cost-to-Income (Opex/NTI) for the latest period.

    Returns a dict with the latest-FY values; backfill into the AR's own
    period record. Earlier-FY values that appear in this table belong to
    those FYs and should be assigned to them by the caller.
    """
    candidates = _find_pages(doc, [
        ["key ratios", "key financial indicators"],
        ["crar", "capital to risk", "capital adequacy"],
    ])
    if not candidates:
        return {}, None

    # Pick the page with the most ratio labels
    best = max(candidates, key=lambda pt: sum(
        1 for k in ["crar", "tier i", "gross npa", "net npa",
                    "provisioning coverage", "return on average"] if k in pt[1].lower()
    ))
    p, text = best
    out = {"_source_page": p + 1}

    def _grab(label_pat, lo=0.0, hi=100.0):
        # Bajaj pattern: "Label\n VALUE%\nVALUE%" with current first.
        m = re.search(
            label_pat + r"[^\n]*\n[^\d\-]*?(\d+\.?\d*)\s*%",
            text, re.IGNORECASE,
        )
        if m:
            v = float(m.group(1))
            if lo <= v <= hi:
                return v
        return None

    out["crar_pct"] = _grab(r"capital to risk[\-\s]?weighted assets ratio\s*\(?CRAR\)?", 5, 50) \
        or _grab(r"\bCRAR\b", 5, 50)
    out["tier1_pct"] = _grab(r"Tier\s*[I1]\b", 5, 50)
    out["gnpa_pct"] = _grab(r"Gross\s+NPA", 0, 30)
    out["nnpa_pct"] = _grab(r"Net\s+NPA", 0, 30)
    out["pcr_pct"] = _grab(r"Provision(?:ing)?\s*[Cc]overage(?:\s*[Rr]atio)?\s*\(?PCR\)?", 0, 100)

    # Cost-to-income: "Total operating expenses to NTI" or "Opex to NTI"
    # FY2024+: "Total operating expenses to NTI\n 33.99%\n35.15%"
    cost_to_income = _grab(
        r"(?:Total\s+)?(?:operating\s+expenses|Opex)\s+to\s+NTI", 10, 80
    )
    if cost_to_income is not None:
        out["cost_to_income_pct"] = cost_to_income

    return {k: v for k, v in out.items() if v is not None and not k.startswith("_")}, out.get("_source_page")


def extract_stage_distribution(doc):
    """Find the Stage 1/2/3 loan distribution table.

    Bajaj structure (page 277 in FY2025 AR):
        Particulars             Stage 1     Stage 2    Stage 3    Total
        Gross carrying amount   302,000.51  5,083.26   3,677.75   310,761.52
        Less: Impairment loss   2,767.69    1,677.33   1,957.34   6,402.36

    Computes:
        stage3_pct      = 3677.75 / 310761.52 * 100
        stage2_pct      = 5083.26 / 310761.52 * 100
        ecl_coverage_pct= 1957.34 / 3677.75 * 100
        total_ecl_pct   = 6402.36 / 310761.52 * 100
    """
    pages = _find_pages(doc, [
        ["stage 1", "stage i"],
        ["stage 2", "stage ii"],
        ["stage 3", "stage iii"],
        ["gross carrying amount", "gross carrying value", "gross loan", "gross financial asset"],
    ])
    if not pages:
        return {}, None

    for p, text in pages:
        # Strip headers/repeated whitespace; extract numeric tokens
        # The fundamental row pattern: a label, then 4 (current) + 4 (prior) numbers
        # We want the FIRST four numbers of the gross-carrying row and the
        # FIRST four of the impairment row from the most recent column block.
        gross = re.search(
            r"Gross\s+carrying\s+(?:amount|value)\s*[\r\n]+([\d,\.\s\r\n\-\(\)]+)",
            text, re.IGNORECASE,
        )
        impair = re.search(
            r"Impairment\s+loss\s+allowance\s*[\r\n]+([\d,\.\s\r\n\-\(\)]+)",
            text, re.IGNORECASE,
        )
        if not gross or not impair:
            continue

        def _nums(s):
            return [float(t.replace(",", ""))
                    for t in re.findall(r"-?\d[\d,]*\.?\d*", s)
                    if re.search(r"\d", t)]

        g = _nums(gross.group(1))
        i = _nums(impair.group(1))
        # Need at least 4 columns (Stage1, Stage2, Stage3, Total) for current FY.
        if len(g) < 4 or len(i) < 4:
            continue

        s1, s2, s3, total = g[0], g[1], g[2], g[3]
        e1, e2, e3, etotal = i[0], i[1], i[2], i[3]

        # Sanity: stages should sum near total
        if total <= 0 or abs((s1 + s2 + s3) - total) / max(total, 1) > 0.05:
            continue
        # Bajaj-scale check: total should be > 1000 Cr (otherwise we matched some
        # tiny disclosure table)
        if total < 1000:
            continue

        out = {
            "stage3_pct": round(s3 / total * 100, 2),
            "stage2_pct": round(s2 / total * 100, 2),
            "ecl_coverage_pct": round(e3 / s3 * 100, 2) if s3 > 0 else None,
            "total_ecl_pct": round(etotal / total * 100, 2),
            "_source_page": p + 1,
        }
        # Drop Nones so JSON stays clean
        return {k: v for k, v in out.items() if v is not None and not k.startswith("_")}, out["_source_page"]

    return {}, None


def extract_aum(doc):
    """Pull consolidated AUM (₹ Cr) and YoY growth %.

    Bajaj phrases this many ways:
      "AUM grew by 26% to H 416,661 crore"
      "Assets under management (AUM) increased by 26% to H 416,661 crore"
      "AUM growth of 26%, rising from H 330,615 crore to H 416,661 crore"
      "consolidated AUM ... H 416,661 crore"

    Strategy: scan ALL pages, collect ALL plausible AUM mentions, then
    pick the LARGEST absolute value as the reporting-year figure.
    Annual Reports always state the closing AUM as the largest number;
    prior-year anchors are smaller. This avoids the FY-anchor bug where
    "rising from H 330,615 crore in FY2024" leaked into the current FY.
    """
    candidates = []  # list of (absolute_cr, growth_pct_or_None)

    for p in range(len(doc)):
        text = doc[p].get_text()

        # Pattern 1: "X% to/reaching H NNN,NNN crore" — has both growth AND absolute
        # in the same sentence. Highest confidence.
        for m in re.finditer(
            r"(?:AUM|Assets\s+[Uu]nder\s+[Mm]anagement)[^\.]{0,80}?"
            r"(?:grew|growth|increased|rose|up|rising|expanding)[^\.]{0,60}?"
            r"(\d+\.?\d*)\s*%[^\.]{0,80}?(?:to|reaching|of|now\s*at)\s*H?\s*([\d,]+)\s*(?:crore|cr\b)",
            text, re.IGNORECASE,
        ):
            growth = float(m.group(1))
            absolute = float(m.group(2).replace(",", ""))
            if 0 < growth < 200 and absolute > 1000:
                candidates.append((absolute, growth))

        # Pattern 2: "AUM ... H NNN,NNN crore" — absolute only
        for m in re.finditer(
            r"(?:consolidated\s+)?(?:Assets\s+[Uu]nder\s+[Mm]anagement\s*\(?AUM\)?|\bAUM\b)"
            r"[^\.]{0,80}?H?\s*([\d,]{4,})\s*(?:crore|cr\b)",
            text, re.IGNORECASE,
        ):
            v = float(m.group(1).replace(",", ""))
            if 5000 < v < 5_000_000:
                candidates.append((v, None))

    if not candidates:
        return {}

    # Pick the LARGEST absolute as the reporting-year AUM. Find the
    # growth value associated with it when available.
    candidates.sort(key=lambda x: x[0], reverse=True)
    aum_cr = candidates[0][0]

    # For growth, prefer the entry whose absolute matches the chosen AUM
    aum_growth = None
    for absolute, growth in candidates:
        if growth is not None and abs(absolute - aum_cr) < 0.01:
            aum_growth = growth
            break
    # Fallback: any growth from Pattern 1 (matches the highest-confidence pair)
    if aum_growth is None:
        for absolute, growth in candidates:
            if growth is not None:
                aum_growth = growth
                break

    out = {"aum_cr": aum_cr}
    if aum_growth is not None:
        out["aum_growth_pct"] = aum_growth
    return out


def extract_off_book_share(doc):
    """Off-book / assignment / co-lending share of AUM.

    Disclosure pattern is uneven across NBFCs; only fill when the AR
    explicitly states a percentage. Skip silently if absent.
    """
    for p in range(len(doc)):
        text = doc[p].get_text()
        m = re.search(
            r"(?:off[\-\s]book|assignment|co[\-\s]lending|securit[iy]s?ed)\s*(?:portfolio|AUM|book|share|loans?)?"
            r"[^\.]{0,40}?(\d+\.?\d*)\s*%",
            text, re.IGNORECASE,
        )
        if m:
            v = float(m.group(1))
            if 0 < v < 60:
                return v
    return None


# ─── Per-AR processing ───────────────────────────────────────────────


def process_single_ar(pdf_path: Path, fy_label: str) -> dict:
    print(f"  Processing {fy_label}...")
    doc = fitz.open(str(pdf_path))

    record = {
        "period_end": fiscal_year_end(fy_label),
        "fiscal_label": fy_label,
        "source_doc": pdf_path.name,
        "source_page": None,
        "source_notes": "",
    }

    # NBFC-specific extractors
    key_ratios, kr_page = extract_key_ratios_table(doc)
    record.update(key_ratios)

    stage, stage_page = extract_stage_distribution(doc)
    record.update(stage)

    aum = extract_aum(doc)
    record.update(aum)

    off_book = extract_off_book_share(doc)
    if off_book is not None:
        record["off_book_share_pct"] = off_book

    # Track best source page (key ratios is most useful for cross-verify)
    record["source_page"] = kr_page or stage_page

    doc.close()
    return record


# ─── Driver ─────────────────────────────────────────────────────────


def process_ticker(ticker: str):
    if ticker not in NBFC_REGISTRY:
        print(f"ERROR: ticker {ticker} not in NBFC_REGISTRY. "
              f"Add it to scripts/extract_nbfc_quality.py.")
        return False

    folder, company_name = NBFC_REGISTRY[ticker]
    ar_dir = AR_BASE / ticker
    if not ar_dir.is_dir():
        print(f"ERROR: AR directory not found: {ar_dir}")
        return False

    pdfs = sorted(ar_dir.glob(f"{ticker}_AR_FY*.pdf"))
    if not pdfs:
        print(f"ERROR: no AR PDFs found in {ar_dir}")
        return False

    print(f"Processing {ticker}: {len(pdfs)} ARs found")

    periods = []
    for pdf in pdfs:
        m = re.search(r"FY(\d{4})", pdf.name)
        fy_label = f"FY{m.group(1)}" if m else pdf.stem
        try:
            periods.append(process_single_ar(pdf, fy_label))
        except Exception as e:
            print(f"  WARN: {fy_label} failed: {e}")

    # Sort by period_end ascending
    periods.sort(key=lambda r: r["period_end"])

    # Compute AUM growth from year-over-year AUM where extraction missed it
    for i in range(1, len(periods)):
        if periods[i].get("aum_growth_pct") is None:
            cur = periods[i].get("aum_cr")
            prev = periods[i - 1].get("aum_cr")
            if cur and prev and prev > 0:
                periods[i]["aum_growth_pct"] = round((cur - prev) / prev * 100, 1)

    # Fill missing fields with null per schema
    NBFC_FIELDS = [
        "gnpa_pct", "nnpa_pct", "pcr_pct", "slippage_pct", "restructured_pct",
        "crar_pct", "tier1_pct", "cet1_pct",
        "casa_pct", "advances_growth_pct", "deposits_growth_pct",
        "stage3_pct", "stage2_pct", "ecl_coverage_pct", "total_ecl_pct",
        "aum_cr", "aum_growth_pct", "off_book_share_pct",
    ]
    for r in periods:
        for f in NBFC_FIELDS:
            r.setdefault(f, None)

    # Coverage stat
    total_fields = len(NBFC_FIELDS) * len(periods)
    filled = sum(1 for r in periods for f in NBFC_FIELDS if r.get(f) is not None)
    coverage_pct = round(filled / total_fields * 100, 1) if total_fields else 0

    # Build sidecar payload
    out_dir = OUTPUT_BASE / folder
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "quality_indicators.json"

    payload = {
        "schema_version": "2026-05-bank-quality-v1",
        "company_name": company_name,
        "as_of_date": periods[-1]["period_end"] if periods else "",
        "source_notes": (
            f"NBFC pipeline ({ticker}). FY{periods[0]['period_end'][:4]}-"
            f"FY{periods[-1]['period_end'][:4]}, extracted from Annual Reports via "
            f"pymupdf + IndAS 109 stage / CRAR / AUM regexes "
            f"(scripts/extract_nbfc_quality.py)."
        ),
        "periods": periods,
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"\nOutput: {out_file}")
    print(f"Periods: {len(periods)}")
    print(f"Field coverage: {filled}/{total_fields} ({coverage_pct}%)")
    return True


def main():
    if len(sys.argv) < 2:
        print("Usage: py -3.14 extract_nbfc_quality.py {TICKER|ALL}")
        print(f"Known tickers: {', '.join(NBFC_REGISTRY)}")
        sys.exit(1)

    arg = sys.argv[1].upper()
    if arg == "ALL":
        ok = True
        for t in NBFC_REGISTRY:
            print(f"\n=== {t} ===")
            ok &= process_ticker(t)
        sys.exit(0 if ok else 1)

    ok = process_ticker(arg)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
