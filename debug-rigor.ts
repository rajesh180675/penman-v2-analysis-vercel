import { auditCompanyRun } from './scripts/lib/auditCompanyRun.js';
import { readFileSync } from 'fs';

const registry = JSON.parse(readFileSync('public/data/companies/registry.json', 'utf8'));
const company = registry.find(c => c.ticker === 'ASIANPAINT');

async function main() {
  const result = await auditCompanyRun(company, { projectRoot: process.cwd() });
  console.log('Rigor:', JSON.stringify(result.rigor, null, 2));
  console.log('Parser Fidelity Status:', result.parserFidelityStatus);
  console.log('Reconciliation Status:', result.reconciliationStatus);
}

main().catch(console.error);
