import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { loadLocalEnv } from './load-local-env';

type JsonRecord = Record<string, unknown>;

const expectedJsonHash = '12f90dfa6bb9ce83a0396a7195966a08a961f5901bc34a646f4fd71c78c0fa10';
const expectedCsvHash = 'b8012b25e663cf01b2e328afa5feef3947aba6e78a57179a7e2910ebfa6f9eff';

const monthNumbers = new Map([
  ['Enero', 1],
  ['Febrero', 2],
  ['Marzo', 3],
  ['Abril', 4],
  ['Mayo', 5],
  ['Junio', 6],
  ['Julio', 7],
  ['Agosto', 8],
  ['Septiembre', 9],
  ['Octubre', 10],
  ['Noviembre', 11],
  ['Diciembre', 12]
]);

const methodMap = new Map([
  ['Amortizado', 'amortized'],
  ['Fijo', 'fixed_interest'],
  ['SoloInteres', 'interest_only']
]);

function argValue(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Falta argumento ${name}.`);
  return value;
}

function sha256(buffer: Buffer | string) {
  return createHash('sha256').update(buffer).digest('hex');
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} debe ser un objeto.`);
  }
  return value as JsonRecord;
}

function asArray(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} debe ser un arreglo.`);
  }
  return value.map((item, index) => asRecord(item, `${label}[${index}]`));
}

function numberValue(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} debe ser numerico.`);
  }
  return parsed;
}

function stringValue(value: unknown, label: string) {
  if (value == null || String(value).trim() === '') {
    throw new Error(`${label} es obligatorio.`);
  }
  return String(value).trim();
}

function optionalString(value: unknown) {
  return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function monthValue(value: unknown, label: string) {
  const text = stringValue(value, label);
  const parsed = monthNumbers.get(text) ?? numberValue(value, label);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new Error(`${label} debe ser un mes entre 1 y 12.`);
  }
  return { month: parsed, label: monthNumbers.has(text) ? text : `Mes ${parsed}` };
}

function parseCsvSections(csvText: string) {
  const sections = new Map<string, string[]>();
  let current = '';
  for (const rawLine of csvText.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes(',') && /^[A-ZÁÉÍÓÚÑ ]+$/.test(line)) {
      current = line;
      sections.set(current, []);
      continue;
    }
    if (current) {
      sections.get(current)?.push(rawLine);
    }
  }

  const parsed = new Map<string, JsonRecord[]>();
  for (const [section, lines] of sections) {
    const result = Papa.parse<JsonRecord>(lines.join('\n'), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim()
    });
    if (result.errors.length) {
      throw new Error(`CSV ${section}: ${result.errors[0]?.message}`);
    }
    parsed.set(section, result.data);
  }
  return parsed;
}

function sum(records: JsonRecord[], field: string) {
  return records.reduce((total, item) => total + numberValue(item[field], field), 0);
}

async function main() {
  loadLocalEnv();
  const jsonPath = argValue('--json');
  const csvPath = argValue('--csv');
  const jsonBytes = await readFile(jsonPath);
  const csvBytes = await readFile(csvPath);
  const jsonHash = sha256(jsonBytes);
  const csvHash = sha256(csvBytes);

  if (jsonHash !== expectedJsonHash) {
    throw new Error(`Hash JSON diferente. Esperado ${expectedJsonHash}, recibido ${jsonHash}.`);
  }
  if (csvHash !== expectedCsvHash) {
    throw new Error(`Hash CSV diferente. Esperado ${expectedCsvHash}, recibido ${csvHash}.`);
  }

  const source = asRecord(JSON.parse(jsonBytes.toString('utf8')), 'JSON');
  const csvSections = parseCsvSections(csvBytes.toString('utf8'));
  const socios = asArray(source.socios, 'socios');
  const cuotas = asArray(source.cuotas, 'cuotas');
  const movimientos = asArray(source.movimientos, 'movimientos');
  const premios = asArray(source.premios, 'premios');
  const prestamos = asArray(source.prestamos, 'prestamos');
  const pagos = asRecord(source.pagos, 'pagos');
  const csvSchedules = csvSections.get('PAGOS DE PRESTAMOS') ?? [];

  const memberById = new Map(socios.map((item) => [String(item.id), item]));
  const paidKeys = new Set(Object.keys(pagos).filter((key) => Boolean(pagos[key])));
  const schedulesByLoan = new Map<string, JsonRecord[]>();
  for (const row of csvSchedules) {
    const loanId = stringValue(row.Prestamo, 'Prestamo');
    const list = schedulesByLoan.get(loanId) ?? [];
    list.push(row);
    schedulesByLoan.set(loanId, list);
  }

  const members = socios.map((item) => {
    const legacyId = stringValue(item.id, 'socio.id');
    const displayName = `${stringValue(item.nombre, 'socio.nombre')} ${optionalString(item.apellido) ?? ''}`.trim();
    const participates = item.participa == null ? true : Boolean(item.participa);
    return {
      legacyId,
      displayName,
      quota: numberValue(item.cuota, 'socio.cuota').toFixed(2),
      startMonth: numberValue(item.mesInicio, 'socio.mesInicio'),
      endMonth: numberValue(item.mesFin, 'socio.mesFin'),
      active: item.activo == null ? true : Boolean(item.activo),
      participates
    };
  });

  const savingsContributions = cuotas.map((item) => ({
    legacyId: stringValue(item.id, 'cuota.id'),
    effectiveDate: stringValue(item.fecha, 'cuota.fecha'),
    appliedMonth: monthValue(item.mes, 'cuota.mes').month,
    memberLegacyId: stringValue(item.socioId, 'cuota.socioId'),
    amount: numberValue(item.monto, 'cuota.monto').toFixed(2),
    method: stringValue(item.metodo, 'cuota.metodo')
  }));

  const loans = prestamos.map((item) => {
    const legacyId = stringValue(item.id, 'prestamo.id');
    const schedule = (schedulesByLoan.get(legacyId) ?? []).map((row) => {
      const number = numberValue(row.PagoN, 'PagoN');
      const key = `${legacyId}#${number}`;
      return {
        number,
        dueDate: stringValue(row.Fecha, 'Fecha'),
        amount: numberValue(row.Cuota, 'Cuota').toFixed(2),
        interest: numberValue(row.Interes, 'Interes').toFixed(2),
        capital: numberValue(row.Capital, 'Capital').toFixed(2),
        paid: paidKeys.has(key)
      };
    });
    const paidRows = schedule.filter((row) => row.paid);
    const method = methodMap.get(stringValue(item.tipo, 'prestamo.tipo'));
    if (!method) {
      throw new Error(`Tipo de prestamo no soportado: ${item.tipo}`);
    }
    return {
      legacyId,
      borrowerLegacyId: String(item.socioId) === '99' ? null : String(item.socioId),
      externalBorrowerName: String(item.socioId) === '99' ? optionalString(item.externoNombre) ?? 'Deudor externo legacy' : null,
      referredByLegacyId: optionalString(item.refiereId),
      startDate: stringValue(item.fechaInicio, 'prestamo.fechaInicio'),
      principal: numberValue(item.principal, 'prestamo.principal').toFixed(2),
      termMonths: numberValue(item.nPagos, 'prestamo.nPagos'),
      scheduledPayment: numberValue(item.cuota, 'prestamo.cuota').toFixed(2),
      monthlyRate: numberValue(item.tasaMensual, 'prestamo.tasaMensual').toFixed(8),
      method,
      note: optionalString(item.nota),
      legacyPaidCapital: paidRows.reduce((total, row) => total + Number(row.capital), 0).toFixed(2),
      legacyPaidInterest: paidRows.reduce((total, row) => total + Number(row.interest), 0).toFixed(2),
      firstInterest: (schedule[0] ? Number(schedule[0].interest) : 0).toFixed(2),
      lastDueDate: schedule.at(-1)?.dueDate ?? stringValue(item.fechaInicio, 'prestamo.fechaInicio'),
      schedule
    };
  });

  const normalizedMovements = movimientos.map((item) => {
    const parsedMonth = monthValue(item.mes, 'movimiento.mes');
    const memberId = optionalString(item.socioId);
    const member = memberId ? memberById.get(memberId) : null;
    return {
      legacyId: stringValue(item.id, 'movimiento.id'),
      effectiveDate: stringValue(item.fecha, 'movimiento.fecha'),
      month: parsedMonth.month,
      monthName: parsedMonth.label,
      category: stringValue(item.categoria, 'movimiento.categoria'),
      amount: numberValue(item.monto, 'movimiento.monto').toFixed(2),
      memberLegacyId: memberId,
      memberLabel: member ? `${member.nombre ?? ''} ${member.apellido ?? ''}`.trim() : 'Colectivo legacy',
      comment: optionalString(item.comentario),
      state: optionalString(item.estado)
    };
  });

  const normalizedPrizes = premios.map((item) => {
    const parsedMonth = monthValue(item.mes, 'premio.mes');
    return {
      legacyId: stringValue(item.id, 'premio.id'),
      month: parsedMonth.month,
      monthName: parsedMonth.label,
      type: stringValue(item.tipo, 'premio.tipo'),
      grossAmount: numberValue(item.monto, 'premio.monto').toFixed(2),
      winnerLegacyId: stringValue(item.socioId, 'premio.socioId'),
      game: optionalString(item.juego)
    };
  });

  const expectedCounts = {
    members: members.length,
    savingsContributions: savingsContributions.length,
    loans: loans.length,
    loanSchedules: loans.reduce((total, loan) => total + loan.schedule.length, 0),
    paidScheduleMarks: loans.reduce((total, loan) => total + loan.schedule.filter((row) => row.paid).length, 0),
    movements: normalizedMovements.length,
    pollaContributions: normalizedMovements.filter((item) => item.category === 'Polla-Aporte').length,
    fines: normalizedMovements.filter((item) => item.category === 'Multa').length,
    prizes: normalizedPrizes.length
  };
  const expectedTotals = {
    savings: sum(cuotas, 'monto').toFixed(2),
    loanPrincipal: sum(prestamos, 'principal').toFixed(2),
    paidScheduleAmount: loans.flatMap((loan) => loan.schedule).filter((row) => row.paid).reduce((total, row) => total + Number(row.amount), 0).toFixed(2),
    paidScheduleCapital: loans.flatMap((loan) => loan.schedule).filter((row) => row.paid).reduce((total, row) => total + Number(row.capital), 0).toFixed(2),
    paidScheduleInterest: loans.flatMap((loan) => loan.schedule).filter((row) => row.paid).reduce((total, row) => total + Number(row.interest), 0).toFixed(2),
    pollaContributions: normalizedMovements.filter((item) => item.category === 'Polla-Aporte').reduce((total, item) => total + Number(item.amount), 0).toFixed(2),
    fines: normalizedMovements.filter((item) => item.category === 'Multa').reduce((total, item) => total + Number(item.amount), 0).toFixed(2),
    prizesGross: normalizedPrizes.reduce((total, item) => total + Number(item.grossAmount), 0).toFixed(2)
  };

  const payload = {
    format: 'natillera-manager.legacy-2026.import-payload.v1',
    sourceHashes: { json: jsonHash, csv: csvHash },
    expectedCounts,
    expectedTotals,
    members,
    savingsContributions,
    loans,
    movements: normalizedMovements,
    prizes: normalizedPrizes
  };
  const payloadSha256 = sha256(JSON.stringify(payload));
  const finalPayload = { ...payload, payloadSha256 };

  if (expectedCounts.members !== 11 || expectedCounts.savingsContributions !== 107 || expectedCounts.loans !== 13 || expectedCounts.loanSchedules !== 84 || expectedCounts.paidScheduleMarks !== 51 || expectedCounts.movements !== 23 || expectedCounts.prizes !== 8) {
    throw new Error(`Controles de conteo fallaron: ${JSON.stringify(expectedCounts)}`);
  }
  if (
    expectedTotals.savings !== '15400000.00' ||
    expectedTotals.loanPrincipal !== '19420964.00' ||
    expectedTotals.paidScheduleAmount !== '10483160.00' ||
    expectedTotals.paidScheduleCapital !== '8985108.00' ||
    expectedTotals.paidScheduleInterest !== '1498052.00' ||
    expectedTotals.pollaContributions !== '990000.00' ||
    expectedTotals.fines !== '20000.00' ||
    expectedTotals.prizesGross !== '390000.00'
  ) {
    throw new Error(`Controles de suma fallaron: ${JSON.stringify(expectedTotals)}`);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno local.');
  }
  const client = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const workspaceName = process.env.NATILLERA_WORKSPACE_NAME ?? 'Natillera local';
  const cycleYear = Number(process.env.NATILLERA_CYCLE_YEAR ?? '2026');
  const { data: workspace, error: workspaceError } = await client.from('workspaces').select('id,name').eq('name', workspaceName).single();
  if (workspaceError) throw new Error(workspaceError.message);
  const { data: cycle, error: cycleError } = await client.from('cycles').select('id,year,name').eq('workspace_id', workspace.id).eq('year', cycleYear).single();
  if (cycleError) throw new Error(cycleError.message);

  const { data, error } = await client.rpc('import_natillera_legacy_2026', {
    p_workspace_id: workspace.id,
    p_cycle_id: cycle.id,
    p_payload: finalPayload
  });
  if (error) throw new Error(error.message);

  console.log(JSON.stringify({
    status: 'CARGA_EJECUTADA_Y_VERIFICADA',
    target: { url: supabaseUrl, workspace: workspace.name, cycle: cycle.name, year: cycle.year },
    result: data,
    controls: { expectedCounts, expectedTotals }
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
