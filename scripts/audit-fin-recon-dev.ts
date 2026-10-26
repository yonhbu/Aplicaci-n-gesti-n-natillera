// Read-only DEV audit. Financial results remain outside the repository; no dotenv or credentials are read.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { originalPrincipalAtCut, reconstructMoney } from '../src/domain/financialReconstruction';
import type { FinancialOperation, LedgerEntry, LoanContract } from '../src/lib/types';

const container = 'supabase_db_natillera-manager';
const binding = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
if (!binding['5432/tcp']?.some((item: { HostPort: string }) => item.HostPort === '44122')) throw Error('Solo DEV44122.');
const sql = (query: string) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: 'begin read only;' + query + ';commit;', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 16e6 }).trim();
const cycles = JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(c)),'[]')from public.cycles c where year=2026 and status='active'"));
if (cycles.length !== 1) throw Error('Se requiere un ciclo DEV 2026 explícito y único.');
const cycle = cycles[0];
if (!/^[a-f0-9-]{36}$/.test(cycle.id)) throw Error('Ciclo inválido.');
const id = "'" + cycle.id + "'";
const operations = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(o)),'[]')from public.financial_operations o where cycle_id=${id}`)) as FinancialOperation[];
const entries = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text)),'[]')from public.ledger_entries e where cycle_id=${id}`)) as LedgerEntry[];
const loans = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('principal',l.principal::text)),'[]')from public.loan_contracts l where cycle_id=${id}`)) as LoanContract[];
const sources = JSON.parse(sql(`select jsonb_build_object(
 'savings',coalesce((select sum(amount)from public.savings_contributions where cycle_id=${id}and status='posted'),0)::text,
 'polla',coalesce((select sum(amount)from public.polla_contributions where cycle_id=${id}and status='posted'),0)::text,
 'principal_delivered',coalesce((select sum(principal)from public.loan_contracts where cycle_id=${id}and status in('active','paid')),0)::text,
 'declared_capital',coalesce((select sum(legacy_paid_capital_amount)from public.loan_contracts where cycle_id=${id}),0)::text,
 'declared_interest',coalesce((select sum(legacy_paid_interest_amount)from public.loan_contracts where cycle_id=${id}),0)::text,
 'posted_receipts',coalesce((select sum(amount)from public.loan_payments where cycle_id=${id}and status='posted'),0)::text,
 'fines',coalesce((select sum((payload->>'amount')::numeric)from public.financial_operations o where o.cycle_id=${id}and(o.operation_type='admin_fine_received'or(o.operation_type='manual_income'and lower(o.payload->>'category')='multa'))and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id)),0)::text,
 'bank_yield',coalesce((select sum(net_amount)from public.bank_yield_receipts where cycle_id=${id}),0)::text,
 'confirmed_settlements',(select count(*)from public.member_settlements where cycle_id=${id}and status<>'reversed'),
 'opening_operations',(select count(*)from public.financial_operations where cycle_id=${id}and operation_type='bank_opening'),
 'personal_operations',(select count(*)from public.financial_operations where cycle_id=${id}and operation_type like 'personal_funds_%'))`));
const independent = new Decimal(sources.savings).plus(sources.polla).plus(sources.fines).minus(sources.principal_delivered).plus(sources.declared_capital).plus(sources.declared_interest).plus(sources.posted_receipts).plus(sources.bank_yield);
const cuts = ['2026-01-01', '2026-10-01', '2026-10-15', '2026-10-16', '2026-10-20'].map(cutDate => {
  const result = reconstructMoney(operations, entries, cutDate);
  return { cutDate, cash: result.cash.toFixed(2), bank: result.bank.toFixed(2), physicalCash: result.physicalCash.toFixed(2), unknown: result.unknown.toFixed(2), receivable: result.receivable.toFixed(2), originalPrincipal: originalPrincipalAtCut(loans, operations, cutDate).toFixed(2), accountingDifference: result.accountingDifference.toFixed(2), orphanEntries: result.orphanEntries, unbalancedOperations: result.unbalancedOperations };
});
const final = reconstructMoney(operations, entries, '2026-10-20');
if (cuts.some(cut => cut.accountingDifference !== '0.00' || cut.orphanEntries || cut.unbalancedOperations)) throw Error('Partidas incompletas o sin balance.');
if (cuts.filter(cut => ['2026-10-15', '2026-10-16', '2026-10-20'].includes(cut.cutDate)).some(cut => cut.physicalCash !== '0.00')) throw Error('Efectivo diferente del confirmado.');
if (!final.cash.eq(independent)) throw Error('Hay flujos adicionales: revisar la fórmula independiente antes de concluir.');
const rows = final.rows.map(row => ({ date: row.operation.effective_date, concept: row.concept, provenance: row.provenance, operationId: row.operation.id, amount: row.cash.toFixed(2), cumulative: row.cumulative.toFixed(2) }));
const out = fileURLToPath(new URL('../incoming/local-private-backups/Natillera-privado/fin-recon-2026-10-20/', import.meta.url)); mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'FIN-RECON-DEV-PRIVATE.json'), JSON.stringify({ cycle, sources, independent: independent.toFixed(2), cuts, rows, financialWrites: 0 }, null, 2));
writeFileSync(path.join(out, 'FIN-RECON-DEV-PRIVATE.md'), '# Reconstrucción DEV — privado\n\nNo incluir en paquetes de código. Fechas contables; el corte consolidado no demuestra las fechas bancarias individuales anteriores.\n\n| Fecha | Concepto | Efecto | Saldo acumulado | Operación |\n|---|---|---:|---:|---|\n' + rows.map(row => `| ${row.date} | ${row.concept} | ${row.amount} | ${row.cumulative} | ${row.operationId} |`).join('\n'));
console.log(JSON.stringify({ target: 'DEV44122', readOnly: true, independentSourceMatchesLedger: true, cutsVerified: cuts.length, verifiedZeroCashCuts: 3, loans: loans.length, outputPrivate: true }));
