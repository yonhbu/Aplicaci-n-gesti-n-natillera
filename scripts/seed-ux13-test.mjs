// Synthetic TEST workspace only. Reuses the guarded seed; never opens dotenv or private backups.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const container = 'supabase_db_natillera-manager-test';
const binding = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
if (!binding['5432/tcp']?.some(item => item.HostPort === '55422')) throw Error('Solo TEST55422.');
execFileSync(process.execPath, ['scripts/seed-fin-recon-test.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const fixture = JSON.parse(readFileSync('incoming/fin-recon-2026-10-20/fixture.json', 'utf8'));
const prefix = fixture.cycleId.slice(0, 8), c = fixture.cycleId, w = fixture.workspaceId;
const member = n => prefix + '-0000-4000-8000-' + String(n).padStart(12, '0');
const q = value => "'" + value.replaceAll("'", "''") + "'";
const sql = `begin;
set local request.jwt.claim.sub='${member(1)}';
update public.cycles set name='Natillera UX sintética 2026' where id='${c}';
update public.members set display_name='Ángela María del Carmen Prueba de Navegación y Nombre Extenso' where id=(select member_id from public.cycle_members where id='${fixture.memberId}');
update public.bank_accounts set display_name='Pibank sintético', institution_name='Pibank' where workspace_id='${w}';
insert into public.members(id,workspace_id,display_name)values
('${member(14)}','${w}','Bruno Socio Completo'),('${member(24)}','${w}','Carolina Solo Ahorro'),('${member(34)}','${w}','Diego Retirado'),('${member(44)}','${w}','Elena Ingresa en Noviembre');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participation_start_month,participation_end_month,savings_status,participates_in_polla,participates_in_loan_profit)values
('${member(15)}','${w}','${c}','${member(14)}',10000,1,12,'active',true,true),
('${member(25)}','${w}','${c}','${member(24)}',10000,1,12,'active',false,false),
('${member(35)}','${w}','${c}','${member(34)}',10000,1,9,'withdrawn',false,false),
('${member(45)}','${w}','${c}','${member(44)}',10000,11,12,'active',true,true);
select public.register_savings_contribution('${fixture.memberId}','ux13-september-a',70000,'2026-09-01',2026,9,'cash','manual');
select public.register_savings_contribution('${member(15)}','ux13-september-b',10000,'2026-09-01',2026,9,'cash','manual');
select public.register_savings_contribution('${member(25)}','ux13-september-c',10000,'2026-09-01',2026,9,'cash','manual');
select public.register_savings_contribution('${member(15)}','ux13-october-b',10000,'2026-10-01',2026,10,'cash','manual');
select public.locate_unknown_liquidity('${c}','ux13-source-september','2026-09-01','cash',null,90000,'Synthetic received savings');
create temp table ux13loan as select id from public.create_loan_contract('${c}','ux13-loan',null,'Cobro sintético de octubre',null,1000,'fixed_interest','MONTHLY_FIXED',0.01,2,'2026-09-20');
select public.confirm_loan_disbursement((select id from ux13loan),'ux13-disbursement','2026-09-20');
select public.record_bank_interest_received('${c}',(select id from public.bank_accounts where workspace_id='${w}'),'ux13-interest','2026-10-01',12.34,0,0,'Synthetic received interest');
create temp table ux13played as select id from public.create_polla_activity('${c}',2026,9,'Polla sintética jugada');
select public.register_polla_contribution((select id from ux13played),'${fixture.memberId}','ux13-played-a',10000,'2026-09-15');
select public.register_polla_contribution((select id from ux13played),'${member(15)}','ux13-played-b',10000,'2026-09-15');
select public.award_polla_prize_to_capital((select id from ux13played),'${fixture.memberId}','ux13-prize-credit',20000,'2026-09-15');
create temp table ux13game as select id from public.create_polla_activity('${c}',2026,10,'Polla sintética pendiente');
select public.register_polla_contribution((select id from ux13game),'${fixture.memberId}','ux13-polla-a',5000,'2026-10-01');
select public.register_polla_contribution((select id from ux13game),'${member(15)}','ux13-polla-b',5000,'2026-10-01');
commit;`;
try { execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
catch (error) { console.error(String(error.stderr || '').slice(-1800)); process.exit(1); }
mkdirSync('incoming/ux13-2026-10-20', { recursive: true });
writeFileSync('incoming/ux13-2026-10-20/fixture.json', JSON.stringify({ ...fixture, completeMemberId: member(15), fixedMemberId: member(25), retiredMemberId: member(35), futureMemberId: member(45) }, null, 2));
console.log('UX13: dataset sintético independiente preparado exclusivamente en TEST55422.');
