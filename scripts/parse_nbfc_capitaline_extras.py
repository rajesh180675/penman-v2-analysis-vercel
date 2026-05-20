"""
Parse Bajaj Finance Capitaline extra data exports:
  - RBI NHB Banks (consolidated): GNPA, NNPA, CRAR, Tier-1, NPA movements, provisions
  - Loss Given Default (consolidated): Stage 1/2/3 migration matrix per year
  - Subsidiaries: per-sub equity, PAT, total assets/liabilities

Produces an enriched quality_indicators.json that supersedes the regex-based
AR extraction. Retains AUM/AUM-growth from the AR extractor (not available
in Capitaline), merges everything else from structured source.

Usage:
    python scripts/parse_nbfc_capitaline_extras.py [COMPANY_FOLDER]

    COMPANY_FOLDER defaults to "Bajaj Finance"
"""

import json
import glob
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


# ─── HTML table parser (reusable) ────────────────────────────────────────────

class CapitalineTableParser(HTMLParser):
    """Parse Capitaline's HTML-as-XLS format into a list of rows."""

    def __init__(self):
        super().__init__()
        self.in_cell = False
        self.rows: list[list[str]] = []
        self.current_row: list[str] = []
        self.current_cell = ""

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.current_row = []
        elif tag in ("td", "th"):
            self.in_cell = True
            self.current_cell = ""

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self.in_cell = False
            self.current_row.append(self.current_cell.strip())
        elif tag == "tr":
            if self.current_row:
                self.rows.append(self.current_row)

    def handle_data(self, data):
        if self.in_cell:
            self.current_cell += data


def parse_html_table(filepath: str) -> list[list[str]]:
    """Read an HTML-XLS file and return parsed rows."""
    with open(filepath, encoding="utf-8") as f:
        html = f.read()
    p = CapitalineTableParser()
    p.feed(html)
    return p.rows


def parse_float(s: str) -> float | None:
    """Parse a Capitaline numeric cell. Returns None for empty/dash/zero-text."""
    s = s.strip().replace(",", "")
    if not s or s == "-" or s == "":
        return None
    try:
        v = float(s)
        return v
    except ValueError:
        return None


# ─── RBI NHB Banks Parser ────────────────────────────────────────────────────

def parse_rbi_nhb(filepath: str) -> dict[str, dict]:
    """
    Parse the RBI NHB Banks consolidated export.
    Returns {fiscal_year: {field: value}} e.g. {"FY2025": {"gnpa_cr": 3677.75, ...}}
    """
    rows = parse_html_table(filepath)
    if len(rows) < 3:
        return {}

    # Row 1 is the year header: ['Year', '202503', '202403', ...]
    year_row = rows[1]
    years = year_row[1:]  # ['202503', '202403', ...]

    # Convert '202503' -> 'FY2025'
    def to_fy(s):
        if len(s) >= 4:
            return f"FY{s[:4]}"
        return s

    fy_labels = [to_fy(y) for y in years]

    # Build a label -> values dict for all data rows
    label_map = {}
    for row in rows[2:]:
        if not row or not row[0]:
            continue
        label = row[0].strip()
        values = row[1:]
        label_map[label] = values

    # Extract the fields we care about
    result = {}
    for i, fy in enumerate(fy_labels):
        period = {}

        def get(label):
            vals = label_map.get(label, [])
            return parse_float(vals[i]) if i < len(vals) else None

        # Core NPA metrics
        period["gnpa_cr"] = get("Gross Non-Performing Assets")
        period["nnpa_cr"] = get("Net Non Performing Assets")
        period["nnpa_pct"] = get("% of Net Non-Performing Assets to Net Advance")
        # Note: "% of Gross Non-Performing Assets" is 0 for NBFCs in Capitaline

        # Capital adequacy (Basel I is what RBI uses for NBFCs)
        period["crar_pct"] = get("Capital Adequacy Ratio (%) - Basel I")
        period["tier1_pct"] = get("Tier I Capital (%)")
        period["tier2_pct"] = get("Tier II Capital (%)")

        # NPA movements - Gross
        period["gnpa_opening"] = get("Opening Balance of Gross NPAs")
        period["gnpa_additions"] = get("Additions of Gross NPAs")
        period["gnpa_reductions"] = get("Reductions of Gross NPAs")
        period["gnpa_closing"] = get("Closing Balance of Gross NPAs")

        # NPA movements - Net
        period["nnpa_opening"] = get("Opening Balance of Net NPAs")
        period["nnpa_additions"] = get("Additions of Net NPAs")
        period["nnpa_reductions"] = get("Reductions of Net NPAs")
        period["nnpa_closing"] = get("Closing Balance of Net NPAs")

        # Provisions movement
        period["provisions_opening"] = get("Opening Balance")
        period["provisions_made"] = get("Provisions made during the Year")
        period["provisions_writeback"] = get("Write-off/write-back of excess provisions")
        period["provisions_closing"] = get("Closing Balance")

        # Sector advances (partially populated)
        period["adv_capital_market"] = get("Advance to Capital Market Sector")
        period["adv_real_estate"] = get("Advance to Real Estate Sector")

        result[fy] = period

    return result


# ─── Loss Given Default (Stage Migration) Parser ─────────────────────────────

# Map Gross Closing Total to fiscal year (from known AR data)
# We'll use the Closing Balance total to identify the year
KNOWN_GROSS_TOTALS = {
    # total_cr -> FY label (approximate matching within 1%)
    414826.50: "FY2025",
    331334.35: "FY2024",
    246635.68: "FY2023",  # approximate
    195828.04: "FY2022",
    145100.41: "FY2021",
    114570.40: "FY2020",
    80633.08: "FY2019",
}


def identify_lgd_year(gross_total: float) -> str | None:
    """Match a Gross Closing Balance total to a fiscal year."""
    for known, fy in KNOWN_GROSS_TOTALS.items():
        if abs(gross_total - known) / known < 0.01:  # 1% tolerance
            return fy
    return None


def parse_lgd_file(filepath: str) -> dict | None:
    """
    Parse a single LGD file. Returns:
    {
        "fiscal_year": "FY2025",
        "gross": {"stage1": ..., "stage2": ..., "stage3": ..., "total": ...},
        "ecl": {"stage1": ..., "stage2": ..., "stage3": ..., "total": ...},
        "migrations": {...}
    }
    """
    rows = parse_html_table(filepath)
    if len(rows) < 12:
        return None

    # Parse Gross Carrying Amount section (rows 1-12 typically)
    gross = {}
    ecl = {}
    in_ecl = False
    migrations = {}

    for row in rows:
        if not row:
            continue
        if len(row) >= 2 and "Expected Credit Loss" in row[1]:
            in_ecl = True
            continue

        label = row[0].strip() if row else ""
        if label in ("", "Disclaimer:-"):
            continue

        # Parse the 4-column section (Stage 1, Stage 2, Stage 3, Total)
        if len(row) >= 5:
            s1 = parse_float(row[1])
            s2 = parse_float(row[2])
            s3 = parse_float(row[3])
            total = parse_float(row[4])

            target = ecl if in_ecl else gross

            if label == "Closing Balance":
                target["closing_s1"] = s1
                target["closing_s2"] = s2
                target["closing_s3"] = s3
                target["closing_total"] = total
            elif label == "Opening Balance":
                target["opening_s1"] = s1
                target["opening_s2"] = s2
                target["opening_s3"] = s3
                target["opening_total"] = total
            elif label == "Write off during the Year" and not in_ecl:
                migrations["writeoffs"] = s3  # only Stage 3 has writeoffs
            elif label == "Transfers To Stage 3" and not in_ecl:
                migrations["transfers_to_s3_from_s1"] = s1
                migrations["transfers_to_s3_from_s2"] = s2
            elif label == "Transfers To Stage 1" and not in_ecl:
                migrations["upgrades_to_s1_from_s2"] = s2
                migrations["upgrades_to_s1_from_s3"] = s3
            elif label == "New Business-Net of Recovery" and not in_ecl:
                migrations["new_business_s1"] = s1
                migrations["new_business_total"] = total

    # Identify year from gross closing total
    gross_total = gross.get("closing_total")
    if gross_total is None:
        return None

    fy = identify_lgd_year(gross_total)
    if fy is None:
        # Try to infer from order — caller will handle
        fy = f"UNKNOWN_{gross_total:.0f}"

    return {
        "fiscal_year": fy,
        "gross": gross,
        "ecl": ecl,
        "migrations": migrations,
    }


def parse_all_lgd(folder: str) -> dict[str, dict]:
    """Parse all LGD files in a folder. Returns {FY: {data}}."""
    files = glob.glob(os.path.join(folder, "*.xls"))
    result = {}
    for f in sorted(files):
        parsed = parse_lgd_file(f)
        if parsed and not parsed["fiscal_year"].startswith("UNKNOWN"):
            result[parsed["fiscal_year"]] = parsed
    return result


# ─── Subsidiaries Parser ─────────────────────────────────────────────────────

def parse_subsidiaries_file(filepath: str) -> dict | None:
    """
    Parse a single Subsidiaries file. Returns:
    {
        "fiscal_year": "FY2024",
        "subsidiaries": [
            {"name": "Bajaj Housing Finance Ltd", "year_end": "202403", ...},
            ...
        ]
    }
    """
    rows = parse_html_table(filepath)
    if len(rows) < 5:
        return None

    # Row structure:
    #   Row 0: title ("Finance >>Subsidiaries>>Bajaj Finance Ltd...")
    #   Row 1: header with subsidiary names ("Subsidiaries", "Bajaj Financial Securities Ltd", "Bajaj Housing Finance Ltd")
    #   Row 2+: data rows starting with "Year End"

    # Find the names row (label is "Subsidiaries" or contains subsidiary names)
    sub_names = []
    for row in rows:
        if row and row[0].strip() == "Subsidiaries":
            sub_names = [n.strip() for n in row[1:] if n.strip() and n.strip() != "-"]
            break

    # Find Year End row to get the year and number of subsidiaries
    year_row = None
    year_row_idx = None
    for i, row in enumerate(rows):
        if row and "Year End" in row[0]:
            year_row = row
            year_row_idx = i
            break

    if year_row is None:
        return None

    years = year_row[1:]  # e.g. ['202403', '202403']
    num_subs = len(years)
    fy = f"FY{years[0][:4]}" if years else None
    if fy is None:
        return None

    # Parse all field rows after Year End
    fields = {}
    for row in rows[year_row_idx + 1:]:
        if not row or row[0].strip() in ("", "Disclaimer:-"):
            continue
        label = row[0].strip()
        values = row[1:num_subs + 1]
        fields[label] = values

    # Build subsidiary entries
    subs = []
    for idx in range(num_subs):
        def get_field(label):
            vals = fields.get(label, [])
            return parse_float(vals[idx]) if idx < len(vals) else None

        sub = {
            "name": sub_names[idx] if idx < len(sub_names) else f"Subsidiary {idx + 1}",
            "year_end": years[idx] if idx < len(years) else None,
            "holding_pct": get_field("Holding -%"),
            "investment_cost": get_field("Investment Cost"),
            "equity_subscribed": get_field("Equity Subscribed"),
            "reserves": get_field("Subsidiary 's Reserves"),
            "sales_turnover": get_field("Sales Turnover"),
            "pat": get_field("Profit After Tax"),
            "total_assets": get_field("Total Assets"),
            "total_liabilities": get_field("Total Liabilities"),
            "country": fields.get("Country", [None] * num_subs)[idx] if idx < len(fields.get("Country", [])) else None,
        }
        subs.append(sub)

    return {"fiscal_year": fy, "subsidiaries": subs}


def parse_all_subsidiaries(folder: str) -> dict[str, dict]:
    """Parse all Subsidiaries files. Returns {FY: {data}}."""
    files = glob.glob(os.path.join(folder, "*.xls"))
    result = {}
    for f in sorted(files):
        parsed = parse_subsidiaries_file(f)
        if parsed:
            result[parsed["fiscal_year"]] = parsed
    return result


# ─── Merge into quality_indicators.json ──────────────────────────────────────

def merge_into_quality_indicators(
    company_folder: str,
    rbi_data: dict[str, dict],
    lgd_data: dict[str, dict],
    subs_data: dict[str, dict],
):
    """
    Merge structured Capitaline data into the existing quality_indicators.json.
    Preserves AUM/AUM-growth from the AR extractor (not in Capitaline).
    Overwrites NPA/CRAR/Stage/ECL fields with structured source.
    Adds NPA movements, provisions movements, subsidiaries.
    """
    qi_path = os.path.join(company_folder, "quality_indicators.json")

    # Load existing (preserves AR-extracted AUM data)
    existing = {}
    if os.path.exists(qi_path):
        with open(qi_path, "r") as f:
            existing = json.load(f)

    existing_periods = {p["fiscal_label"]: p for p in existing.get("periods", [])}

    # Determine all fiscal years across all sources
    all_fys = sorted(
        set(list(rbi_data.keys()) + list(lgd_data.keys()) + list(existing_periods.keys())),
        key=lambda x: int(re.search(r"\d+", x).group()) if re.search(r"\d+", x) else 0,
    )

    periods = []
    for fy in all_fys:
        # Start with existing period data (preserves AUM, etc.)
        period = existing_periods.get(fy, {"fiscal_label": fy, "period_end": f"{fy[2:]}-03-31"})

        # Merge RBI NHB data (overwrites regex-extracted NPA/CRAR)
        rbi = rbi_data.get(fy, {})
        if rbi:
            # Core ratios — overwrite only if RBI has non-zero data
            if rbi.get("crar_pct") and rbi["crar_pct"] > 0:
                period["crar_pct"] = rbi["crar_pct"]
            if rbi.get("tier1_pct") and rbi["tier1_pct"] > 0:
                period["tier1_pct"] = rbi["tier1_pct"]
            if rbi.get("nnpa_pct") and rbi["nnpa_pct"] > 0:
                period["nnpa_pct"] = rbi["nnpa_pct"]

            # Absolute NPA values
            if rbi.get("gnpa_cr") is not None:
                period["gnpa_cr"] = rbi["gnpa_cr"]
            if rbi.get("nnpa_cr") is not None:
                period["nnpa_cr"] = rbi["nnpa_cr"]

            # NPA movements
            if rbi.get("gnpa_opening") is not None:
                period["gnpa_opening_cr"] = rbi["gnpa_opening"]
                period["gnpa_additions_cr"] = rbi["gnpa_additions"]
                period["gnpa_reductions_cr"] = rbi["gnpa_reductions"]
                period["gnpa_closing_cr"] = rbi["gnpa_closing"]

            # Net NPA movements
            if rbi.get("nnpa_opening") is not None:
                period["nnpa_opening_cr"] = rbi["nnpa_opening"]
                period["nnpa_additions_cr"] = rbi["nnpa_additions"]
                period["nnpa_reductions_cr"] = rbi["nnpa_reductions"]
                period["nnpa_closing_cr"] = rbi["nnpa_closing"]

            # Provisions movements
            if rbi.get("provisions_opening") is not None:
                period["provisions_opening_cr"] = rbi["provisions_opening"]
                period["provisions_made_cr"] = rbi["provisions_made"]
                period["provisions_writeback_cr"] = rbi["provisions_writeback"]
                period["provisions_closing_cr"] = rbi["provisions_closing"]

            # Compute PCR from movements: closing provisions / closing gross NPA
            gnpa_closing = rbi.get("gnpa_closing") or rbi.get("gnpa_cr")
            prov_closing = rbi.get("provisions_closing")
            if gnpa_closing and prov_closing and gnpa_closing > 0:
                period["pcr_pct"] = round(prov_closing / gnpa_closing * 100, 2)

            # Sector advances (partially populated)
            if rbi.get("adv_capital_market") and rbi["adv_capital_market"] > 0:
                period["adv_capital_market_cr"] = rbi["adv_capital_market"]
            if rbi.get("adv_real_estate") and rbi["adv_real_estate"] > 0:
                period["adv_real_estate_cr"] = rbi["adv_real_estate"]

        # Merge LGD (Stage migration) data
        lgd = lgd_data.get(fy, {})
        if lgd:
            gross = lgd.get("gross", {})
            ecl = lgd.get("ecl", {})
            migrations = lgd.get("migrations", {})

            # Stage distribution (% of total)
            total = gross.get("closing_total")
            if total and total > 0:
                s1 = gross.get("closing_s1")
                s2 = gross.get("closing_s2")
                s3 = gross.get("closing_s3")
                if s3 is not None:
                    period["stage3_pct"] = round(s3 / total * 100, 2)
                if s2 is not None:
                    period["stage2_pct"] = round(s2 / total * 100, 2)
                # Stage 1 is implicit (100 - s2 - s3)

                # Absolute stage values
                period["stage1_cr"] = s1
                period["stage2_cr"] = s2
                period["stage3_cr"] = s3
                period["total_loan_book_cr"] = total

            # ECL coverage on Stage 3
            ecl_s3 = ecl.get("closing_s3")
            gross_s3 = gross.get("closing_s3")
            if ecl_s3 and gross_s3 and gross_s3 > 0:
                period["ecl_coverage_pct"] = round(ecl_s3 / gross_s3 * 100, 2)

            # Total ECL / total book
            ecl_total = ecl.get("closing_total")
            if ecl_total and total and total > 0:
                period["total_ecl_pct"] = round(ecl_total / total * 100, 2)

            # Migration velocity
            if migrations.get("transfers_to_s3_from_s1") is not None:
                period["slippage_s1_to_s3_cr"] = abs(migrations["transfers_to_s3_from_s1"])
            if migrations.get("transfers_to_s3_from_s2") is not None:
                period["slippage_s2_to_s3_cr"] = abs(migrations["transfers_to_s3_from_s2"])
            if migrations.get("upgrades_to_s1_from_s3") is not None:
                period["upgrades_s3_to_s1_cr"] = abs(migrations["upgrades_to_s1_from_s3"])
            if migrations.get("writeoffs") is not None:
                period["writeoffs_cr"] = abs(migrations["writeoffs"])
            if migrations.get("new_business_total") is not None:
                period["new_origination_cr"] = migrations["new_business_total"]

        # Merge Subsidiaries data
        subs = subs_data.get(fy, {})
        if subs and subs.get("subsidiaries"):
            sub_summary = []
            for sub in subs["subsidiaries"]:
                sub_summary.append({
                    "name": sub.get("name"),
                    "equity_cr": sub.get("equity_subscribed"),
                    "reserves_cr": sub.get("reserves"),
                    "investment_cost_cr": sub.get("investment_cost"),
                    "pat_cr": sub.get("pat"),
                    "total_assets_cr": sub.get("total_assets"),
                    "total_liabilities_cr": sub.get("total_liabilities"),
                    "sales_cr": sub.get("sales_turnover"),
                })
            period["subsidiaries"] = sub_summary
            # Aggregate subsidiary contribution
            total_sub_pat = sum(s.get("pat") or 0 for s in subs["subsidiaries"])
            total_sub_assets = sum(s.get("total_assets") or 0 for s in subs["subsidiaries"])
            if total_sub_pat > 0:
                period["subsidiary_pat_cr"] = total_sub_pat
            if total_sub_assets > 0:
                period["subsidiary_assets_cr"] = total_sub_assets

        periods.append(period)

    # Compute GNPA % where we have both closing GNPA and total loan book
    for period in periods:
        gnpa_cr = period.get("gnpa_cr") or period.get("gnpa_closing_cr")
        total_book = period.get("total_loan_book_cr")
        if gnpa_cr and total_book and total_book > 0 and not period.get("gnpa_pct"):
            period["gnpa_pct"] = round(gnpa_cr / total_book * 100, 2)

    # Compute slippage % = GNPA additions / opening total loan book (prior year)
    for i, period in enumerate(periods):
        additions = period.get("gnpa_additions_cr")
        if additions and i > 0:
            prior_book = periods[i - 1].get("total_loan_book_cr")
            if prior_book and prior_book > 0:
                period["slippage_pct"] = round(additions / prior_book * 100, 2)

    # Determine as_of_date (latest period_end)
    sorted_periods = sorted(
        periods,
        key=lambda p: p.get("period_end", ""),
    )
    as_of_date = sorted_periods[-1]["period_end"] if sorted_periods else ""

    # Build output — schema-conformant for src/engine/bankQualityIndicators.ts
    output = {
        "schema_version": "2026-05-bank-quality-v1",
        "company_name": existing.get("company_name") or existing.get("company") or "Bajaj Finance Ltd",
        "as_of_date": as_of_date,
        "source_notes": (
            "NBFC pipeline (BAJFINANCE). Merged from Capitaline structured exports "
            "(RBI NHB Banks, Credit Risk Analysis - Loss Given Default, Subsidiaries) "
            "via scripts/parse_nbfc_capitaline_extras.py. AUM / AUM-growth retained "
            "from AR-extractor (scripts/extract_nbfc_quality.py)."
        ),
        "ticker": existing.get("ticker", "BAJFINANCE"),
        "scope": "consolidated",
        "periods": periods,
    }

    # Write
    with open(qi_path, "w") as f:
        json.dump(output, f, indent=2)

    return output


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    company_name = sys.argv[1] if len(sys.argv) > 1 else "Bajaj Finance"

    base = Path(__file__).parent.parent / "public" / "data" / "companies" / company_name
    if not base.exists():
        print(f"ERROR: Company folder not found: {base}")
        sys.exit(1)

    rbi_folder = base / "RBI NHB Banks"
    lgd_folder = base / "Loss Given Default"
    subs_folder = base / "Subsidiaries"

    # Parse each source
    rbi_data = {}
    if rbi_folder.exists():
        rbi_files = list(rbi_folder.glob("*.xls"))
        if rbi_files:
            rbi_data = parse_rbi_nhb(str(rbi_files[0]))
            print(f"RBI NHB Banks: {len(rbi_data)} periods parsed")
        else:
            print("RBI NHB Banks: no .xls files found")
    else:
        print("RBI NHB Banks: folder not found")

    lgd_data = {}
    if lgd_folder.exists():
        lgd_data = parse_all_lgd(str(lgd_folder))
        print(f"Loss Given Default: {len(lgd_data)} periods parsed")
    else:
        print("Loss Given Default: folder not found")

    subs_data = {}
    if subs_folder.exists():
        subs_data = parse_all_subsidiaries(str(subs_folder))
        print(f"Subsidiaries: {len(subs_data)} periods parsed")
    else:
        print("Subsidiaries: folder not found")

    # Merge into quality_indicators.json
    output = merge_into_quality_indicators(str(base), rbi_data, lgd_data, subs_data)

    # Summary
    periods = output["periods"]
    total_fields = 0
    filled_fields = 0
    key_fields = [
        "gnpa_cr", "nnpa_pct", "crar_pct", "tier1_pct", "pcr_pct",
        "stage3_pct", "ecl_coverage_pct", "aum_cr", "aum_growth_pct",
        "slippage_pct", "gnpa_additions_cr", "provisions_made_cr",
    ]
    for p in periods:
        for kf in key_fields:
            total_fields += 1
            if p.get(kf) is not None:
                filled_fields += 1

    print(f"\nOutput: {base / 'quality_indicators.json'}")
    print(f"Periods: {len(periods)}")
    print(f"Key field coverage: {filled_fields}/{total_fields} ({filled_fields/total_fields*100:.1f}%)")
    print(f"\nSample (latest period):")
    latest = periods[-1] if periods else {}
    for k in sorted(latest.keys()):
        if k not in ("subsidiaries", "period_end", "fiscal_label"):
            v = latest[k]
            if v is not None:
                print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
