import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { buildMigrationDryRun, type MigrationDryRunReport, type MigrationMapping } from '../src/domain/migrationD';
import { buildBlockDExport } from '../src/data/export';
import { loadLocalEnv } from './load-local-env';
import { execFileSync } from 'node:child_process';

type Command = 'fixture' | 'dry-run' | 'stage' | 'publish-trial' | 'export' | 'restore-check';
type AdminClient = any;

const args = new Map<string, string | boolean>();
for (let index = 3; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const value = process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[++index] : true;
  args.set(key, value);
}

const command = process.argv[2] as Command | undefined;
const workDir = path.resolve('incoming', 'block-d');

async function main() {
  if (!command) usage();
  if (command === 'fixture') {
    await writeFixture();
    return;
  }
  if (command === 'dry-run') {
    await dryRun();
    return;
  }
  if (command === 'stage') {
    await stage();
    return;
  }
  if (command === 'publish-trial') {
    await publishTrial();
    return;
  }
  if (command === 'export') {
    await exportAbcd();
    return;
  }
  if (command === 'restore-check') {
    await restoreCheck();
    return;
  }
  usage();
}

function usage(): never {
  console.error('Uso: tsx scripts/block-d-trial.ts fixture|dry-run|stage|publish-trial|export|restore-check [--json ruta] [--csv ruta] [--report ruta] [--out ruta]');
  process.exit(1);
}

async function writeFixture() {
  await mkdir(path.join(workDir, 'fixtures'), { recursive: true });
  const jsonPath = path.join(workDir, 'fixtures', 'migration-d-fixture.json');
  const csvPath = path.join(workDir, 'fixtures', 'migration-d-fixture.csv');
  await writeFile(jsonPath, JSON.stringify(makeFixture(), null, 2), 'utf8');
  await writeFile(csvPath, [
    'CUOTAS',
    'Fecha,Mes,Socio,Monto,Metodo',
    '2026-09-23,Octubre,Persona Uno,100000,Transferencia',
    '',
    'PRESTAMOS',
    'Id,Socio,Monto',
    'P000,Persona Uno,250000'
  ].join('\n'), 'utf8');
  console.log(`Fixture D escrito en ${jsonPath}`);
  console.log(`CSV auxiliar escrito en ${csvPath}`);
}

async function dryRun() {
  const jsonPath = valueArg('json');
  const csvPath = optionalValueArg('csv');
  const jsonText = jsonPath ? await readFile(jsonPath, 'utf8') : undefined;
  const csvText = csvPath ? await readFile(csvPath, 'utf8') : undefined;
  const sourceHash = sha256Hex([jsonText ?? '', csvText ?? ''].join('\n---CSV---\n'));
  await preserveOriginals({ jsonPath, csvPath, sourceHash });
  const report = buildMigrationDryRun({
    jsonText,
    csvText,
    sourceHash,
    sourceNames: [jsonPath, csvPath].filter(Boolean).map((file) => path.basename(file as string)),
    declaredExportedAt: optionalValueArg('exported-at')
  });
  const out = optionalValueArg('out') ?? path.join(workDir, 'reports', `dry-run-${sourceHash.slice(0, 12)}.json`);
  await writeJson(out, report);
  console.log(`Dry-run D generado: ${out}`);
  console.log(`Hash fuente: ${sourceHash}`);
  console.log(`Incidencias: ${report.issues.length}; mapeos: ${report.mappings.length}`);
}

async function stage() {
  assertTestSupabase();
  const report = await loadReport() as MigrationDryRunReport;
  const { admin, workspace, cycle } = await adminContext();
  const batchResult = await admin
    .from('migration_batches')
    .upsert({
      workspace_id: workspace.id,
      cycle_id: cycle.id,
      source_hash: report.inventory.sourceHash,
      transform_version: report.transformVersion,
      source_manifest: {
        sources: report.inventory.sourceNames,
        declaredExportedAt: report.inventory.declaredExportedAt,
        latestDateFound: report.inventory.latestDateFound
      },
      inventory: report.inventory,
      conciliation: report.conciliation,
      dry_run_generated_at: report.generatedAt,
      status: report.issues.some((issue) => issue.category === 'blocking') ? 'blocked' : 'staged'
    }, { onConflict: 'workspace_id,source_hash,transform_version' })
    .select('*')
    .single();
  if (batchResult.error || !batchResult.data) throw new Error(batchResult.error?.message ?? 'No se pudo crear lote D.');
  const batch = batchResult.data as { id: string };

  await replaceRows(admin, 'migration_mappings', batch.id, report.mappings.map((mapping) => ({
    workspace_id: workspace.id,
    cycle_id: cycle.id,
    batch_id: batch.id,
    source_entity: mapping.sourceEntity,
    source_id: mapping.sourceId,
    target_type: mapping.type,
    target_table: mapping.targetTable,
    transform_rule: mapping.transformRule,
    source_ref: mapping.sourceRef,
    payload: mapping.payload,
    status: mapping.status
  })));

  await replaceRows(admin, 'migration_issues', batch.id, report.issues.map((issue) => ({
    workspace_id: workspace.id,
    cycle_id: cycle.id,
    batch_id: batch.id,
    stable_id: issue.id,
    category: issue.category,
    code: issue.code,
    source_path: issue.sourcePath,
    reason: issue.reason,
    effect: issue.effect
  })));

  console.log(`Lote D en staging aislado TEST: ${batch.id}`);
  console.log(`Estado: ${report.issues.some((issue) => issue.category === 'blocking') ? 'blocked' : 'staged'}`);
}

async function publishTrial() {
  assertTestSupabase();
  const report = await loadReport() as MigrationDryRunReport;
  const { admin, workspace, cycle, actorUserId } = await adminContext();
  const blockerCount = report.issues.filter((issue) => issue.category === 'blocking').length;
  if (blockerCount > 0 && !args.has('allow-partial')) {
    throw new Error(`El lote tiene ${blockerCount} bloqueante(s). Use --allow-partial solo para publicar unidades independientes verificables.`);
  }
  const memberIdByLegacy = new Map<string, { memberId: string; cycleMemberId: string }>();
  for (const mapping of report.mappings.filter((item) => item.type === 'member' && item.status === 'ready')) {
    const member = await upsertMember(admin, workspace.id, cycle.id, mapping);
    memberIdByLegacy.set(String(mapping.payload.legacyId), member);
  }
  let publishedSavings = 0;
  for (const mapping of report.mappings.filter((item) => item.type === 'savings_contribution' && item.status === 'ready')) {
    const memberRef = String(mapping.payload.memberRef ?? '');
    const target = memberIdByLegacy.get(memberRef);
    if (!target) continue;
    await insertSavingsTrial(admin, workspace.id, cycle.id, actorUserId, target, mapping, report.inventory.sourceHash);
    publishedSavings += 1;
  }
  await admin
    .from('migration_batches')
    .update({ status: blockerCount > 0 ? 'blocked' : 'trial_published' })
    .eq('workspace_id', workspace.id)
    .eq('source_hash', report.inventory.sourceHash)
    .eq('transform_version', report.transformVersion);
  console.log(`Ensayo publicado en TEST aislado. Socios: ${memberIdByLegacy.size}; aportes: ${publishedSavings}.`);
}

async function exportAbcd() {
  assertTestSupabase();
  const report = await loadReport(false);
  const { admin, workspace, cycle } = await adminContext();
  const data = await collectCurrentState(admin, workspace.id, cycle.id);
  const exportObject = buildBlockDExport({ workspace, cycle, migrationDryRun: report, ...data });
  const serialized = JSON.stringify(exportObject, null, 2);
  const hash = sha256Hex(serialized);
  const out = optionalValueArg('out') ?? path.join(workDir, 'exports', `natillera-abcd-${hash.slice(0, 12)}.json`);
  await writeFileEnsured(out, serialized);
  await admin.from('migration_exports').upsert({
    workspace_id: workspace.id,
    cycle_id: cycle.id,
    batch_id: null,
    export_hash: hash,
    format: 'natillera-manager.abcd.v1',
    inventory: {
      cycleMembers: data.cycleMembers.length,
      contributions: data.contributions.length,
      operations: data.operations.length,
      ledgerEntries: data.ledgerEntries.length
    },
    comparison: { generatedForRestoreCheck: true }
  }, { onConflict: 'workspace_id,export_hash' });
  console.log(`Export ABC+D generado: ${out}`);
  console.log(`Hash export: ${hash}`);
}

async function restoreCheck() {
  const exportPath = valueArg('export');
  const raw = await readFile(exportPath, 'utf8');
  const parsed = JSON.parse(raw) as { format?: string; data?: Record<string, unknown>; migration?: Record<string, unknown> };
  if (parsed.format === 'natillera-manager.workspace.v3') {
    if (!args.has('to-test-db')) throw new Error('La verificacion de workspace.v3 exige restauracion real en TEST vacio: use --to-test-db.');
    const recoveryArgs = ['scripts/recovery-test.mjs', 'restore-json', '--file', exportPath];
    const output = optionalValueArg('out');
    if (output) recoveryArgs.push('--out', output);
    execFileSync(process.execPath, recoveryArgs, { stdio: 'inherit' });
    return;
  }
  if (parsed.format === 'natillera-manager.abcd-fin.v2') {
    throw new Error('Este respaldo v2 no contiene un inventario integral verificable. Genere workspace.v3; cambiar la etiqueta de version no recupera colecciones omitidas.');
  }
  if (parsed.format !== 'natillera-manager.abcd.v1' || !parsed.data) {
    throw new Error('El archivo no es un export ABC+D valido.');
  }
  for (const key of ['loans', 'loanPayments', 'pollaActivities', 'pollaPrizes', 'bankAccounts', 'memberSettlements', 'loanProfitDistributions']) {
    if (Array.isArray(parsed.data[key]) && (parsed.data[key] as unknown[]).length) {
      throw new Error('El ensayo legacy solo restaura socios, aportes y ledger. Para recuperar los modulos financieros completos genere workspace.v3.');
    }
  }
  const restored = {
    format: parsed.format,
    sourceExportHash: sha256Hex(raw),
    checkedAt: new Date().toISOString(),
    counts: countExportData(parsed.data),
    migrationDryRunPresent: Boolean(parsed.migration?.dryRun),
    attachmentManifestCount: Array.isArray(parsed.migration?.attachmentManifest) ? parsed.migration.attachmentManifest.length : 0,
    result: 'restored_in_empty_file_target',
    databaseRestore: null as null | Record<string, unknown>
  };
  if (args.has('to-test-db')) {
    assertTestSupabase();
    restored.databaseRestore = await restoreToEmptyTestWorkspace(parsed.data, restored.sourceExportHash);
    restored.result = 'restored_in_empty_file_target_and_empty_test_workspace';
  }
  const out = optionalValueArg('out') ?? path.join(workDir, 'restore-target', `restore-check-${restored.sourceExportHash.slice(0, 12)}.json`);
  await writeJson(out, restored);
  console.log(`Restauracion verificada en destino vacio de archivos: ${out}`);
  if (restored.databaseRestore) console.log(`Restauracion DB TEST: ${JSON.stringify(restored.databaseRestore)}`);
  console.log(JSON.stringify(restored.counts));
}

async function restoreToEmptyTestWorkspace(data: Record<string, unknown>, exportHash: string) {
  const { admin, actorUserId } = await adminContext();
  const workspace = await insertAndReturn(admin, 'workspaces', {
    name: `Restauracion D ${exportHash.slice(0, 8)}`
  });
  const sourceCycle = data.cycle as Record<string, unknown>;
  const cycle = await insertAndReturn(admin, 'cycles', {
    workspace_id: workspace.id,
    year: sourceCycle.year,
    name: `${String(sourceCycle.name ?? 'Natillera')} restaurada`,
    starts_on: sourceCycle.starts_on,
    closes_on: sourceCycle.closes_on,
    status: 'active'
  });
  await insertAndReturn(admin, 'workspace_users', {
    workspace_id: workspace.id,
    user_id: actorUserId,
    role: 'admin'
  });

  const memberMap = new Map<string, string>();
  const cycleMemberMap = new Map<string, string>();
  for (const cycleMember of (data.cycleMembers as Record<string, unknown>[] ?? [])) {
    const sourceMember = cycleMember.member as Record<string, unknown> | undefined;
    const member = await insertAndReturn(admin, 'members', {
      workspace_id: workspace.id,
      display_name: String(sourceMember?.display_name ?? `Restaurado ${String(cycleMember.member_id).slice(0, 8)}`),
      legacy_id: sourceMember?.legacy_id ? `RESTORE:${String(sourceMember.legacy_id)}` : null,
      notes: 'Restauracion de ensayo Bloque D en TEST aislado'
    });
    memberMap.set(String(cycleMember.member_id), String(member.id));
    const restoredCycleMember = await insertAndReturn(admin, 'cycle_members', {
      workspace_id: workspace.id,
      cycle_id: cycle.id,
      member_id: member.id,
      monthly_quota: cycleMember.monthly_quota,
      participation_start_month: cycleMember.participation_start_month,
      participation_end_month: cycleMember.participation_end_month,
      savings_status: cycleMember.savings_status,
      participates_in_savings: cycleMember.participates_in_savings,
      participates_in_polla: cycleMember.participates_in_polla,
      participates_in_loan_profit: cycleMember.participates_in_loan_profit,
      notes: cycleMember.notes
    });
    cycleMemberMap.set(String(cycleMember.id), String(restoredCycleMember.id));
  }

  const contributionMap = new Map<string, string>();
  for (const contribution of (data.contributions as Record<string, unknown>[] ?? [])) {
    const restoredContribution = await insertAndReturn(admin, 'savings_contributions', {
      workspace_id: workspace.id,
      cycle_id: cycle.id,
      member_id: memberMap.get(String(contribution.member_id)),
      cycle_member_id: cycleMemberMap.get(String(contribution.cycle_member_id)),
      idempotency_key: `restore:${String(contribution.idempotency_key)}`,
      amount: contribution.amount,
      effective_date: contribution.effective_date,
      applied_year: contribution.applied_year,
      applied_month: contribution.applied_month,
      method: contribution.method,
      source: contribution.source,
      actor_user_id: actorUserId
    });
    contributionMap.set(String(contribution.id), String(restoredContribution.id));
  }

  const operationMap = new Map<string, string>();
  for (const operation of (data.operations as Record<string, unknown>[] ?? [])) {
    const restoredOperation = await insertAndReturn(admin, 'financial_operations', {
      workspace_id: workspace.id,
      cycle_id: cycle.id,
      idempotency_key: `restore:${String(operation.idempotency_key)}`,
      operation_type: operation.operation_type,
      effective_date: operation.effective_date,
      actor_user_id: actorUserId,
      reference_table: operation.reference_table,
      reference_id: operation.reference_table === 'savings_contributions' ? contributionMap.get(String(operation.reference_id)) : null,
      rule_version: operation.rule_version ?? 'D-restore',
      payload: operation.payload
    });
    operationMap.set(String(operation.id), String(restoredOperation.id));
  }

  for (const entry of (data.ledgerEntries as Record<string, unknown>[] ?? [])) {
    await insertAndReturn(admin, 'ledger_entries', {
      operation_id: operationMap.get(String(entry.operation_id)),
      workspace_id: workspace.id,
      cycle_id: cycle.id,
      account: entry.account,
      amount: entry.amount,
      member_id: entry.member_id ? memberMap.get(String(entry.member_id)) : null,
      liquidity_location: entry.liquidity_location ?? 'unknown',
      bank_account_id: null
    });
  }

  return {
    workspaceId: workspace.id,
    cycleId: cycle.id,
    cycleMembers: cycleMemberMap.size,
    contributions: contributionMap.size,
    operations: operationMap.size,
    ledgerEntries: (data.ledgerEntries as unknown[] ?? []).length
  };
}

async function preserveOriginals(input: { jsonPath?: string; csvPath?: string | null; sourceHash: string }) {
  await mkdir(path.join(workDir, 'originals'), { recursive: true });
  await mkdir(path.join(workDir, 'work'), { recursive: true });
  for (const filePath of [input.jsonPath, input.csvPath].filter(Boolean) as string[]) {
    const extension = path.extname(filePath) || '.txt';
    const base = `${input.sourceHash.slice(0, 12)}-${path.basename(filePath)}`;
    await copyFile(filePath, path.join(workDir, 'originals', base));
    await copyFile(filePath, path.join(workDir, 'work', `${path.basename(filePath, extension)}.work${extension}`));
  }
}

async function loadReport(required = true): Promise<MigrationDryRunReport | null> {
  const reportPath = optionalValueArg('report');
  if (!reportPath) {
    if (required) throw new Error('Falta --report con el dry-run D.');
    return null;
  }
  return JSON.parse(await readFile(reportPath, 'utf8')) as MigrationDryRunReport;
}

async function adminContext() {
  loadLocalEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const workspaceName = process.env.NATILLERA_WORKSPACE_NAME;
  if (!supabaseUrl || !secretKey || !workspaceName) throw new Error('Faltan variables locales de Supabase TEST.');
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const workspaceResult = await admin.from('workspaces').select('*').eq('name', workspaceName).single();
  if (workspaceResult.error || !workspaceResult.data) throw new Error(workspaceResult.error?.message ?? 'Workspace no encontrado.');
  const cycleResult = await admin.from('cycles').select('*').eq('workspace_id', workspaceResult.data.id).eq('status', 'active').single();
  if (cycleResult.error || !cycleResult.data) throw new Error(cycleResult.error?.message ?? 'Ciclo activo no encontrado.');
  const userResult = await admin.from('workspace_users').select('user_id').eq('workspace_id', workspaceResult.data.id).eq('role', 'admin').limit(1).single();
  if (userResult.error || !userResult.data) throw new Error(userResult.error?.message ?? 'Admin del workspace no encontrado.');
  return {
    admin,
    workspace: workspaceResult.data as { id: string; name: string },
    cycle: cycleResult.data as { id: string; workspace_id: string; year: number; name: string; starts_on: string; closes_on: string; status: 'active' | 'closed' | 'archived' },
    actorUserId: userResult.data.user_id as string
  };
}

function assertTestSupabase() {
  process.env.SUPABASE_ENV = 'test';
  loadLocalEnv();
  if (process.env.SUPABASE_ENV !== 'test' || process.env.SUPABASE_URL !== 'http://127.0.0.1:55421') {
    throw new Error(`Bloque D se nego a escribir fuera de TEST local 55421. SUPABASE_ENV=${process.env.SUPABASE_ENV ?? '(vacio)'}, SUPABASE_URL=${process.env.SUPABASE_URL ?? '(vacio)'}`);
  }
}

async function replaceRows(admin: AdminClient, table: string, batchId: string, rows: Record<string, unknown>[]) {
  const deletion = await admin.from(table).delete().eq('batch_id', batchId);
  if (deletion.error) throw new Error(deletion.error.message);
  if (rows.length === 0) return;
  const insertion = await admin.from(table).insert(rows);
  if (insertion.error) throw new Error(insertion.error.message);
}

async function upsertMember(admin: AdminClient, workspaceId: string, cycleId: string, mapping: MigrationMapping) {
  const legacyId = `D:${String(mapping.payload.legacyId)}`;
  const existing = await admin.from('members').select('*').eq('workspace_id', workspaceId).eq('legacy_id', legacyId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const member = existing.data ?? (await insertAndReturn(admin, 'members', {
    workspace_id: workspaceId,
    display_name: String(mapping.payload.displayName),
    legacy_id: legacyId,
    notes: `Bloque D ensayo aislado; fuente ${mapping.sourceRef}`
  }));
  const cycleMember = await admin.from('cycle_members').select('*').eq('cycle_id', cycleId).eq('member_id', member.id).maybeSingle();
  if (cycleMember.error) throw new Error(cycleMember.error.message);
  const savedCycleMember = cycleMember.data ?? (await insertAndReturn(admin, 'cycle_members', {
    workspace_id: workspaceId,
    cycle_id: cycleId,
    member_id: member.id,
    monthly_quota: mapping.payload.monthlyQuota,
    participation_start_month: mapping.payload.participationStartMonth,
    participation_end_month: mapping.payload.participationEndMonth,
    participates_in_polla: mapping.payload.participatesInPolla,
    participates_in_loan_profit: mapping.payload.participatesInLoanProfit
  }));
  return { memberId: member.id as string, cycleMemberId: savedCycleMember.id as string };
}

async function insertSavingsTrial(admin: AdminClient, workspaceId: string, cycleId: string, actorUserId: string, target: { memberId: string; cycleMemberId: string }, mapping: MigrationMapping, sourceHash: string) {
  const idempotencyKey = `D:${sourceHash.slice(0, 16)}:${mapping.sourceEntity}:${mapping.sourceId}`;
  const existing = await admin.from('savings_contributions').select('*').eq('workspace_id', workspaceId).eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const op = await admin.from('financial_operations').select('id').eq('workspace_id', workspaceId).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (op.data) {
      const entries = await admin.from('ledger_entries').select('id').eq('operation_id', op.data.id);
      if (!entries.error && (entries.data?.length ?? 0) === 2) return;
    }
    throw new Error(`Ensayo parcial detectado para ${idempotencyKey}; resetee TEST antes de reintentar.`);
  }
  let contribution: Record<string, unknown> | null = null;
  let operation: Record<string, unknown> | null = null;
  try {
    contribution = await insertAndReturn(admin, 'savings_contributions', {
      workspace_id: workspaceId,
      cycle_id: cycleId,
      member_id: target.memberId,
      cycle_member_id: target.cycleMemberId,
      idempotency_key: idempotencyKey,
      amount: mapping.payload.amount,
      effective_date: mapping.payload.effectiveDate,
      applied_year: mapping.payload.appliedYear,
      applied_month: mapping.payload.appliedMonth,
      method: mapping.payload.method,
      source: 'legacy_migration_trial',
      actor_user_id: actorUserId
    });
    operation = await insertAndReturn(admin, 'financial_operations', {
      workspace_id: workspaceId,
      cycle_id: cycleId,
      idempotency_key: idempotencyKey,
      operation_type: 'savings_contribution_linked',
      effective_date: mapping.payload.effectiveDate,
      actor_user_id: actorUserId,
      reference_table: 'savings_contributions',
      reference_id: contribution.id,
      rule_version: 'D-2026-10-09',
      payload: {
        contribution_id: contribution.id,
        amount: mapping.payload.amount,
        source: 'legacy_migration_trial',
        source_ref: mapping.sourceRef
      }
    });
    const amount = mapping.payload.amount;
    const ledger = await admin.from('ledger_entries').insert([
      {
        operation_id: operation.id,
        workspace_id: workspaceId,
        cycle_id: cycleId,
        account: 'cash',
        amount,
        member_id: target.memberId,
        liquidity_location: 'unknown'
      },
      {
        operation_id: operation.id,
        workspace_id: workspaceId,
        cycle_id: cycleId,
        account: 'savings_liability',
        amount: `-${amount}`,
        member_id: target.memberId,
        liquidity_location: 'unknown'
      }
    ]);
    if (ledger.error) throw new Error(ledger.error.message);
  } catch (error) {
    if (operation?.id) await admin.from('ledger_entries').delete().eq('operation_id', operation.id);
    if (contribution?.id) await admin.from('savings_contributions').delete().eq('id', contribution.id);
    if (operation?.id) await admin.from('financial_operations').delete().eq('id', operation.id);
    throw error;
  }
}

async function insertAndReturn(admin: AdminClient, table: string, row: Record<string, unknown>) {
  const result = await admin.from(table).insert(row).select('*').single();
  if (result.error || !result.data) throw new Error(result.error?.message ?? `No se pudo insertar en ${table}.`);
  return result.data as Record<string, unknown>;
}

async function collectCurrentState(admin: AdminClient, workspaceId: string, cycleId: string) {
  const table = async (name: string, column = 'cycle_id') => {
    const result = await admin.from(name).select('*').eq(column, column === 'workspace_id' ? workspaceId : cycleId);
    if (result.error) throw new Error(result.error.message);
    return result.data ?? [];
  };
  return {
    cycleMembers: await table('cycle_members'),
    contributions: await table('savings_contributions'),
    operations: await table('financial_operations'),
    ledgerEntries: await table('ledger_entries'),
    loans: await table('loan_contracts'),
    loanPayments: await table('loan_payments'),
    loanSchedules: await table('loan_schedules'),
    pollaActivities: await table('polla_activities'),
    pollaContributions: await table('polla_contributions'),
    pollaPrizes: await table('polla_prizes'),
    bankAccounts: await table('bank_accounts', 'workspace_id'),
    bankReconciliations: await table('bank_reconciliations'),
    memberSettlements: await table('member_settlements'),
    memberSettlementPayments: await table('member_settlement_payments'),
    loanProfitDistributions: await table('loan_profit_distributions'),
    loanProfitDistributionPayments: await table('loan_profit_distribution_payments')
  };
}

function countExportData(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 1]));
}

function valueArg(name: string) {
  const value = optionalValueArg(name);
  if (!value) throw new Error(`Falta --${name}.`);
  return value;
}

function optionalValueArg(name: string) {
  const value = args.get(name);
  return typeof value === 'string' ? value : null;
}

async function writeJson(filePath: string, value: unknown) {
  await writeFileEnsured(filePath, JSON.stringify(value, null, 2));
}

async function writeFileEnsured(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function makeFixture() {
  return {
    exportedAt: '2026-10-09T12:00:00-05:00',
    socios: [
      { id: 'S001', nombre: 'Persona', apellido: 'Uno', cuotaMensual: 100000 },
      { id: 'S002', nombreCompleto: 'Persona Retirada', cuotaMensual: 100000, participaPolla: true }
    ],
    cuotas: [
      { id: 'C001', socioId: 'S001', monto: 100000, fecha: '2026-09-23', mes: 'Octubre', metodo: 'transferencia' },
      { id: 'C002', socioId: 'S002', monto: 100000, fecha: '2026-02-05', mes: 'Febrero' },
      { id: 'C003', socioId: 'S002', monto: 100000, mes: 'Marzo' }
    ],
    prestamos: [
      { id: 'P000', socioId: 'S001', principal: 0, fechaInicio: '2026-03-01', metodo: 'fixed_interest', tasa: 0 },
      { id: 'P013', deudorExterno: 'Externo fixture', principal: 500000, fechaInicio: '2026-04-01', referidoPor: 'S001' }
    ],
    pagos: { 'P000#1': true },
    premios: [
      { id: 'PR1', ganadorId: 'S002', bruto: 40000, estado: 'pagado' },
      { id: 'PR2', bruto: 40000 }
    ],
    movimientos: [{ id: 'M1', monto: 1000, fecha: '2026-10-09', ubicacion: 'banco' }],
    liquidaciones: [{ id: 'L1', socioId: 'S002', fechaCorte: '2026-10-06' }],
    comprobantes: [{ ref: 'indexeddb://foto-1' }],
    campoExtraNoMapeado: 'se conserva como procedencia'
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
