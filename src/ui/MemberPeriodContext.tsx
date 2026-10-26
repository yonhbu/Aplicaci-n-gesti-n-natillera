import type { Cycle, CycleMember, SavingsContribution } from '../lib/types';
import { buildMonthRows, summarizeMonth } from './viewSummaries';

/** Presentation of the existing savings population; no new monthly eligibility policy. */
export function memberPeriodContext(cycle: Cycle, members: CycleMember[], contributions: SavingsContribution[], cutDate: string) {
  const month = Number(cutDate.slice(5, 7));
  const inCycle = Number(cutDate.slice(0, 4)) === cycle.year;
  const dated = contributions.filter(item => item.effective_date <= cutDate && item.status !== 'reversed');
  const rows = inCycle ? buildMonthRows(cycle, members, dated, month) : [];
  const summary = summarizeMonth(rows);
  return {
    month, eligible: summary.count, complete: rows.filter(row => row.state === 'complete').length, pending: summary.pending,
    active: members.filter(item => inCycle && item.savings_status === 'active' && item.participation_start_month <= month && month <= item.participation_end_month).length,
    withdrawn: members.filter(item => item.savings_status === 'withdrawn').length
  };
}
export function MemberPeriodContext({ cycle, members, contributions, cutDate, compact = false, onSavings }: {
  cycle: Cycle; members: CycleMember[]; contributions: SavingsContribution[]; cutDate: string; compact?: boolean; onSavings?: () => void;
}) {
  const state = memberPeriodContext(cycle, members, contributions, cutDate);
  const month = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(cutDate + 'T12:00:00Z'));
  if (compact) return <div className="home-month-status"><span>{month} · {state.complete}/{state.eligible} cuotas completas{state.pending ? ` · ${state.pending} pendientes` : state.eligible ? ' · al día' : ' · sin cuotas exigibles'}</span>{onSavings ? <button type="button" className="link-button" onClick={onSavings}>Ver ahorros</button> : null}</div>;
  return <dl className="member-period-context" aria-label="Contexto mensual de socios">
    <div><dt>Activos actuales del periodo</dt><dd data-member-stat="active">{state.active}</dd></div>
    <div><dt>Al día</dt><dd data-member-stat="complete">{state.complete} de {state.eligible}</dd></div>
    <div><dt>Pendientes</dt><dd data-member-stat="pending">{state.pending}</dd></div>
    <div className="member-period-secondary"><dt>Retirados actuales</dt><dd>{state.withdrawn}</dd></div>
    <div className="member-period-note"><dt className="sr-only">Estado de participación</dt><dd>Estado actual; historial de cambios no disponible.</dd></div>
  </dl>;
}
