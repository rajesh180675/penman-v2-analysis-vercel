
import fitz
import re
import sys

ar_dir = sys.argv[1]
for fy in ['2014','2015','2016','2017','2018','2019','2020','2021','2022','2023']:
    pdf_path = f"{ar_dir}/BAJFINANCE_AR_FY{fy}.pdf"
    try:
        doc = fitz.open(pdf_path)
    except:
        print(f"FY{fy}: could not open")
        continue
    
    opex = None
    income = None
    ratio = None
    
    for page in doc:
        text = page.get_text()
        
        # Check for explicit ratio first
        m = re.search(r'[Oo]perating\s+expenses?\s+to\s+(?:NII|net\s+total\s+income|NTI)\s+([\d.]+)\s*%', text)
        if m:
            ratio = float(m.group(1))
        
        # Check for "Operating expenses to NII" table format
        m2 = re.search(r'[Oo]perating\s+expenses?\s+to\s+NII\s*([\d.]+)\s*%', text)
        if m2 and ratio is None:
            ratio = float(m2.group(1))
        
        # Check for absolute operating cost
        m3 = re.search(r'[Tt]otal\s+operating\s+cost[:\s]+[R\u20b9]?\s*([\d,]+(?:\.\d+)?)\s*(?:crore|Cr)?', text, re.IGNORECASE)
        if m3 and opex is None:
            opex_str = m3.group(1).replace(',','')
            opex = float(opex_str)
        
        # Check for total income
        m4 = re.search(r'[Tt]otal\s+income[:\s]+(?:up\s+\d+%\s+to\s+)?[R\u20b9]?\s*([\d,]+(?:\.\d+)?)\s*(?:crore|Cr)?', text, re.IGNORECASE)
        if m4 and income is None:
            inc_str = m4.group(1).replace(',','')
            income = float(inc_str)
    
    if ratio:
        print(f"FY{fy}: RATIO={ratio}%")
    elif opex and income and income > 0:
        computed = round(opex / income * 100, 2)
        print(f"FY{fy}: COMPUTED={computed}% (opex={opex}, income={income})")
    else:
        print(f"FY{fy}: NOT_FOUND (opex={opex}, income={income})")
    
    doc.close()
