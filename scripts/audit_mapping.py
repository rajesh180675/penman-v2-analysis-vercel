import json, subprocess

result = subprocess.run(
    ["curl", "-s", "https://penman-v2-analysis-vercel.vercel.app/api/research?kind=comparison-registry"],
    capture_output=True, text=True
)
d = json.loads(result.stdout)
raw = d['companies']['ITC']['rawData']

all_labels = set()
for r in raw:
    all_labels.update(r['raw_metric_values'].keys())

# Try to parse YAML manually (no PyYAML guaranteed)
yaml_labels = set()
with open('/home/user/penman-v2-analysis-vercel/CapitalineIndASDetailedMappingSpec.yaml', 'r') as f:
    for line in f:
        stripped = line.strip()
        if stripped.startswith('- ') or (stripped.startswith('"') and stripped.endswith('"')):
            if stripped.startswith('- '):
                val = stripped[2:].strip().strip('"').strip("'")
            else:
                val = stripped.strip('"').strip("'")
            if len(val) > 2 and not val.startswith('keys:') and not val.startswith('primary:'):
                yaml_labels.add(val)
        elif stripped.startswith('keys:') and ':' not in stripped.split('keys:')[1]:
            pass

# Also extract values after colons that are string values
with open('/home/user/penman-v2-analysis-vercel/CapitalineIndASDetailedMappingSpec.yaml', 'r') as f:
    for line in f:
        stripped = line.strip()
        if stripped.startswith('"') and ':' in stripped:
            val = stripped.split(':')[0].strip('"').strip("'")
            if val and not val.endswith(':'):
                yaml_labels.add(val)
        # Handle keys: ["Value1", "Value2"] format
        if '["' in stripped:
            start = stripped.index('["') + 2
            end = stripped.index('"]')
            items = stripped[start:end].split('", "')
            for item in items:
                yaml_labels.add(item.strip())

matched = yaml_labels & all_labels
unmatched_yaml = yaml_labels - all_labels
data_unmatched = all_labels - yaml_labels

print(f'=== MAPPING COVERAGE ANALYSIS ===')
print(f'Labels defined in YAML spec: {len(yaml_labels)}')
print(f'Labels present in ITC data:  {len(all_labels)}')
print(f'Matched (YAML → ITC):       {len(matched)} ({100*len(matched)/len(all_labels):.1f}% of ITC data)')
print(f'Missed (in YAML, not ITC):  {len(unmatched_yaml)}')
print(f'Unmapped (in ITC, no YAML): {len(data_unmapped)} ({100*len(data_unmapped)/len(all_labels):.1f}% of ITC data)')
print()

# Show top unmapped labels that have actual values
latest_vals = raw[-1]['raw_metric_values']
unmapped_with_values = [(lbl, latest_vals.get(lbl)) for lbl in data_unmatched
                        if latest_vals.get(lbl) is not None and latest_vals.get(lbl) != 0]
unmapped_with_values.sort(key=lambda x: abs(x[1]) if x[1] else 0, reverse=True)

print(f'=== TOP 60 UNMAPPED LABELS WITH VALUES (from FY2025, {len(unmapped_with_values)} total) ===')
for label, val in unmapped_with_values[:60]:
    # Determine statement
    stmt = 'BS' if 'BalanceSheet' in label else ('IS' if 'ProfitLoss' in label else ('CF' if 'CashFlow' in label else 'Other'))
    print(f'  [{stmt}] {val:>15,.2f}  {label}')

# Matched
print(f'\n=== MATCHED LABELS ({len(matched)}) ===')
for label in sorted(matched):
    stmt = 'BS' if 'BalanceSheet' in label else ('IS' if 'ProfitLoss' in label else ('CF' if 'CashFlow' in label else 'Other'))
    vals = [r['raw_metric_values'].get(label) for r in raw]
    non_null = sum(1 for v in vals if v is not None)
    print(f'  ✓ [{stmt}] ({non_null}/15) {label}')

# Unmatched YAML
print(f'\n=== YAML DEFINITIONS NOT IN ITC DATA ({len(unmatched_yaml)}) ===')
for label in sorted(unmatched_yaml):
    print(f'  ⊘ {label}')
