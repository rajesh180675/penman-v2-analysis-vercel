
import fitz
import re
import sys

ar_dir = sys.argv[1]
for fy in ['2014','2015','2016','2017','2018']:
    pdf_path = f"{ar_dir}/BAJFINANCE_AR_FY{fy}.pdf"
    doc = fitz.open(pdf_path)
    
    nii = None
    opex = None
    interest_charges = None
    total_income = None
    
    for page in doc:
        text = page.get_text()
        
        # NII
        m = re.search(r'[Nn]et\s+interest\s+income\s+(?:increased\s+by\s+\d+%\s+to\s+)?[R\u20b9H]?\s*([\d,]+(?:\.\d+)?)', text)
        if m and nii is None:
            nii = float(m.group(1).replace(',',''))
        
        # Operating cost
        m2 = re.search(r'[Tt]otal\s+operating\s+(?:cost|expenses?)[\s:]+(?:up\s+(?:by\s+)?\d+%\s+to\s+)?[R\u20b9H]?\s*([\d,]+(?:\.\d+)?)', text)
        if m2 and opex is None:
            opex = float(m2.group(1).replace(',',''))
        
        # Interest/finance charges  
        m3 = re.search(r'[Ii]nterest\s+(?:and\s+finance\s+)?charges\s+(?:increased\s+by\s+\d+%\s+to\s+)?[R\u20b9H]?\s*([\d,]+(?:\.\d+)?)', text)
        if m3 and interest_charges is None:
            interest_charges = float(m3.group(1).replace(',',''))
        
        # Total income
        m4 = re.search(r'[Tt]otal\s+income\s+(?:up\s+\d+%\s+to\s+)?[R\u20b9H]?\s*([\d,]+(?:\.\d+)?)', text)
        if m4 and total_income is None:
            total_income = float(m4.group(1).replace(',',''))
    
    if nii and opex and nii > 0:
        ratio = round(opex / nii * 100, 2)
        print(f"FY{fy}: {ratio}% (opex={opex}, NII={nii}, total_income={total_income})")
    else:
        print(f"FY{fy}: INCOMPLETE (opex={opex}, NII={nii}, total_income={total_income})")
    
    doc.close()
