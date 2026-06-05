import sys, json
from collections import Counter

data = json.load(sys.stdin)
print(f"Overall score: {data['overallScore']}/100")
print(f"Rating: {data['rating']}")
print(f"\nBlocker counts:")
for family, count in sorted(data["corpus"]["blockerCounts"].items()):
    print(f"  {family}: {count}")
print(f"\nProduction-ready checkpoint status:")
pass_count = sum(1 for row in data["rowSummaries"] if row.get("productionReady", {}).get("status") == "pass")
blocked_count = sum(1 for row in data["rowSummaries"] if row.get("productionReady", {}).get("status") == "blocked")
print(f"  pass: {pass_count}")
print(f"  blocked: {blocked_count}")
print(f"\nTop 5 most common failed checkpoints:")
failed = Counter()
for row in data["rowSummaries"]:
    for cp in row.get("productionReady", {}).get("checkpoints", []):
        if cp["status"] != "pass":
            failed[cp["id"]] += 1
for cp_id, count in failed.most_common(5):
    print(f"  {cp_id}: {count} rows")
