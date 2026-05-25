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


# ─── Per-ticker extractors ───────────────────────────────────────────


def extract_muthoot_multi_year_ratios(doc):
    """Muthoot Finance ARs include a structured 4-column ratios table
    on the 'Business Performance' page (page 13 in FY2025 AR).

    Layout (FY2025 AR, page 13):
        Particulars     | FY25  | FY24  | FY23  | FY22
        Capital adequacy (%)   | 23.71 | 30.37 | 31.77 | 29.97
        Stage 3 loan assets(%) |  3.41 |  3.28 |  3.79 |  2.99
        Return on assets (%)   |   5.7 |  5.84 |  5.93 |  7.24
        Return on equity (%)   | 19.73 | 17.86 | 17.63 | 23.55
        Debt-equity (%)        |  3.16 |  2.42 |  2.36 |  2.72

    Each row's text is followed by 4 numeric values. The most recent AR
    holds 4 prior years; previous ARs hold their own 4-year window.

    Returns: { 'FY2025': {crar_pct, gnpa_pct, roa_pct, roe_pct}, ...}
    """
    out = {}

    # Find the page that has all four ratio labels on it
    target_pages = []
    for p in range(len(doc)):
        text = doc[p].get_text()
        score = sum(1 for k in [
            "Capital adequacy", "Stage 3 loan assets",
            "Return on assets", "Return on equity",
        ] if k in text)
        if score >= 3:
            target_pages.append((p, text))

    if not target_pages:
        return out

    # The reporting page sits in the corporate overview section (~page 13).
    # Use the earliest matching page (later occurrences are usually
    # subsidiary disclosures with different scales).
    p, text = target_pages[0]

    # Identify the 4-year header — Muthoot prints it as "FY25 FY24 FY23 FY22"
    # (the latest 4 fiscal years in descending order).
    header = re.search(r"FY(\d{2})\s+FY(\d{2})\s+FY(\d{2})\s+FY(\d{2})", text)
    if not header:
        return out
    years = [f"FY20{header.group(i)}" for i in range(1, 5)]

    # Pull each ratio row's 4 trailing numbers
    rows = [
        ("Capital adequacy", "crar_pct"),
        ("Stage 3 loan assets", "gnpa_pct"),
        ("Return on assets", "roa_pct"),
        ("Return on equity", "roe_pct"),
    ]
    for label, key in rows:
        m = re.search(
            re.escape(label) + r"[^\n]*\n([\d.\s\n]+)",
            text,
        )
        if not m:
            continue
        nums = re.findall(r"\d+\.?\d*", m.group(1))[:4]
        for fy, val in zip(years, nums):
            try:
                v = float(val)
                if 0 <= v <= 100:
                    out.setdefault(fy, {})[key] = v
            except ValueError:
                continue
    return out


def extract_muthoot_loan_assets_10yr(doc):
    """Muthoot's 10-year performance review table includes a 'Loan Assets'
    row in ₹ Mn with columns FY25..FY16.

    Returns: { 'FY2025': aum_cr, 'FY2024': aum_cr, ..., 'FY2016': aum_cr }
    The values are converted from ₹ Mn to ₹ Cr (divide by 10).
    """
    out = {}
    for p in range(len(doc)):
        text = doc[p].get_text()
        if "10-year performance review" not in text and "Loan Assets" not in text:
            continue
        m = re.search(
            r"Loan Assets\s*\n([\d,\s\n]+)",
            text,
        )
        if not m:
            continue
        nums = re.findall(r"[\d,]+", m.group(1))[:10]
        if len(nums) < 7:
            continue
        # Values are FY25 (latest) ... FY16 (oldest), in ₹ Mn
        for i, num in enumerate(nums):
            year_int = 2025 - i  # FY25, FY24, FY23, ...
            try:
                v_mn = int(num.replace(",", ""))
                if v_mn > 1000:  # sanity
                    out[f"FY{year_int}"] = round(v_mn / 10, 0)
            except ValueError:
                continue
        if out:
            return out
    return out


def extract_shriram_financial_highlights(doc, fy_label: str):
    """Shriram Finance ARs surface KPIs on a 'Financial Highlights' or
    'Spotlighting Competence' page near the front (page 7-10 typically).

    Layout (FY2024 AR, page 10):
        Rs. 224,862 crore   Assets Under Management (AUM)
        8.84%               Net Interest Margin
        3.13%               Return on Assets
        15.64%              Return on Equity
        5.45%               Gross Stage 3 Assets
        2.70%               Net Stage 3 Assets
        20.30%              Capital to Risk (Weighted) Assets Ratio

    Returns dict for the single current FY of this AR.
    """
    record = {}

    # Score pages by how many of the labels appear together
    candidates = []
    for p in range(len(doc)):
        text = doc[p].get_text()
        score = sum(1 for k in [
            "Capital to Risk", "Capital Adequacy",
            "Gross Stage 3", "Net Stage 3",
            "Return on Asset", "Return on Equity",
            "Net Interest Margin", "Assets Under Management", "AUM",
        ] if k in text)
        if score >= 3:
            candidates.append((p, text, score))

    if not candidates:
        return record

    # Highest-scoring page is the KPI summary
    candidates.sort(key=lambda x: -x[2])
    p, text, _ = candidates[0]

    # Detect page layout. Older Shriram ARs (FY2023, FY2024) print
    # "VALUE %\nLABEL" — the value sits BEFORE the label. The newer FY2025
    # AR uses a tabular "Particulars\nFY25\nFY24\n%Change" layout where the
    # value comes AFTER the label.
    #
    # Heuristic: presence of "% Change" header signals the LABEL→VALUE
    # tabular layout. Otherwise default to VALUE→LABEL.
    value_first = "% Change" not in text and "%Change" not in text

    def _grab_pct(label_pat, lo=0.0, hi=100.0):
        if value_first:
            patterns = [
                # VALUE % \n LABEL — FY2023/FY2024 ARs. Forbid digits and '%'
                # in the connector so we don't span past a neighbouring row.
                r"(\d+\.?\d*)\s*%\s*\n[^%\d]{0,60}?" + label_pat,
            ]
        else:
            patterns = [
                # LABEL [optional (%) suffix] \n VALUE % — FY2025 tabular AR.
                # The label may carry a "(%)" suffix and span one wrapped line
                # before the figure. Connector forbids new digits/labels.
                label_pat + r"[\s\(\)%a-zA-Z]{0,40}?\n[^\d\-%]*?(\d+\.?\d*)\s*%",
            ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE | re.DOTALL)
            if m:
                try:
                    v = float(m.group(1))
                    if lo <= v <= hi:
                        return v
                except ValueError:
                    pass
        return None

    record["crar_pct"] = _grab_pct(
        r"(?:Capital\s+to\s+Risk(?:\s|\n)*\([^\)]*\)(?:\s|\n)*Assets?\s+Ratio|Capital\s+Adequacy\s+Ratio)", 5, 50)
    record["gnpa_pct"] = _grab_pct(r"Gross\s+Stage\s*3", 0, 30)
    record["nnpa_pct"] = _grab_pct(r"Net\s+Stage\s*3", 0, 30)
    record["roa_pct"] = _grab_pct(r"Return\s+on\s+(?:Total\s+)?Assets?", 0, 30)
    record["roe_pct"] = _grab_pct(r"Return\s+on\s+(?:Net\s+Worth|Equity)", 0, 60)
    record["nim_pct"] = _grab_pct(r"Net\s+Interest\s+Margin", 0, 30)

    # AUM in Rs. crores: scan ALL pages for the largest authoritative mention.
    # FY2023's KPI page omits AUM; it appears in the management commentary
    # section (~page 23). FY2025 puts AUM in the chairman's letter and
    # AUM-trend chart, not on the ratios page.
    aum_candidates = []
    for q in range(len(doc)):
        ptext = doc[q].get_text()
        if "AUM" not in ptext and "Assets Under Management" not in ptext and "Assets under management" not in ptext:
            continue
        # Pattern A: "Rs. NNN,NNN[.NN] crore[s]" \n "Assets Under Management (AUM)"
        for m in re.finditer(
            r"Rs\.?\s*([\d,]{4,})(?:\.\d+)?\s*crore[s]?\s*\n[^\n]{0,80}?(?:Assets?\s+[Uu]nder\s+[Mm]anagement|AUM)",
            ptext, re.IGNORECASE | re.DOTALL,
        ):
            try:
                v = float(m.group(1).replace(",", ""))
                if 50_000 < v < 5_000_000:
                    aum_candidates.append(v)
            except ValueError:
                continue
        # Pattern B: "AUM ... Rs. NNN,NNN[.NN] crore[s]" with line break tolerance
        for m in re.finditer(
            r"(?:Assets?\s+[Uu]nder\s+[Mm]anagement|AUM)[\s\(\)A-Za-z\.,\n]{0,80}?Rs\.?\s*([\d,]{4,})(?:\.\d+)?\s*crore[s]?",
            ptext, re.IGNORECASE | re.DOTALL,
        ):
            try:
                v = float(m.group(1).replace(",", ""))
                if 50_000 < v < 5_000_000:
                    aum_candidates.append(v)
            except ValueError:
                continue
        # Pattern C: prose "AUM ... touching Rs. NNN,NNN[.NN] crores"
        for m in re.finditer(
            r"AUM[^\.]{0,120}?(?:touching|reaching|stood\s+at|of)\s+Rs\.?\s*([\d,]{4,})(?:\.\d+)?\s*crore[s]?",
            ptext, re.IGNORECASE | re.DOTALL,
        ):
            try:
                v = float(m.group(1).replace(",", ""))
                if 50_000 < v < 5_000_000:
                    aum_candidates.append(v)
            except ValueError:
                continue
        # Pattern D: "AUM of Rs. NNN,NNN[.NN] crore" (Shriram FY2023, MDA section)
        for m in re.finditer(
            r"AUM\s+of\s+Rs\.?\s*([\d,]{4,})(?:\.\d+)?\s*crore[s]?",
            ptext, re.IGNORECASE | re.DOTALL,
        ):
            try:
                v = float(m.group(1).replace(",", ""))
                if 50_000 < v < 5_000_000:
                    aum_candidates.append(v)
            except ValueError:
                continue

    if aum_candidates:
        # Closing AUM is the largest authoritative mention; prior-year anchors
        # in the same prose are smaller. This avoids YoY-anchor leakage.
        record["aum_cr"] = max(aum_candidates)

    # Drop None values for clean merge semantics
    record = {k: v for k, v in record.items() if v is not None}
    record["_source_page"] = p + 1
    return record


# ─── Per-AR processing ───────────────────────────────────────────────


def process_single_ar(pdf_path: Path, fy_label: str, ticker: str = "BAJFINANCE") -> dict:
    print(f"  Processing {fy_label}...")
    doc = fitz.open(str(pdf_path))

    record = {
        "period_end": fiscal_year_end(fy_label),
        "fiscal_label": fy_label,
        "source_doc": pdf_path.name,
        "source_page": None,
        "source_notes": "",
    }

    if ticker == "SHRIRAMFIN":
        # Shriram has a single-page financial-highlights summary per AR
        sh = extract_shriram_financial_highlights(doc, fy_label)
        record["source_page"] = sh.pop("_source_page", None)
        record.update(sh)
    elif ticker == "MUTHOOTFIN":
        # Muthoot's per-AR extraction is handled at the ticker level (one AR
        # provides 4 years of ratios + 10 years of AUM). The single-AR pass
        # only stamps the source_doc; merging happens in process_ticker.
        pass
    else:
        # Default: Bajaj-style key-ratios + stage table + AUM regex
        key_ratios, kr_page = extract_key_ratios_table(doc)
        record.update(key_ratios)

        stage, stage_page = extract_stage_distribution(doc)
        record.update(stage)

        aum = extract_aum(doc)
        record.update(aum)

        off_book = extract_off_book_share(doc)
        if off_book is not None:
            record["off_book_share_pct"] = off_book

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
            periods.append(process_single_ar(pdf, fy_label, ticker))
        except Exception as e:
            print(f"  WARN: {fy_label} failed: {e}")

    # Muthoot-specific: merge multi-year data from the latest AR.
    # The FY2025 AR carries 4 years of ratios (FY22-25) and 10 years of AUM.
    if ticker == "MUTHOOTFIN" and pdfs:
        latest = sorted(pdfs)[-1]
        doc = fitz.open(str(latest))
        try:
            multi_ratios = extract_muthoot_multi_year_ratios(doc)
            multi_aum = extract_muthoot_loan_assets_10yr(doc)
        finally:
            doc.close()

        # Index periods by fiscal_label for easy merge
        by_fy = {p["fiscal_label"]: p for p in periods}
        # Add periods we don't yet have (the AUM table extends back to FY2016)
        all_fys = set(multi_ratios.keys()) | set(multi_aum.keys())
        for fy in sorted(all_fys):
            if fy not in by_fy:
                by_fy[fy] = {
                    "period_end": fiscal_year_end(fy),
                    "fiscal_label": fy,
                    "source_doc": latest.name,
                    "source_page": 13,
                    "source_notes": f"Backfilled from {latest.name} (10-year table).",
                }
                periods.append(by_fy[fy])

        # Merge ratios (only fill missing keys — don't overwrite per-AR extraction)
        for fy, ratios in multi_ratios.items():
            if fy in by_fy:
                for k, v in ratios.items():
                    by_fy[fy].setdefault(k, v)

        # Merge AUM (₹ Cr)
        for fy, aum_cr in multi_aum.items():
            if fy in by_fy and by_fy[fy].get("aum_cr") is None:
                by_fy[fy]["aum_cr"] = aum_cr

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
