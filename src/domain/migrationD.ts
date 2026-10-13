import Decimal from 'decimal.js';
import { assertCivilDate } from './date';
import { prevalidateLegacySources } from './legacyPrevalidation';

export type MigrationIssueCategory = 'blocking' | 'requires_decision' | 'descriptive';
export type MigrationMappingStatus = 'ready' | 'staged_only' | 'blocked' | 'published' | 'conflict';

export interface MigrationIssue {
  id: string;
  category: MigrationIssueCategory;
  code: string;
  sourcePath: string;
  reason: string;
  effect: string;
}

export interface MigrationMapping {
  sourceEntity: string;
  sourceId: string;
  type: string;
  targetWorkspaceId: string | null;
  targetCycleId: string | null;
  targetTable: string | null;
  targetId: string | null;
  transformRule: string;
  sourceRef: string;
  status: MigrationMappingStatus;
  payload: Record<string, unknown>;
}

export interface MigrationInventory {
  sourceNames: string[];
  sourceHash: string;
  generatedAt: string;
  declaredExportedAt: string | null;
  jsonCollections: Record<string, number>;
  csvSections: Record<string, number>;
  years: number[];
  cycles: string[];
  latestDateFound: string | null;
  members: number;
  savings: number;
  loans: number;
  loanPaymentMarks: number;
  bankOrCashMovements: number;
  pollaActivities: number;
  pollaPrizes: number;
  settlements: number;
  attachmentReferences: number;
  attachmentBytes: number;
  unknownTopLevelFields: string[];
}

export interface MigrationConciliationLine {
  key: string;
  label: string;
  sourceCount: number;
  publishableCount: number;
  stagedOnlyCount: number;
  blockedCount: number;
  sourceAmount: string;
  publishableAmount: string;
  unknownAmountCount: number;
  note: string;
}

export interface MigrationDryRunReport {
  format: 'natillera-manager.migration-d.dry-run.v1';
  transformVersion: string;
  generatedAt: string;
  inventory: MigrationInventory;
  issues: MigrationIssue[];
  mappings: MigrationMapping[];
  conciliation: MigrationConciliationLine[];
  abcPreconditions: {
    requirement: string;
    status: 'pass' | 'blocked' | 'not_checked';
    evidence: string;
  }[];
  notes: string[];
}

export interface BuildMigrationDryRunInput {
  jsonText?: string;
  csvText?: string;
  sourceHash: string;
  sourceNames?: string[];
  declaredExportedAt?: string | null;
  targetWorkspaceId?: string | null;
  targetCycleId?: string | null;
  now?: Date;
}

type JsonRecord = Record<string, unknown>;

const transformVersion = 'D-2026-10-09.migration-conciliation.v1';
const knownTopLevelKeys = new Set([
  'socios',
  'cuotas',
  'prestamos',
  'premios',
  'movimientos',
  'pagos',
  'polla',
  'pollas',
  'actividades',
  'actividadesPolla',
  'liquidaciones',
  'config',
  'reglas',
  'parametros',
  'exportedAt',
  'fechaExportacion',
  'version'
]);

export function buildMigrationDryRun(input: BuildMigrationDryRunInput): MigrationDryRunReport {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const issues: MigrationIssue[] = [];
  const mappings: MigrationMapping[] = [];
  const dates = new Set<string>();
  const years = new Set<number>();
  const cycles = new Set<string>();

  const legacyReport = prevalidateLegacySources({
    csvText: input.csvText,
    jsonText: input.jsonText,
    now: input.now
  });

  for (const issue of legacyReport.issues) {
    issues.push({
      id: `LEGACY_${issue.code}_${issues.length + 1}`,
      category: issue.severity === 'error' ? 'blocking' : 'descriptive',
      code: issue.code,
      sourcePath: issue.source,
      reason: issue.message,
      effect: issue.severity === 'error' ? 'No se publica el lote hasta corregir la fuente.' : 'Se conserva como advertencia de inventario.'
    });
  }

  let json: JsonRecord | null = null;
  if (!input.jsonText) {
    issues.push({
      id: 'BLOCK_SOURCE_JSON_MISSING',
      category: 'blocking',
      code: 'SOURCE_JSON_MISSING',
      sourcePath: 'json',
      reason: 'No se recibio el JSON exportado del navegador operativo.',
      effect: 'Solo se puede construir el flujo con fixtures o CSV auxiliar; no se declara migracion completa.'
    });
  } else {
    try {
      const parsed = JSON.parse(input.jsonText.replace(/^\uFEFF/, '')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        json = parsed as JsonRecord;
      }
    } catch {
      json = null;
    }
  }

  const jsonCollections: Record<string, number> = {};
  const unknownTopLevelFields: string[] = [];
  if (json) {
    for (const [key, value] of Object.entries(json)) {
      if (Array.isArray(value)) {
        jsonCollections[key] = value.length;
      }
      if (!knownTopLevelKeys.has(key)) {
        unknownTopLevelFields.push(key);
      }
    }
  }

  const members = asArray(json?.socios);
  const savings = asArray(json?.cuotas);
  const loans = asArray(json?.prestamos);
  const prizes = asArray(json?.premios);
  const movements = asArray(json?.movimientos);
  const settlements = asArray(json?.liquidaciones);
  const activities = [
    ...asArray(json?.actividades),
    ...asArray(json?.actividadesPolla),
    ...asArray(json?.pollas),
    ...asArray(json?.polla)
  ];
  const paymentMarks = json?.pagos && typeof json.pagos === 'object' && !Array.isArray(json.pagos)
    ? Object.entries(json.pagos as Record<string, unknown>)
    : [];

  members.forEach((item, index) => {
    const record = asRecord(item);
    const sourceId = sourceIdFor(record, index);
    const displayName = displayNameFor(record);
    const quota = moneyFrom(record, ['cuotaMensual', 'cuota', 'monthlyQuota', 'aporteMensual']) ?? '100000.00';
    const status = displayName ? 'ready' : 'blocked';
    if (!displayName) {
      issues.push(issue('MEMBER_NAME_MISSING', `socios.${index}`, 'El socio no tiene nombre visible verificable.', 'No se publica la participacion de este socio.'));
    }
    mappings.push({
      sourceEntity: 'socios',
      sourceId,
      type: 'member',
      targetWorkspaceId: input.targetWorkspaceId ?? null,
      targetCycleId: input.targetCycleId ?? null,
      targetTable: status === 'ready' ? 'cycle_members' : null,
      targetId: null,
      transformRule: 'D.member.identity-by-legacy-id',
      sourceRef: `json:socios.${index}`,
      status,
      payload: {
        legacyId: sourceId,
        displayName: displayName ?? null,
        monthlyQuota: quota,
        participationStartMonth: integerFrom(record, ['participationStartMonth', 'mesInicio', 'desdeMes']) ?? 1,
        participationEndMonth: integerFrom(record, ['participationEndMonth', 'mesFin', 'hastaMes']) ?? 12,
        participatesInPolla: booleanFrom(record, ['participaPolla', 'participatesInPolla']) ?? true,
        participatesInLoanProfit: booleanFrom(record, ['participaUtilidad', 'participatesInLoanProfit']) ?? true
      }
    });
  });

  savings.forEach((item, index) => {
    const record = asRecord(item);
    const sourceId = sourceIdFor(record, index);
    const amount = moneyFrom(record, ['monto', 'amount', 'valor', 'total']);
    const effectiveDate = dateFrom(record, ['fecha', 'effectiveDate', 'fechaEfectiva', 'paidDate']);
    const appliedMonth = monthFrom(record, ['mes', 'appliedMonth', 'mesAplicado']);
    const memberRef = textFrom(record, ['socioId', 'memberId', 'socio', 'nombreSocio']);
    const blockingReasons = [
      !amount ? 'monto' : '',
      !effectiveDate ? 'fecha efectiva' : '',
      !appliedMonth ? 'mes aplicado' : '',
      !memberRef ? 'socio' : ''
    ].filter(Boolean);
    if (effectiveDate) collectDate(effectiveDate, dates, years);
    if (appliedMonth && json?.config && typeof json.config === 'object') {
      const maybeYear = integerFrom(json.config as JsonRecord, ['year', 'ano', 'anio']);
      if (maybeYear) years.add(maybeYear);
    }
    if (blockingReasons.length > 0) {
      issues.push(issue('SAVINGS_FACT_INCOMPLETE', `cuotas.${index}`, `Faltan datos verificables: ${blockingReasons.join(', ')}.`, 'La cuota queda en staging y no se publica como aporte.'));
    }
    mappings.push({
      sourceEntity: 'cuotas',
      sourceId,
      type: 'savings_contribution',
      targetWorkspaceId: input.targetWorkspaceId ?? null,
      targetCycleId: input.targetCycleId ?? null,
      targetTable: blockingReasons.length === 0 ? 'savings_contributions' : null,
      targetId: null,
      transformRule: 'D.savings.verified-fact-to-linked-ledger',
      sourceRef: `json:cuotas.${index}`,
      status: blockingReasons.length === 0 ? 'ready' : 'staged_only',
      payload: {
        legacyId: sourceId,
        memberRef: memberRef ?? null,
        amount,
        effectiveDate,
        appliedYear: yearFor(record, effectiveDate),
        appliedMonth,
        method: methodFrom(record)
      }
    });
  });

  loans.forEach((item, index) => {
    const record = asRecord(item);
    const sourceId = sourceIdFor(record, index);
    const principal = moneyFrom(record, ['principal', 'monto', 'amount', 'capital']);
    const startDate = dateFrom(record, ['fecha', 'fechaInicio', 'startDate', 'disbursedDate']);
    if (startDate) collectDate(startDate, dates, years);
    if (!principal || !startDate) {
      issues.push(issue('LOAN_CONTRACT_INCOMPLETE', `prestamos.${index}`, 'El prestamo no tiene capital y fecha inicial verificables.', 'No se simula desembolso ni cobro; queda como contrato candidato.'));
    }
    if (String(sourceId).toUpperCase().includes('P013')) {
      issues.push({
        id: `P013_EVIDENCE_${index + 1}`,
        category: 'requires_decision',
        code: 'P013_REQUIRES_EXPLICIT_EVIDENCE',
        sourcePath: `prestamos.${index}`,
        reason: 'P013 requiere evidencia explicita del acuerdo de primer mes antes de aplicar excepcion.',
        effect: 'No se generaliza la regla por nombre ni se impone a otros prestamos.'
      });
    }
    mappings.push({
      sourceEntity: 'prestamos',
      sourceId,
      type: 'loan_contract_candidate',
      targetWorkspaceId: input.targetWorkspaceId ?? null,
      targetCycleId: input.targetCycleId ?? null,
      targetTable: null,
      targetId: null,
      transformRule: 'D.loan.stage-contract-no-fake-cash',
      sourceRef: `json:prestamos.${index}`,
      status: 'staged_only',
      payload: {
        legacyId: sourceId,
        principal,
        startDate,
        method: textFrom(record, ['metodo', 'method']) ?? 'unknown',
        rateUnit: textFrom(record, ['rateUnit', 'unidadTasa', 'tipoTasa']) ?? 'unknown',
        rateValue: textFrom(record, ['rateValue', 'tasa']) ?? null,
        borrowerRef: textFrom(record, ['socioId', 'memberId', 'socio', 'deudor']) ?? null,
        externalBorrowerName: textFrom(record, ['deudorExterno', 'externalBorrowerName']) ?? null,
        referredBy: textFrom(record, ['referidoPor', 'referredBy']) ?? null
      }
    });
  });

  paymentMarks.forEach(([key, value], index) => {
    if (value === true) {
      issues.push({
        id: `PAYMENT_MARK_${index + 1}`,
        category: 'requires_decision',
        code: 'PAYMENT_MARK_WITHOUT_FACTS',
        sourcePath: `pagos.${key}`,
        reason: 'pagado=true no prueba fecha efectiva, importe real ni aplicacion capital/interes.',
        effect: 'Se conserva evidencia original; no se convierte automaticamente en cobro.'
      });
    }
  });

  prizes.forEach((item, index) => {
    const record = asRecord(item);
    const sourceId = sourceIdFor(record, index);
    const gross = moneyFrom(record, ['bruto', 'grossAmount', 'monto', 'amount']);
    const winnerRef = textFrom(record, ['ganadorId', 'winnerId', 'ganador', 'socio']);
    if (!gross || !winnerRef) {
      issues.push({
        id: `PRIZE_INCOMPLETE_${index + 1}`,
        category: 'requires_decision',
        code: 'PRIZE_INCOMPLETE',
        sourcePath: `premios.${index}`,
        reason: 'Premio sin bruto o ganador/periodo verificable.',
        effect: 'No se reparte artificialmente ni se cobra comision dos veces.'
      });
    }
    mappings.push({
      sourceEntity: 'premios',
      sourceId,
      type: 'polla_prize_candidate',
      targetWorkspaceId: input.targetWorkspaceId ?? null,
      targetCycleId: input.targetCycleId ?? null,
      targetTable: null,
      targetId: null,
      transformRule: 'D.polla.stage-prize-no-artificial-winner',
      sourceRef: `json:premios.${index}`,
      status: 'staged_only',
      payload: { legacyId: sourceId, grossAmount: gross, winnerRef, status: textFrom(record, ['status', 'estado']) ?? null }
    });
  });

  movements.forEach((item, index) => {
    const record = asRecord(item);
    const sourceId = sourceIdFor(record, index);
    const date = dateFrom(record, ['fecha', 'effectiveDate', 'date']);
    if (date) collectDate(date, dates, years);
    mappings.push({
      sourceEntity: 'movimientos',
      sourceId,
      type: 'cash_bank_movement_candidate',
      targetWorkspaceId: input.targetWorkspaceId ?? null,
      targetCycleId: input.targetCycleId ?? null,
      targetTable: null,
      targetId: null,
      transformRule: 'D.bank.stage-movement-external-conciliation-required',
      sourceRef: `json:movimientos.${index}`,
      status: 'staged_only',
      payload: {
        legacyId: sourceId,
        amount: moneyFrom(record, ['monto', 'amount', 'valor']),
        date,
        location: textFrom(record, ['ubicacion', 'location', 'cuenta']) ?? 'unknown'
      }
    });
  });

  activities.forEach((item, index) => {
    const record = asRecord(item);
    const sourceId = sourceIdFor(record, index);
    mappings.push({
      sourceEntity: 'actividadesPolla',
      sourceId,
      type: 'polla_activity_candidate',
      targetWorkspaceId: input.targetWorkspaceId ?? null,
      targetCycleId: input.targetCycleId ?? null,
      targetTable: null,
      targetId: null,
      transformRule: 'D.polla.stage-activity-rights-preserved',
      sourceRef: `json:actividadesPolla.${index}`,
      status: 'staged_only',
      payload: {
        legacyId: sourceId,
        periodMonth: monthFrom(record, ['mes', 'periodMonth']),
        name: textFrom(record, ['nombre', 'name']) ?? null
      }
    });
  });

  settlements.forEach((item, index) => {
    const record = asRecord(item);
    const date = dateFrom(record, ['fecha', 'cutDate', 'fechaCorte']);
    if (date) collectDate(date, dates, years);
    issues.push({
      id: `SETTLEMENT_POLICY_${index + 1}`,
      category: 'requires_decision',
      code: 'SETTLEMENT_POLICY_REQUIRES_APPROVAL',
      sourcePath: `liquidaciones.${index}`,
      reason: 'Penalidades, cuotas, destinos o reservas requieren politica aprobada/versionada.',
      effect: 'La liquidacion queda como snapshot candidato; no se confirma obligacion.'
    });
  });

  const attachment = inspectAttachments(json);
  if (attachment.references > attachment.bytes) {
    issues.push({
      id: 'ATTACHMENT_BYTES_MISSING',
      category: 'requires_decision',
      code: 'ATTACHMENT_BYTES_MISSING',
      sourcePath: 'json',
      reason: 'Existen referencias de comprobantes sin bytes recuperables.',
      effect: 'No se declaran comprobantes migrados; solo se conserva referencia y hash de fuente.'
    });
  }

  const latestDateFound = [...dates].sort().at(-1) ?? null;
  const inventory: MigrationInventory = {
    sourceNames: input.sourceNames ?? [],
    sourceHash: input.sourceHash,
    generatedAt,
    declaredExportedAt: input.declaredExportedAt ?? dateTimeFrom(json, ['exportedAt', 'fechaExportacion']) ?? null,
    jsonCollections,
    csvSections: legacyReport.inventory.csvSections,
    years: [...years].sort(),
    cycles: [...cycles].sort(),
    latestDateFound,
    members: members.length,
    savings: savings.length,
    loans: loans.length,
    loanPaymentMarks: paymentMarks.length,
    bankOrCashMovements: movements.length,
    pollaActivities: activities.length,
    pollaPrizes: prizes.length,
    settlements: settlements.length,
    attachmentReferences: attachment.references,
    attachmentBytes: attachment.bytes,
    unknownTopLevelFields
  };

  return {
    format: 'natillera-manager.migration-d.dry-run.v1',
    transformVersion,
    generatedAt,
    inventory,
    issues,
    mappings,
    conciliation: buildConciliation(mappings),
    abcPreconditions: [
      { requirement: 'Hash nulo/obsoleto rechazado en liquidaciones', status: 'not_checked', evidence: 'Verificar con npm run test:rls antes de publicar dependencias.' },
      { requirement: 'Idempotencia resuelta antes de estados mutados', status: 'not_checked', evidence: 'Cubierto por abc_financial_invariants_regression_test.sql si test:rls pasa.' },
      { requirement: 'Ledger balanceado y ubicacion de dinero bank/cash/unknown', status: 'not_checked', evidence: 'Cubierto por migraciones ABC y conciliacion D del ensayo.' },
      { requirement: 'Politicas aprobadas para utilidad/liquidacion', status: 'not_checked', evidence: 'D conserva decisiones pendientes y no las inventa.' }
    ],
    notes: [
      'El dry-run no escribe operaciones financieras.',
      'CSV se usa como evidencia auxiliar; no se suma al JSON como movimientos nuevos.',
      'Los booleanos de pago, comprobantes sin bytes y politicas libres no se publican automaticamente.'
    ]
  };
}

function buildConciliation(mappings: MigrationMapping[]): MigrationConciliationLine[] {
  const groups = new Map<string, MigrationMapping[]>();
  for (const mapping of mappings) {
    const list = groups.get(mapping.type) ?? [];
    list.push(mapping);
    groups.set(mapping.type, list);
  }
  return [...groups.entries()].map(([key, items]) => {
    const publishable = items.filter((item) => item.status === 'ready');
    const stagedOnly = items.filter((item) => item.status === 'staged_only');
    const blocked = items.filter((item) => item.status === 'blocked');
    const totals = sumAmounts(items);
    const publishableTotals = sumAmounts(publishable);
    return {
      key,
      label: labelForType(key),
      sourceCount: items.length,
      publishableCount: publishable.length,
      stagedOnlyCount: stagedOnly.length,
      blockedCount: blocked.length,
      sourceAmount: totals.amount.toFixed(2),
      publishableAmount: publishableTotals.amount.toFixed(2),
      unknownAmountCount: totals.unknown,
      note: key.includes('candidate') || stagedOnly.length > 0
        ? 'Conciliacion interna pendiente de decision; no se fuerza caja ni utilidad.'
        : 'Hechos verificables listos para ensayo aislado.'
    };
  });
}

function sumAmounts(items: MigrationMapping[]) {
  return items.reduce(
    (acc, item) => {
      const amount = item.payload.amount ?? item.payload.principal ?? item.payload.grossAmount;
      if (typeof amount === 'string') {
        acc.amount = acc.amount.plus(amount);
      } else {
        acc.unknown += 1;
      }
      return acc;
    },
    { amount: new Decimal(0), unknown: 0 }
  );
}

function labelForType(type: string) {
  const labels: Record<string, string> = {
    member: 'Socios y participaciones',
    savings_contribution: 'Aportes de ahorro verificables',
    loan_contract_candidate: 'Prestamos/contratos candidatos',
    polla_prize_candidate: 'Premios de polla candidatos',
    cash_bank_movement_candidate: 'Movimientos banco/efectivo candidatos',
    polla_activity_candidate: 'Actividades de polla candidatas'
  };
  return labels[type] ?? type;
}

function issue(code: string, sourcePath: string, reason: string, effect: string): MigrationIssue {
  return {
    id: `${code}_${sourcePath.replace(/[^A-Za-z0-9]+/g, '_')}`,
    category: code.includes('MISSING') || code.includes('INCOMPLETE') ? 'blocking' : 'descriptive',
    code,
    sourcePath,
    reason,
    effect
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function sourceIdFor(record: JsonRecord, index: number) {
  return textFrom(record, ['id', 'legacyId', 'codigo', 'key']) ?? `row-${index + 1}`;
}

function displayNameFor(record: JsonRecord) {
  const direct = textFrom(record, ['displayName', 'nombreCompleto', 'name']);
  if (direct) return direct;
  const parts = [textFrom(record, ['nombre', 'firstName']), textFrom(record, ['apellido', 'lastName'])].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function textFrom(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function moneyFrom(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsed = parseMoney(value);
    if (parsed) return parsed;
  }
  return null;
}

function parseMoney(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const decimal = new Decimal(value);
    if (decimal.greaterThanOrEqualTo(0)) return decimal.toDecimalPlaces(2).toFixed(2);
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
      const decimal = new Decimal(normalized);
      if (decimal.greaterThanOrEqualTo(0)) return decimal.toDecimalPlaces(2).toFixed(2);
    }
  }
  return null;
}

function integerFrom(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isInteger(number)) return number;
  }
  return null;
}

function booleanFrom(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function dateFrom(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const candidate = value.slice(0, 10);
    try {
      return assertCivilDate(candidate, key);
    } catch {
      continue;
    }
  }
  return null;
}

function dateTimeFrom(record: JsonRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function monthFrom(record: JsonRecord, keys: string[]) {
  const monthNames = new Map([
    ['enero', 1],
    ['febrero', 2],
    ['marzo', 3],
    ['abril', 4],
    ['mayo', 5],
    ['junio', 6],
    ['julio', 7],
    ['agosto', 8],
    ['septiembre', 9],
    ['setiembre', 9],
    ['octubre', 10],
    ['noviembre', 11],
    ['diciembre', 12]
  ]);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) return value;
    if (typeof value === 'string') {
      const number = Number(value);
      if (Number.isInteger(number) && number >= 1 && number <= 12) return number;
      const named = monthNames.get(value.toLocaleLowerCase('es-CO').trim());
      if (named) return named;
    }
  }
  return null;
}

function yearFor(record: JsonRecord, fallbackDate: string | null) {
  const explicit = integerFrom(record, ['ano', 'anio', 'year', 'appliedYear']);
  if (explicit) return explicit;
  return fallbackDate ? Number(fallbackDate.slice(0, 4)) : null;
}

function methodFrom(record: JsonRecord) {
  const method = textFrom(record, ['metodo', 'method', 'formaPago'])?.toLocaleLowerCase('es-CO') ?? '';
  if (method.includes('banco') || method.includes('transfer')) return 'bank_transfer';
  if (method.includes('deposit')) return 'bank_deposit';
  if (method.includes('efect') || method.includes('cash')) return 'cash';
  return 'other';
}

function collectDate(value: string, dates: Set<string>, years: Set<number>) {
  dates.add(value);
  years.add(Number(value.slice(0, 4)));
}

function inspectAttachments(json: JsonRecord | null) {
  const result = { references: 0, bytes: 0 };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/comprobante|adjunto|imagen|foto/i.test(key) && nested) {
        const values = Array.isArray(nested) ? nested : [nested];
        for (const candidate of values) {
          if (!candidate) continue;
          result.references += 1;
          if (typeof candidate === 'string' && candidate.startsWith('data:')) {
            result.bytes += 1;
          }
        }
      }
      visit(nested);
    }
  };
  visit(json);
  return result;
}

