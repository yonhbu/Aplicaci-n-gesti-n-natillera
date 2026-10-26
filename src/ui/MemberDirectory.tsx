import { useMemo, useState } from 'react';
import type { Cycle, CycleMember, MemberSettlement, SavingsContribution } from '../lib/types';
import { formatCop } from '../domain/money';
import { FinancialCutPicker } from './FinancialCut';
import { memberPeriodContext } from './MemberPeriodContext';
import { memberIsCollective, memberSavingsOverview, memberStateAtCut, filterMember, type MemberFilter, type PresentedMemberState } from './memberOverview';
import { Avatar, QuickIcon } from './OverviewPrimitives';
import { displayDate } from './displayDate';

const labels: Record<PresentedMemberState, string> = { active: 'Activo', withdrawn: 'Retirado', inactive: 'Inactivo', outside: 'Fuera del periodo', unknown: 'No verificable' };
const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
type ContextProps = { cycle: Cycle; members: CycleMember[]; contributions: SavingsContribution[]; settlements: MemberSettlement[]; cutDate: string; today: string };

export function MemberKpis({ cycle, members, contributions, settlements, cutDate, today }: ContextProps) {
  const period = memberPeriodContext(cycle, members, contributions, cutDate);
  const states = members.map(item => memberStateAtCut(item, cycle, cutDate, today, settlements));
  const unknown = states.filter(state => state === 'unknown').length;
  const active = states.filter(state => state === 'active').length;
  return <>
    <div className="member-kpis" aria-label="Contexto mensual de socios">
      <div className="member-kpi member-kpi-date"><span className="metric-icon quick-green"><QuickIcon path="M7 3v4M17 3v4M4 9h16M4 5h16v16H4z" /></span><FinancialCutPicker appearance="card" /></div>
      <div className="member-kpi"><span className="metric-icon quick-blue"><QuickIcon path="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></span><div><span className="member-kpi-label">Activos en el periodo</span><strong className={unknown ? 'member-kpi-value is-unavailable' : 'member-kpi-value'} data-member-stat="active">{unknown ? 'No verificable' : active}</strong>{unknown ? <small>{unknown} sin historia de estado</small> : null}</div></div>
      <div className="member-kpi"><span className="metric-icon quick-violet"><QuickIcon path="M5 20V10M12 20V4M19 20v-7" /></span><div><span className="member-kpi-label">Al día este mes</span><strong className="member-kpi-value" data-member-stat="complete">{period.complete} de {period.eligible}</strong></div></div>
      <div className="member-kpi"><span className="metric-icon quick-amber"><QuickIcon path="M12 8v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0" /></span><div><span className="member-kpi-label">Pendientes del mes</span><strong className="member-kpi-value" data-member-stat="pending">{period.pending}</strong></div></div>
    </div>
    {unknown ? <p className="member-history-note" role="status">El estado histórico de {unknown} socio(s) no es verificable con los registros disponibles. Las cuotas conservan el criterio mensual de Ahorros.</p> : null}
  </>;
}

export function MemberDirectory({ cycle, members, contributions, settlements, cutDate, today, onNew, onEdit, onDetail, onViewSavings }: ContextProps & {
  onNew: () => void; onEdit: (id: string) => void; onDetail: (id: string) => void; onViewSavings: (id: string) => void;
}) {
  const key = 'natillera:member-directory:' + cycle.id;
  const [search, setSearch] = useState<{ query: string; filter: MemberFilter }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      return { query: typeof saved.query === 'string' ? saved.query : '', filter: ['all', 'active', 'fixed', 'collective'].includes(saved.filter) ? saved.filter : 'all' };
    } catch { return { query: '', filter: 'all' }; }
  });
  const update = (patch: Partial<typeof search>) => setSearch(current => {
    const next = { ...current, ...patch }; sessionStorage.setItem(key, JSON.stringify(next)); return next;
  });
  const rows = useMemo(() => members.map(item => ({ item, state: memberStateAtCut(item, cycle, cutDate, today, settlements), savings: memberSavingsOverview(item, contributions, cutDate) })), [members, cycle, cutDate, today, settlements, contributions]);
  const visible = rows.filter(({ item, state }) => filterMember(item, state, search.query, search.filter));
  const filters: { id: MemberFilter; label: string }[] = [{ id: 'all', label: 'Todos' }, { id: 'active', label: 'Activos' }, { id: 'fixed', label: 'Solo ahorro (B)' }, { id: 'collective', label: 'Polla y rendimientos (A)' }];
  return <div className="member-directory">
    <div className="member-toolbar">
      <label className="member-search"><QuickIcon path="M21 21l-5-5M18 10a8 8 0 11-16 0 8 8 0 0116 0" /><span className="sr-only">Buscar socio</span><input type="search" placeholder="Buscar socio" value={search.query} onChange={event => update({ query: event.target.value })} /></label>
      <div className="member-filters" role="group" aria-label="Filtrar socios">{filters.map(filter => <button key={filter.id} type="button" aria-pressed={search.filter === filter.id} onClick={() => update({ filter: filter.id })}>{filter.label}</button>)}</div>
      <small className="member-filter-hint">Desliza para ver todos los filtros ›</small>
      <button type="button" className="member-new" onClick={onNew}><QuickIcon path="M12 5v14M5 12h14" />Nuevo socio</button>
    </div>
    <section className="member-list" aria-labelledby="socios-titulo">
      <div className="member-list-heading"><h2 id="socios-titulo">Listado de socios</h2><span role="status" aria-live="polite">{visible.length} de {members.length} socios</span></div>
      {visible.length ? <table className="member-directory-table"><thead><tr>{['Socio', 'Modalidad', 'Estado al corte', 'Periodo', 'Total aportado', 'Avance', 'Acciones'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
        {visible.map(({ item, state, savings }) => <tr key={item.id} data-savings-member-row={item.id}>
          <td className="directory-name"><div className="member-identity"><Avatar name={item.member?.display_name ?? 'Socio'} /><div><strong>{item.member?.display_name ?? 'Socio sin nombre'}</strong>{item.member?.legacy_id ? <small>{item.member.legacy_id}</small> : null}</div></div></td>
          <td className="directory-mode"><span className="directory-mobile-label">Modalidad</span>{memberIsCollective(item) ? 'A · Polla y rendimientos' : 'B · Solo ahorro'}</td>
          <td className="directory-state"><span className={`member-state-pill is-${state}`}><span aria-hidden="true" />{labels[state]}</span></td>
          <td className="directory-period"><span className="directory-mobile-label">Periodo</span>{months[item.participation_start_month - 1]} – {months[item.participation_end_month - 1]}</td>
          <td className="directory-received"><span className="directory-mobile-label">Total aportado</span><strong>{formatCop(savings.received, 2)}</strong><small>{savings.lastDate ? `Último: ${displayDate(savings.lastDate)}` : 'Sin aportes al corte'}</small></td>
          <td className="directory-progress">{savings.target && savings.progress !== null ? <><div className="member-progress-line"><div className="member-progress" role="progressbar" aria-label={`Avance de aportes de ${item.member?.display_name ?? 'socio'}`} aria-valuenow={savings.progress} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${savings.progress} %, ${formatCop(savings.received, 2)} de ${formatCop(savings.target, 2)} según cuota y periodo registrados`}><span style={{ width: `${savings.progress}%` }} /></div><span>{savings.progress}%</span></div><small>Meta: {formatCop(savings.target, 2)}</small>{savings.received.gt(savings.target) ? <small>Meta superada</small> : null}</> : <small>Sin meta de aportes aplicable</small>}</td>
          <td className="directory-actions"><button type="button" onClick={() => onViewSavings(item.id)}><QuickIcon path="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 11-6 0 3 3 0 016 0" />Ver ahorro</button><button type="button" onClick={() => onDetail(item.id)}><QuickIcon path="M14 2H6v20h12V6zM14 2v5h5M9 12h6M9 16h6" />Detalle</button><button type="button" onClick={() => onEdit(item.id)}><QuickIcon path="M14 5l5 5M4 20l4-1L21 6l-4-4L4 15z" />Editar</button></td>
        </tr>)}
      </tbody></table> : <p className="member-empty">{members.length ? search.filter === 'active' && rows.some(row => row.state === 'unknown') && !search.query ? 'No hay socios activos verificables al corte. Consulta Todos para revisar los estados no verificables.' : 'No hay socios que coincidan con la búsqueda y los filtros.' : 'Aún no hay socios en este ciclo. Usa "Nuevo socio" para crear el primero.'}</p>}
      <details className="member-summary-help"><summary>Sobre este resumen de ahorro</summary><p>Total aportado suma aportes ordinarios no anulados hasta el corte; no incluye premios ni rendimientos. La meta usa la cuota y el periodo registrados, sin certificar versiones históricas del acuerdo. El avance se limita visualmente al 100 %; los importes conservan todos sus centavos. Consulta Ver ahorro para el detalle.</p></details>
    </section>
  </div>;
}
