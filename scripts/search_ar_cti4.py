
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
    
    for page_num, page in enumerate(doc):
        text = page.get_text()
        for line in text.split('\n'):
            if re.search(r'net\s+interest\s+income|NII|interest\s+earned|interest\s+expended|interest\s+income', line, re.IGNORECASE):
                clean = line.strip()[:150]
                if any(c.isdigit() for c in clean):
                    print(f"FY{fy} p{page_num+1}: {clean}")
    doc.close()
