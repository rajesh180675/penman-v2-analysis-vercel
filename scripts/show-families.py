import sys, json

data = json.load(sys.stdin)
print("Family scores:")
for fam in data["families"]:
    print(f"  {fam['label']}: {fam['score']:.1f}/100 ({fam['status']})")
print(f"\nOverall: {data['overallScore']:.1f}/100")
print(f"Rating: {data['rating']}")
