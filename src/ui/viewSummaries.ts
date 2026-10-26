import Decimal from 'decimal.js';
import type { Cycle, CycleMember, LoanSchedule, SavingsContribution } from '../lib/types';

// Resúmenes de solo lectura para las vistas de Ahorros y Préstamos. No escriben, no cotizan y no recalculan intereses:
// solo agrupan datos ya cargados.

export function progressPercent(received: Decimal, expected: Decimal) {
  if (expected.lte(0)) {
    return received.gt(0) ? 100 : 0;
  }
  return Math.min(100, Math.floor(received.div(expected).mul(100).toNumber()));
}

// ---------- Ahorros: población por mes ----------

export type MonthRow = { item: CycleMember; paid: Decimal; quota: Decimal; eligible: boolean; state: 'complete' | 'partial' | 'none' };

// La participación se decide PARA EL MES CONSULTADO, no por el estado actual del socio:
// - Socio activo que ahorra: participa si el mes está dentro de su período.
// - Socio retirado/inactivo: el retiro no guarda fecha, así que se infiere que participó dentro de su período
//   hasta el último mes con aporte registrado; después de ese mes ya no cuenta.
// - Quien aportó ese mes siempre participa ese mes (su cuota entra al esperado).
// Recaudo, esperado y pendientes se calculan sobre esta misma población (las filas devueltas).
export function buildMonthRows(cycle: Cycle, cycleMembers: CycleMember[], contributions: SavingsContribution[], month: number): MonthRow[] {
  const paidByMember = new Map<string, Decimal>();
  const lastMonthByMember = new Map<string, number>();
  for (const item of contributions) {
    if (item.applied_year !== cycle.year) continue;
    if (item.applied_month === month) {
      paidByMember.set(item.cycle_member_id, (paidByMember.get(item.cycle_member_id) ?? new Decimal(0)).plus(item.amount));
    }
    lastMonthByMember.set(item.cycle_member_id, Math.max(lastMonthByMember.get(item.cycle_member_id) ?? 0, item.applied_month));
  }
  const rows: MonthRow[] = [];
  for (const item of cycleMembers) {
    const paid = paidByMember.get(item.id) ?? new Decimal(0);
    const inPeriod = item.participation_start_month <= month && month <= item.participation_end_month;
    const stillSaving = item.savings_status === 'active' && item.participates_in_savings !== false;
    const lastMonth = lastMonthByMember.get(item.id);
    const participated = inPeriod && (stillSaving || (lastMonth !== undefined && month <= lastMonth));
    const eligible = participated || paid.gt(0);
    if (!eligible) continue;
    const quota = new Decimal(item.monthly_quota);
    const state: MonthRow['state'] = paid.gte(quota) && paid.gt(0) ? 'complete' : paid.gt(0) ? 'partial' : 'none';
    rows.push({ item, paid, quota, eligible, state });
  }
  return rows;
}

export function summarizeMonth(rows: MonthRow[]) {
  const collected = rows.reduce((sum, row) => sum.plus(row.paid), new Decimal(0));
  const expected = rows.reduce((sum, row) => sum.plus(row.quota), new Decimal(0));
  return {
    collected,
    expected,
    contributors: rows.filter((row) => row.paid.gt(0)).length,
    pending: rows.filter((row) => row.state !== 'complete').length,
    count: rows.length,
    progress: progressPercent(collected, expected)
  };
}

// ---------- Préstamos: cuotas abiertas ----------

export function isSchedulePaid(schedule: LoanSchedule) {
  return schedule.status === 'paid' || schedule.legacy_declared_paid;
}

export function scheduleRemaining(schedule: LoanSchedule) {
  const capital = Decimal.max(0, new Decimal(schedule.principal_due).minus(schedule.principal_paid ?? 0));
  const interest = Decimal.max(0, new Decimal(schedule.interest_due).minus(schedule.interest_paid ?? 0));
  return { capital, interest, total: capital.plus(interest) };
}

type CollectionRow = { loan: { status: string }; schedules: LoanSchedule[] };

// Cuotas abiertas (ni pagadas ni canceladas, estas ya vienen filtradas) de un préstamo activo, separadas por fecha.
// Un préstamo con una cuota vencida y otra que vence hoy aparece en ambas listas; su clasificación de mora no cambia.
export function openInstallments(row: CollectionRow, today: string) {
  if (row.loan.status !== 'active') return { overdue: [] as LoanSchedule[], dueToday: [] as LoanSchedule[] };
  const open = row.schedules.filter((schedule) => !isSchedulePaid(schedule));
  return {
    overdue: open.filter((schedule) => schedule.due_date < today),
    dueToday: open.filter((schedule) => schedule.due_date === today)
  };
}

const sumRemaining = (schedules: LoanSchedule[], start: Decimal) => schedules.reduce((sum, schedule) => sum.plus(scheduleRemaining(schedule).total), start);

// Si algún préstamo activo no tiene cronograma, no se sabe cuánto vence: el resumen marca `complete: false`
// y las cifras pasan a ser un mínimo conocido, nunca un cero.
export function summarizeCollections(rows: CollectionRow[], today: string) {
  const active = rows.filter((row) => row.loan.status === 'active');
  const unscheduledLoans = active.filter((row) => row.schedules.length === 0).length;
  let overdueTotal = new Decimal(0);
  let overdueLoans = 0;
  let todayTotal = new Decimal(0);
  let todayLoans = 0;
  for (const row of active) {
    const { overdue, dueToday } = openInstallments(row, today);
    if (overdue.length) { overdueLoans += 1; overdueTotal = sumRemaining(overdue, overdueTotal); }
    if (dueToday.length) { todayLoans += 1; todayTotal = sumRemaining(dueToday, todayTotal); }
  }
  return { overdueTotal, overdueLoans, todayTotal, todayLoans, unscheduledLoans, complete: unscheduledLoans === 0 };
}
