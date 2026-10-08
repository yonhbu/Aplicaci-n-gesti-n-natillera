import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import { getCurrentSession, logout, requestOtp, verifyOtp } from '../data/auth';
import { buildHu001Export } from '../data/export';
import { createCycleMember, listCycleMembers, updateCycleMember } from '../data/members';
import { listSavingsContributions, registerContribution } from '../data/savings';
import { fetchWorkspaceContext } from '../data/workspace';
import { monthKey } from '../domain/date';
import { prevalidateLegacySources, type LegacyPrevalidationReport } from '../domain/legacyPrevalidation';
import { formatCop, parseCop, toDatabaseMoney } from '../domain/money';
import { buildPendingContributionOperation, type PendingContributionOperation } from '../domain/pendingContribution';
import type { ContributionMethod } from '../domain/savings';
import { previewWithdrawal } from '../domain/withdrawal';
import { clearPendingContribution, readPendingContribution, writePendingContribution } from '../lib/pendingContributionStorage';
import { supabase } from '../lib/supabase';
import type { Cycle, CycleMember, SavingsContribution, Workspace } from '../lib/types';
import { userSafeError } from '../lib/userMessages';

const months = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

type ViewState = 'loading' | 'anonymous' | 'ready' | 'no-access' | 'error';

function makeIdempotencyKey() {
  return `ui-${crypto.randomUUID()}`;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [cycleMembers, setCycleMembers] = useState<CycleMember[]>([]);
  const [contributions, setContributions] = useState<SavingsContribution[]>([]);
  const [message, setMessage] = useState('');

  async function refreshAll() {
    const context = await fetchWorkspaceContext();
    setWorkspace(context.workspace);
    setCycle(context.activeCycle);
    if (!context.workspace || !context.activeCycle) {
      setCycleMembers([]);
      setContributions([]);
      setViewState('no-access');
      return;
    }
    const [membersData, contributionData] = await Promise.all([
      listCycleMembers(context.activeCycle.id),
      listSavingsContributions(context.activeCycle.id)
    ]);
    setCycleMembers(membersData);
    setContributions(contributionData);
    setViewState('ready');
  }

  async function handleContributionSaved() {
    try {
      await refreshAll();
      clearPendingContribution();
      setMessage('Aporte confirmado por la base.');
    } catch (error) {
      setMessage(`Aporte guardado, pero no se pudo refrescar la pantalla: ${userSafeError(error)}`);
      throw error;
    }
  }

  useEffect(() => {
    let mounted = true;
    getCurrentSession()
      .then(async (currentSession) => {
        if (!mounted) {
          return;
        }
        setSession(currentSession);
        if (!currentSession) {
          setViewState('anonymous');
          return;
        }
        await refreshAll();
      })
      .catch((error) => {
        setMessage(userSafeError(error));
        setViewState('error');
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setViewState('anonymous');
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (viewState === 'loading') {
    return <Shell><p className="status">Cargando sesion...</p></Shell>;
  }

  if (!session || viewState === 'anonymous') {
    return <Shell><LoginPanel onAuthenticated={refreshAll} /></Shell>;
  }

  if (viewState === 'no-access') {
    return (
      <Shell>
        <TopBar email={session.user.email ?? ''} onLogout={() => logout().then(() => setSession(null))} />
        <section className="panel">
          <h1>Sin acceso asignado</h1>
          <p>Tu usuario existe, pero no tiene membresia en ningun workspace de natillera. El bootstrap local debe asignarlo; la app no crea espacios en silencio.</p>
        </section>
      </Shell>
    );
  }

  if (viewState === 'error') {
    return <Shell><p className="error">{message}</p></Shell>;
  }

  if (!workspace || !cycle) {
    return null;
  }

  return (
    <Shell>
      <TopBar email={session.user.email ?? ''} onLogout={() => logout().then(() => setSession(null))} />
      {message ? <p className="notice">{message}</p> : null}
      <main className="layout">
        <section className="hero">
          <div>
            <p className="eyebrow">{workspace.name}</p>
            <h1>{cycle.name}</h1>
            <p>Ciclo {cycle.year}: {cycle.starts_on} a {cycle.closes_on}</p>
          </div>
          <ExportButton workspace={workspace} cycle={cycle} cycleMembers={cycleMembers} contributions={contributions} />
        </section>
        <SavingsSummary cycleMembers={cycleMembers} contributions={contributions} />
        <div className="columns">
          <MemberForm
            workspace={workspace}
            cycle={cycle}
            cycleMembers={cycleMembers}
            onSaved={async () => {
              await refreshAll();
              setMessage('Socio guardado.');
            }}
            onError={(error) => setMessage(userSafeError(error))}
          />
          <ContributionForm
            cycle={cycle}
            cycleMembers={cycleMembers}
            onSaved={handleContributionSaved}
            onError={(error) => setMessage(userSafeError(error))}
          />
        </div>
        <MembersTable cycleMembers={cycleMembers} contributions={contributions} />
        <WithdrawalPreviewPanel />
        <LegacyPanel />
        <FutureModules />
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      {children}
    </div>
  );
}

function TopBar({ email, onLogout }: { email: string; onLogout: () => void }) {
  return (
    <header className="topbar">
      <strong>Natillera Manager</strong>
      <div>
        <span>{email}</span>
        <button type="button" onClick={onLogout}>Salir</button>
      </div>
    </header>
  );
}

function LoginPanel({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (!sent) {
        await requestOtp(email);
        setSent(true);
      } else {
        await verifyOtp(email, token);
        await onAuthenticated();
      }
    } catch (caught) {
      setError(userSafeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login">
      <section className="panel login-panel">
        <p className="eyebrow">Acceso privado</p>
        <h1>Natillera Manager</h1>
        <form onSubmit={submit}>
          <label>
            Correo autorizado
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={pending || sent} />
          </label>
          {sent ? (
            <label>
              Codigo recibido
              <input value={token} onChange={(event) => setToken(event.target.value)} inputMode="numeric" required disabled={pending} />
            </label>
          ) : null}
          <button type="submit" disabled={pending}>{pending ? 'Procesando...' : sent ? 'Ingresar' : 'Enviar codigo'}</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}

function SavingsSummary({ cycleMembers, contributions }: { cycleMembers: CycleMember[]; contributions: SavingsContribution[] }) {
  const totals = useMemo(() => {
    const contributed = contributions.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    const expected = cycleMembers.reduce((sum, item) => {
      const activeMonths = item.participation_end_month - item.participation_start_month + 1;
      return sum.plus(new Decimal(item.monthly_quota).mul(activeMonths));
    }, new Decimal(0));
    return { contributed, expected, pending: Decimal.max(expected.minus(contributed), 0) };
  }, [cycleMembers, contributions]);

  return (
    <section className="metrics">
      <div>
        <span>Socios ciclo</span>
        <strong>{cycleMembers.length}</strong>
      </div>
      <div>
        <span>Ahorro recibido</span>
        <strong>{formatCop(totals.contributed)}</strong>
      </div>
      <div>
        <span>Cuotas esperadas ciclo</span>
        <strong>{formatCop(totals.expected)}</strong>
      </div>
      <div>
        <span>Pendiente descriptivo</span>
        <strong>{formatCop(totals.pending)}</strong>
      </div>
    </section>
  );
}

function MemberForm({
  workspace,
  cycle,
  cycleMembers,
  onSaved,
  onError
}: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [editingId, setEditingId] = useState('');
  const editing = cycleMembers.find((item) => item.id === editingId);
  const [displayName, setDisplayName] = useState('');
  const [legacyId, setLegacyId] = useState('');
  const [monthlyQuota, setMonthlyQuota] = useState('100.000');
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [participatesInPolla, setParticipatesInPolla] = useState(false);
  const [participatesInLoanProfit, setParticipatesInLoanProfit] = useState(true);
  const [pending, setPending] = useState(false);

  function loadEditing(value: string) {
    setEditingId(value);
    const selected = cycleMembers.find((item) => item.id === value);
    if (!selected) {
      setDisplayName('');
      setLegacyId('');
      setMonthlyQuota('100.000');
      setStartMonth(1);
      setEndMonth(12);
      setParticipatesInPolla(false);
      setParticipatesInLoanProfit(true);
      return;
    }
    setDisplayName(selected.member?.display_name ?? '');
    setLegacyId(selected.member?.legacy_id ?? '');
    setMonthlyQuota(new Decimal(selected.monthly_quota).toFixed(0));
    setStartMonth(selected.participation_start_month);
    setEndMonth(selected.participation_end_month);
    setParticipatesInPolla(selected.participates_in_polla);
    setParticipatesInLoanProfit(selected.participates_in_loan_profit);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const quota = toDatabaseMoney(parseCop(monthlyQuota, 'cuota mensual'));
      if (editing) {
        await updateCycleMember({
          workspaceId: workspace.id,
          cycleId: cycle.id,
          memberId: editing.member_id,
          cycleMemberId: editing.id,
          displayName,
          legacyId,
          monthlyQuota: quota,
          participationStartMonth: startMonth,
          participationEndMonth: endMonth,
          participatesInPolla,
          participatesInLoanProfit
        });
      } else {
        await createCycleMember({
          workspaceId: workspace.id,
          cycleId: cycle.id,
          displayName,
          legacyId,
          monthlyQuota: quota,
          participationStartMonth: startMonth,
          participationEndMonth: endMonth,
          participatesInPolla,
          participatesInLoanProfit
        });
      }
      loadEditing('');
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <h2>Socios</h2>
      <form onSubmit={submit} className="form-grid">
        <label>
          Editar socio
          <select aria-label="Editar socio" value={editingId} onChange={(event) => loadEditing(event.target.value)}>
            <option value="">Nuevo socio</option>
            {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
          </select>
        </label>
        <label>
          Nombre visible
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required disabled={pending} />
        </label>
        <label>
          Legacy ID
          <input value={legacyId} onChange={(event) => setLegacyId(event.target.value)} disabled={pending} />
        </label>
        <label>
          Cuota mensual
          <input value={monthlyQuota} onChange={(event) => setMonthlyQuota(event.target.value)} required disabled={pending} />
        </label>
        <MonthSelect label="Desde" value={startMonth} onChange={setStartMonth} disabled={pending} />
        <MonthSelect label="Hasta" value={endMonth} onChange={setEndMonth} disabled={pending} />
        <label className="check">
          <input type="checkbox" checked={participatesInPolla} onChange={(event) => setParticipatesInPolla(event.target.checked)} disabled={pending} />
          Participa en polla
        </label>
        <label className="check">
          <input type="checkbox" checked={participatesInLoanProfit} onChange={(event) => setParticipatesInLoanProfit(event.target.checked)} disabled={pending} />
          Participa en utilidad de prestamos
        </label>
        <button type="submit" disabled={pending}>{pending ? 'Guardando...' : editing ? 'Actualizar socio' : 'Crear socio'}</button>
      </form>
    </section>
  );
}

function ContributionForm({
  cycle,
  cycleMembers,
  onSaved,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [cycleMemberId, setCycleMemberId] = useState('');
  const [amountText, setAmountText] = useState('100.000');
  const [effectiveDate, setEffectiveDate] = useState('2026-09-23');
  const [appliedMonth, setAppliedMonth] = useState(10);
  const [method, setMethod] = useState<ContributionMethod>('bank_transfer');
  const [pendingOperation, setPendingOperation] = useState<PendingContributionOperation | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const stored = readPendingContribution();
    if (!stored || stored.draft.appliedYear !== cycle.year) {
      return;
    }
    setPendingOperation(stored);
    setCycleMemberId(stored.draft.memberId);
    setAmountText(stored.draft.amount);
    setEffectiveDate(stored.draft.effectiveDate);
    setAppliedMonth(stored.draft.appliedMonth);
    setMethod(stored.draft.method);
  }, [cycle.year]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    let operationForRetry: PendingContributionOperation | null = null;
    let savedByServer = false;
    try {
      const operation = buildPendingContributionOperation({
        existing: pendingOperation,
        now: new Date(),
        makeKey: makeIdempotencyKey,
        draft: {
        memberId: cycleMemberId,
        amountText,
        effectiveDate,
        appliedYear: cycle.year,
        appliedMonth,
        method,
        idempotencyKey: pendingOperation?.idempotencyKey ?? 'pending-client-key'
        }
      });
      operationForRetry = operation;
      setPendingOperation(operation);
      writePendingContribution(operation);
      await registerContribution({
        cycleMemberId: operation.draft.memberId,
        amount: operation.draft.amount,
        effectiveDate: operation.draft.effectiveDate,
        appliedYear: operation.draft.appliedYear,
        appliedMonth: operation.draft.appliedMonth,
        method,
        idempotencyKey: operation.idempotencyKey
      });
      savedByServer = true;
      await onSaved();
      setPendingOperation(null);
    } catch (error) {
      if (operationForRetry && !savedByServer) {
        const unknownOperation = { ...operationForRetry, status: 'unknown' as const, updatedAt: new Date().toISOString() };
        setPendingOperation(unknownOperation);
        writePendingContribution(unknownOperation);
      }
      onError(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel">
      <h2>Aportes de ahorro</h2>
      {pendingOperation ? (
        <p className="warning">
          Hay un aporte pendiente de confirmacion local. Reintenta sin cambiar los datos para resolver la misma operacion.
        </p>
      ) : null}
      <form onSubmit={submit} className="form-grid">
        <label>
          Socio
          <select aria-label="Socio del aporte" value={cycleMemberId} onChange={(event) => setCycleMemberId(event.target.value)} required disabled={pending}>
            <option value="">Seleccionar</option>
            {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
          </select>
        </label>
        <label>
          Monto recibido
          <input value={amountText} onChange={(event) => setAmountText(event.target.value)} required disabled={pending} />
        </label>
        <label>
          Fecha efectiva
          <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required disabled={pending} />
        </label>
        <MonthSelect label="Mes aplicado" value={appliedMonth} onChange={setAppliedMonth} disabled={pending} />
        <label>
          Metodo
          <select value={method} onChange={(event) => setMethod(event.target.value as ContributionMethod)} disabled={pending}>
            <option value="bank_transfer">Transferencia</option>
            <option value="bank_deposit">Consignacion banco</option>
            <option value="cash">Efectivo</option>
            <option value="other">Otro</option>
          </select>
        </label>
        <button type="submit" disabled={pending || cycleMembers.length === 0}>{pending ? 'Confirmando...' : 'Registrar aporte'}</button>
      </form>
    </section>
  );
}

function MembersTable({ cycleMembers, contributions }: { cycleMembers: CycleMember[]; contributions: SavingsContribution[] }) {
  const rows = cycleMembers.map((item) => {
    const own = contributions.filter((contribution) => contribution.cycle_member_id === item.id);
    const total = own.reduce((sum, contribution) => sum.plus(contribution.amount), new Decimal(0));
    const byMonth = new Map<string, Decimal>();
    for (const contribution of own) {
      const key = monthKey(contribution.applied_year, contribution.applied_month);
      byMonth.set(key, (byMonth.get(key) ?? new Decimal(0)).plus(contribution.amount));
    }
    return { item, total, byMonth };
  });

  return (
    <section className="panel wide">
      <h2>Detalle por socio</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Socio</th>
              <th>Cuota</th>
              <th>Rango</th>
              <th>Recibido</th>
              <th>Ultimos meses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, total, byMonth }) => (
              <tr key={item.id}>
                <td>{item.member?.display_name}</td>
                <td>{formatCop(item.monthly_quota)}</td>
                <td>{months[item.participation_start_month - 1]} - {months[item.participation_end_month - 1]}</td>
                <td>{formatCop(total)}</td>
                <td>{Array.from(byMonth.entries()).slice(-4).map(([key, value]) => `${key}: ${formatCop(value)}`).join(' · ') || 'Sin aportes'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WithdrawalPreviewPanel() {
  const preview = previewWithdrawal({
    contributions: [
      '2026-01-05',
      '2026-02-05',
      '2026-03-01',
      '2026-04-01',
      '2026-05-05',
      '2026-06-05',
      '2026-07-03',
      '2026-08-04',
      '2026-09-05',
      '2026-09-23'
    ].map((effectiveDate) => ({ amount: 100_000, effectiveDate })),
    cutDate: '2026-10-06',
    annualEffectiveRate: 0.12,
    pendingNetPrizes: 0,
    debts: 0,
    annualAdminFee: 20_000,
    penalty: 50_000
  });

  return (
    <section className="panel">
      <h2>Previsualizacion pura de retiro</h2>
      <dl className="definition-grid">
        <dt>Ahorro fixture</dt>
        <dd>{formatCop(preview.contributed)}</dd>
        <dt>Rendimiento 12% EA</dt>
        <dd>{formatCop(preview.recognizedYieldRounded, 2)}</dd>
        <dt>Neto escenario A</dt>
        <dd>{formatCop(preview.net, 2)}</dd>
        <dt>Transferencia redondeada</dt>
        <dd>{formatCop(preview.transferRounded)}</dd>
      </dl>
    </section>
  );
}

function LegacyPanel() {
  const [report, setReport] = useState<LegacyPrevalidationReport | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [jsonText, setJsonText] = useState('');

  async function readFile(file: File | undefined, setter: (text: string) => void) {
    if (!file) {
      setter('');
      return;
    }
    setter(await file.text());
  }

  function run() {
    setPending(true);
    setError('');
    try {
      setReport(prevalidateLegacySources({ csvText: csvText || undefined, jsonText: jsonText || undefined }));
    } catch (caught) {
      setError(userSafeError(caught));
    } finally {
      setPending(false);
    }
  }

  function downloadReport() {
    if (!report) {
      return;
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'natillera-hu001-prevalidacion.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel wide">
      <h2>Prevalidacion legacy</h2>
      <div className="file-grid">
        <label>
          CSV legacy
          <input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0], setCsvText)} />
        </label>
        <label>
          JSON respaldo navegador
          <input type="file" accept=".json,application/json" onChange={(event) => void readFile(event.target.files?.[0], setJsonText)} />
        </label>
      </div>
      <div className="actions">
        <button type="button" onClick={run} disabled={pending || (!csvText && !jsonText)}>{pending ? 'Validando...' : 'Validar fuentes'}</button>
        <button type="button" onClick={downloadReport} disabled={!report}>Descargar reporte</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {report ? (
        <div className="report">
          <pre>{JSON.stringify(report.inventory, null, 2)}</pre>
          <ul>
            {report.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.severity}</strong> {issue.code}: {issue.message}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FutureModules() {
  return (
    <section className="panel wide muted">
      <h2>Modulos posteriores</h2>
      <p>Prestamos, pollas, liquidaciones, comprobantes privados, banco real y conciliacion quedan bloqueados para HUs posteriores. Esta version no simula saldos ni pagos inexistentes.</p>
    </section>
  );
}

function ExportButton({
  workspace,
  cycle,
  cycleMembers,
  contributions
}: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
}) {
  function exportData() {
    const blob = new Blob([
      JSON.stringify(buildHu001Export({ workspace, cycle, cycleMembers, contributions }), null, 2)
    ], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'natillera-manager-hu001-export.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return <button type="button" onClick={exportData}>Exportar HU-001</button>;
}

function MonthSelect({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled}>
        {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
      </select>
    </label>
  );
}
