
import fitz
import re
import sys

ar_dir = sys.argv[1]
for fy in ['2015','2018','2021','2023']:
    pdf_path = f"{ar_dir}/BAJFINANCE_AR_FY{fy}.pdf"
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"FY{fy}: could not open - {e}")
        continue
    
    found = False
    for page_num, page in enumerate(doc):
        text = page.get_text()
        # Search for cost-to-income related phrases
        for pattern in [r'cost.{0,5}to.{0,5}income', r'operating.{0,5}cost.{0,5}ratio', 
                       r'opex.{0,5}to.{0,5}nti', r'expense.{0,5}ratio', r'efficiency.{0,5}ratio',
                       r'operating.{0,5}expenses.{0,5}to', r'cost.{0,5}income',
                       r'income.{0,5}ratio', r'Operating Cost']:
            matches = list(re.finditer(pattern, text, re.IGNORECASE))
            if matches:
                for m in matches[:2]:
                    ctx = text[max(0,m.start()-80):m.end()+120].replace('\n',' ').strip()
                    print(f"FY{fy} p{page_num+1}: [{pattern[:30]}] ...{ctx}...")
                found = True
                break
        if found:
            break
    if not found:
        print(f"FY{fy}: NO cost-to-income phrase found in any page")
    doc.close()
