
import fitz
import re
import sys

ar_dir = sys.argv[1]
for fy in ['2014','2015','2016','2017','2018']:
    pdf_path = f"{ar_dir}/BAJFINANCE_AR_FY{fy}.pdf"
    try:
        doc = fitz.open(pdf_path)
    except:
        continue
    
    # Search for pages with "Key" or "Financial Highlights" or "Ratios"
    for page_num, page in enumerate(doc):
        text = page.get_text()
        if re.search(r'(?:Key|Financial)\s+(?:Ratios|Highlights|Performance)', text, re.IGNORECASE):
            # Print the whole page (truncated)
            lines = text.split('\n')
            print(f"\n=== FY{fy} p{page_num+1} ===")
            for line in lines[:40]:
                if line.strip():
                    print(f"  {line.strip()[:120]}")
    doc.close()
