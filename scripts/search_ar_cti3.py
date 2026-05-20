
import fitz
import re
import sys

ar_dir = sys.argv[1]
for fy in ['2014','2015','2016','2017','2018','2022']:
    pdf_path = f"{ar_dir}/BAJFINANCE_AR_FY{fy}.pdf"
    try:
        doc = fitz.open(pdf_path)
    except:
        continue
    
    for page_num, page in enumerate(doc):
        text = page.get_text()
        # Look for any line containing "operating cost" or "operating expense" with a number
        for line in text.split('\n'):
            if re.search(r'operating\s+(?:cost|expense)', line, re.IGNORECASE):
                # Clean and show
                clean = line.strip()[:150]
                if clean and any(c.isdigit() for c in clean):
                    print(f"FY{fy} p{page_num+1}: {clean}")
    doc.close()
