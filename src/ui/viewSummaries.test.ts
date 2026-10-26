import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Cycle, CycleMember, LoanSchedule, SavingsContribution } from '../lib/types';
import { buildMonthRows, openInstallments, summarizeCollections, summarizeMonth } from './viewSummaries';

const cycle = { id: 'c1', year: 2026, starts_on: '2026-01-01', closes_on: '2026-12-31' } as Cycle;

function member(id: string, patch: Partial<CycleMember> = {}): CycleMember {
  return {
    id, monthly_quota: '150000', participation_start_month: 1, participation_end_month: 12,
    savings_status: 'active', participates_in_savings: true, ...patch
  } as CycleMember;
}

function contribution(memberId: string, month: number, amount: string): SavingsContribution {
  return { id: `${memberId}-${month}`, cycle_member_id: memberId, applied_year: 2026, applied_month: month, amount } as SavingsContribution;
}

describe('resumen mensual de ahorros', () => {
  it('un retirado que aportó ese mes cuenta en recaudo Y en esperado (50 %, no 100 %)', () => {
    const members = [member('a'), member('r', { savings_status: 'withdrawn', participates_in_savings: false })];
    const contributions = [contribution('r', 3, '150000'), contribution('a', 3, '0')];
    const rows = buildMonthRows(cycle, members, contributions, 3);
    const summary = summarizeMonth(rows);
    expect(summary.collected.toString()).toBe('150000');
    expect(summary.expected.toString()).toBe('300000');
    expect(summary.progress).toBe(50);
    expect(summary.pending).toBe(1);
    expect(summary.count).toBe(2);
  });

  it('un retirado sin aporte en un mes anterior a su último aporte sigue pendiente; posterior ya no cuenta', () => {
    const members = [member('r', { savings_status: 'withdrawn', participates_in_savings: false })];
    const contributions = [contribution('r', 1, '150000'), contribution('r', 4, '150000')];
    expect(buildMonthRows(cycle, members, contributions, 2).map((row) => row.state)).toEqual(['none']);
    expect(buildMonthRows(cycle, members, contributions, 5)).toHaveLength(0);
    expect(summarizeMonth(buildMonthRows(cycle, members, contributions, 5)).expected.toString()).toBe('0');
  });

  it('respeta el período de participación y no cuenta a quien nunca ahorró', () => {
    const members = [member('late', { participation_start_month: 6 }), member('never', { participates_in_savings: false, savings_status: 'inactive' })];
    expect(buildMonthRows(cycle, members, [], 3)).toHaveLength(0);
    expect(buildMonthRows(cycle, members, [], 6).map((row) => row.item.id)).toEqual(['late']);
  });

  it('recaudo, esperado y pendientes salen de la misma población', () => {
    const members = [member('a'), member('b'), member('c', { savings_status: 'withdrawn', participates_in_savings: false })];
    const contributions = [contribution('a', 2, '150000'), contribution('c', 2, '50000')];
    const rows = buildMonthRows(cycle, members, contributions, 2);
    const summary = summarizeMonth(rows);
    expect(summary.expected.toString()).toBe('450000');
    expect(summary.collected.toString()).toBe('200000');
    expect(summary.pending).toBe(2);
    expect(summary.count).toBe(rows.length);
  });
});

function schedule(n: number, due: string, patch: Partial<LoanSchedule> = {}): LoanSchedule {
  return {
    id: `s${n}`, loan_id: 'l', installment_number: n, due_date: due, principal_due: '50000', interest_due: '25000',
    status: 'projected', legacy_source_key: null, legacy_declared_paid: false, principal_paid: '0', interest_paid: '0', ...patch
  };
}

const TODAY = '2026-10-17';

describe('cobros vencidos y pagos de hoy', () => {
  it('cuota de hoy cuenta aunque el préstamo ya tenga otra cuota vencida', () => {
    const row = { loan: { status: 'active' }, schedules: [schedule(1, '2026-09-17'), schedule(2, TODAY), schedule(3, '2026-11-17')] };
    const found = openInstallments(row, TODAY);
    expect(found.overdue.map((item) => item.installment_number)).toEqual([1]);
    expect(found.dueToday.map((item) => item.installment_number)).toEqual([2]);
    const summary = summarizeCollections([row], TODAY);
    expect(summary.todayTotal.toString()).toBe('75000');
    expect(summary.todayLoans).toBe(1);
    expect(summary.overdueTotal.toString()).toBe('75000');
    expect(summary.overdueLoans).toBe(1);
    expect(summary.complete).toBe(true);
  });

  it('ignora cuotas pagadas, declaradas pagadas, pagos parciales se restan y préstamos no activos', () => {
    const rows = [
      { loan: { status: 'active' }, schedules: [schedule(1, '2026-09-01', { status: 'paid' }), schedule(2, '2026-09-02', { legacy_declared_paid: true }), schedule(3, TODAY, { principal_paid: '20000', interest_paid: '25000' })] },
      { loan: { status: 'paid' }, schedules: [schedule(1, TODAY)] },
      { loan: { status: 'draft' }, schedules: [] }
    ];
    const summary = summarizeCollections(rows, TODAY);
    expect(summary.overdueLoans).toBe(0);
    expect(summary.todayTotal.equals(new Decimal(30000))).toBe(true);
    expect(summary.complete).toBe(true);
  });

  it('si un préstamo activo no tiene cronograma el resumen queda incompleto (no es cero)', () => {
    const rows = [
      { loan: { status: 'active' }, schedules: [schedule(1, '2026-09-17')] },
      { loan: { status: 'active' }, schedules: [] }
    ];
    const summary = summarizeCollections(rows, TODAY);
    expect(summary.complete).toBe(false);
    expect(summary.unscheduledLoans).toBe(1);
    expect(summary.overdueLoans).toBe(1);
  });
});
