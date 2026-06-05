import sys, json

data = json.load(sys.stdin)

print("=== VALUATION MODEL QUALITY (what you care about) ===")
for fam in data["families"]:
    if "valuation" in fam["label"].lower() or "paradigm" in fam["label"].lower():
        print(f"{fam['label']}: {fam['score']}/100 ({fam['status']})")
        if fam["evidence"]:
            print(f"  Evidence: {fam['evidence'][:150]}...")

print()
print("=== INFRASTRUCTURE GAPS (dragging score down) ===")
for fam in data["families"]:
    if "freshness" in fam["label"].lower() or "workbook" in fam["label"].lower() or "traceability" in fam["label"].lower():
        print(f"{fam['label']}: {fam['score']}/100 ({fam['status']})")
        if fam["blockers"]:
            print(f"  Blockers: {fam['blockers'][:150]}...")

print()
print("=== ROW-LEVEL BLOCKERS (what's actually broken) ===")
blocker_counts = {}
for row in data["rowSummaries"]:
    for blocker in row["blockers"]:
        code = blocker["code"]
        blocker_counts[code] = blocker_counts.get(code, 0) + 1

for code, count in sorted(blocker_counts.items(), key=lambda x: -x[1]):
    print(f"  {code}: {count} rows")
