import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import { getCurrentSession, logout, requestOtp, verifyOtp } from '../data/auth';
import {
  confirmLoanProfitDistribution,
  confirmMemberSettlement,
  createBankAccount,
  createBankReconciliation,
  createLoanProfitDistributionPolicy,
  listBankAccounts,
  listBankReconciliations,
  listLoanProfitDistributionAllocations,
  listLoanProfitDistributionPayments,
  listLoanProfitDistributionPolicies,
  listLoanProfitDistributions,
  listMemberSettlementPayments,
  listMemberSettlements,
  payLoanProfitDistribution,
  payMemberSettlement,
  previewLoanProfitDistribution,
  previewMemberSettlement,
  recordBankFee,
  recordBankExternalFinancing,
  recordBankInterest,
  recordBankOpening,
  recordLiquidityTransfer,
  type LiquidityLocation,
  type ProfitDistributionPreview,
  type SettlementPreview
} from '../data/blockC';
import { buildBlockDExport } from '../data/export';
import { listFinancialOperations, listLedgerEntries } from '../data/finance';
import { confirmLoanDisbursement, confirmLoanPrepayment, createLoanContract, listLoanPayments, listLoanSchedules, listLoans, quoteLoanPrepayment, recordLoanPayment, type LoanPrepaymentQuote } from '../data/loans';
import { createCycleMember, listCycleMembers, updateCycleMember } from '../data/members';
import { awardPollaPrize, createPollaActivity, listPollaActivities, listPollaContributions, listPollaPrizes, payPollaPrize, registerPollaContribution } from '../data/polla';
import { listSavingsContributions, registerContribution } from '../data/savings';
import { fetchWorkspaceContext } from '../data/workspace';
import { monthKey } from '../domain/date';
import { prevalidateLegacySources, type LegacyPrevalidationReport } from '../domain/legacyPrevalidation';
import { buildMigrationDryRun, type MigrationDryRunReport } from '../domain/migrationD';
import { formatCop, parseCop, toDatabaseMoney } from '../domain/money';
import { buildPendingContributionOperation, type PendingContributionOperation } from '../domain/pendingContribution';
import type { ContributionMethod } from '../domain/savings';
import { previewWithdrawal } from '../domain/withdrawal';
import { clearPendingContribution, readPendingContribution, writePendingContribution } from '../lib/pendingContributionStorage';
import { clearPendingFinancialOperation, getOrCreatePendingFinancialOperation, writePendingFinancialOperation, type PendingFinancialOperation } from '../lib/pendingFinancialOperationStorage';
import { supabase } from '../lib/supabase';
import type { BankAccount, BankReconciliation, Cycle, CycleMember, FinancialOperation, LedgerEntry, LoanContract, LoanPayment, LoanProfitDistribution, LoanProfitDistributionAllocation, LoanProfitDistributionPayment, LoanProfitDistributionPolicy, LoanSchedule, MemberSettlement, MemberSettlementPayment, PollaActivity, PollaContribution, PollaPrize, SavingsContribution, Workspace } from '../lib/types';
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
type AppSectionId = 'home' | 'savings' | 'loans' | 'polla' | 'more';
type MoreSectionId = 'bank' | 'movements' | 'settlements' | 'profit' | 'exports' | 'migration';

const appSections: { id: AppSectionId; label: string }[] = [
  { id: 'home', label: 'Inicio' },
  { id: 'savings', label: 'Ahorros' },
  { id: 'loans', label: 'Prestamos' },
  { id: 'polla', label: 'Polla' },
  { id: 'more', label: 'Mas' }
];

const moreSections: { id: MoreSectionId; label: string }[] = [
  { id: 'bank', label: 'Banco y caja' },
  { id: 'movements', label: 'Movimientos' },
  { id: 'settlements', label: 'Liquidaciones' },
  { id: 'profit', label: 'Utilidad' },
  { id: 'exports', label: 'Respaldos' },
  { id: 'migration', label: 'Migracion' }
];

function makeIdempotencyKey() {
  return `ui-${crypto.randomUUID()}`;
}

function todayCivilDate() {
  return new Date().toISOString().slice(0, 10);
}

function isAmbiguousOperationError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('failed to fetch') || message.includes('network') || message.includes('timeout') || message.includes('aborted');
}

async function runPendingFinancialAction(input: {
  scope: string;
  payload: Record<string, unknown>;
  setPending: (value: boolean) => void;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
  action: (idempotencyKey: string) => Promise<unknown>;
}) {
  input.setPending(true);
  let operation: PendingFinancialOperation | null = null;
  try {
    operation = getOrCreatePendingFinancialOperation(input.scope, input.payload, makeIdempotencyKey);
    await input.action(operation.idempotencyKey);
    clearPendingFinancialOperation(input.scope);
    await input.onSaved();
  } catch (error) {
    if (operation && isAmbiguousOperationError(error)) {
      writePendingFinancialOperation({ ...operation, status: 'uncertain' });
    } else if (operation) {
      clearPendingFinancialOperation(input.scope);
    }
    input.onError(error);
  } finally {
    input.setPending(false);
  }
}

function readNavigationHash(): { section: AppSectionId; moreSection: MoreSectionId } {
  const [sectionValue, moreValue] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = appSections.some((item) => item.id === sectionValue) ? sectionValue as AppSectionId : 'home';
  const moreSection = moreSections.some((item) => item.id === moreValue) ? moreValue as MoreSectionId : 'bank';
  return { section, moreSection };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [cycleMembers, setCycleMembers] = useState<CycleMember[]>([]);
  const [contributions, setContributions] = useState<SavingsContribution[]>([]);
  const [operations, setOperations] = useState<FinancialOperation[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loans, setLoans] = useState<LoanContract[]>([]);
  const [loanPayments, setLoanPayments] = useState<LoanPayment[]>([]);
  const [loanSchedules, setLoanSchedules] = useState<LoanSchedule[]>([]);
  const [pollaActivities, setPollaActivities] = useState<PollaActivity[]>([]);
  const [pollaContributions, setPollaContributions] = useState<PollaContribution[]>([]);
  const [pollaPrizes, setPollaPrizes] = useState<PollaPrize[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankReconciliations, setBankReconciliations] = useState<BankReconciliation[]>([]);
  const [memberSettlements, setMemberSettlements] = useState<MemberSettlement[]>([]);
  const [memberSettlementPayments, setMemberSettlementPayments] = useState<MemberSettlementPayment[]>([]);
  const [loanProfitDistributions, setLoanProfitDistributions] = useState<LoanProfitDistribution[]>([]);
  const [loanProfitDistributionPayments, setLoanProfitDistributionPayments] = useState<LoanProfitDistributionPayment[]>([]);
  const [loanProfitDistributionPolicies, setLoanProfitDistributionPolicies] = useState<LoanProfitDistributionPolicy[]>([]);
  const [loanProfitDistributionAllocations, setLoanProfitDistributionAllocations] = useState<LoanProfitDistributionAllocation[]>([]);
  const initialNavigation = readNavigationHash();
  const [activeSection, setActiveSectionState] = useState<AppSectionId>(initialNavigation.section);
  const [activeMoreSection, setActiveMoreSectionState] = useState<MoreSectionId>(initialNavigation.moreSection);
  const [legacyPrevalidationReport, setLegacyPrevalidationReport] = useState<LegacyPrevalidationReport | null>(null);
  const [migrationDryRunReport, setMigrationDryRunReport] = useState<MigrationDryRunReport | null>(null);
  const [message, setMessage] = useState('');

  function navigate(section: AppSectionId, moreSection = activeMoreSection) {
    setActiveSectionState(section);
    if (section === 'more') {
      setActiveMoreSectionState(moreSection);
    }
    window.location.hash = section === 'more' ? `/${section}/${moreSection}` : `/${section}`;
  }

  function navigateMore(section: MoreSectionId) {
    setActiveMoreSectionState(section);
    setActiveSectionState('more');
    window.location.hash = `/more/${section}`;
  }

  async function refreshAll() {
    const context = await fetchWorkspaceContext();
    setWorkspace(context.workspace);
    setCycle(context.activeCycle);
    if (!context.workspace || !context.activeCycle) {
      setCycleMembers([]);
      setContributions([]);
      setBankAccounts([]);
      setBankReconciliations([]);
      setMemberSettlements([]);
      setMemberSettlementPayments([]);
      setLoanProfitDistributions([]);
      setLoanProfitDistributionPayments([]);
      setLoanProfitDistributionPolicies([]);
      setLoanProfitDistributionAllocations([]);
      setViewState('no-access');
      return;
    }
    const [membersData, contributionData] = await Promise.all([
      listCycleMembers(context.activeCycle.id),
      listSavingsContributions(context.activeCycle.id)
    ]);
    const [operationData, ledgerData, loansData, loanPaymentsData, loanScheduleData, activitiesData, pollaContributionData, prizesData, bankAccountData, reconciliationData, settlementData, settlementPaymentData, distributionData, distributionPaymentData, policyData, allocationData] = await Promise.all([
      listFinancialOperations(context.activeCycle.id),
      listLedgerEntries(context.activeCycle.id),
      listLoans(context.activeCycle.id),
      listLoanPayments(context.activeCycle.id),
      listLoanSchedules(context.activeCycle.id),
      listPollaActivities(context.activeCycle.id),
      listPollaContributions(context.activeCycle.id),
      listPollaPrizes(context.activeCycle.id),
      listBankAccounts(context.workspace.id),
      listBankReconciliations(context.activeCycle.id),
      listMemberSettlements(context.activeCycle.id),
      listMemberSettlementPayments(context.activeCycle.id),
      listLoanProfitDistributions(context.activeCycle.id),
      listLoanProfitDistributionPayments(context.activeCycle.id),
      listLoanProfitDistributionPolicies(context.activeCycle.id),
      listLoanProfitDistributionAllocations(context.activeCycle.id)
    ]);
    setOperations(operationData);
    setCycleMembers(membersData);
    setContributions(contributionData);
    setLedgerEntries(ledgerData);
    setLoans(loansData);
    setLoanPayments(loanPaymentsData);
    setLoanSchedules(loanScheduleData);
    setPollaActivities(activitiesData);
    setPollaContributions(pollaContributionData);
    setPollaPrizes(prizesData);
    setBankAccounts(bankAccountData);
    setBankReconciliations(reconciliationData);
    setMemberSettlements(settlementData);
    setMemberSettlementPayments(settlementPaymentData);
    setLoanProfitDistributions(distributionData);
    setLoanProfitDistributionPayments(distributionPaymentData);
    setLoanProfitDistributionPolicies(policyData);
    setLoanProfitDistributionAllocations(allocationData);
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

  useEffect(() => {
    function syncFromHash() {
      const next = readNavigationHash();
      setActiveSectionState(next.section);
      setActiveMoreSectionState(next.moreSection);
    }
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
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
      <NavigationStyles />
      <TopBar email={session.user.email ?? ''} onLogout={() => logout().then(() => setSession(null))} />
      {message ? <p className="notice" role="status" aria-live="polite">{message}</p> : null}
      <SectionTabs activeSection={activeSection} onChange={(section) => navigate(section)} />
      <main id="contenido" className="layout">
        <section className="hero">
          <div>
            <p className="eyebrow">{workspace.name}</p>
            <h1>{cycle.name}</h1>
            <p>Ciclo {cycle.year}: {cycle.starts_on} a {cycle.closes_on}</p>
          </div>
          <button type="button" onClick={() => navigate('more', 'exports')}>Respaldos</button>
        </section>

        {activeSection === 'home' ? (
          <div className="section-view">
            <HomeActionsPanel
              cycleMembers={cycleMembers}
              migrationReport={migrationDryRunReport}
              onSavings={() => navigate('savings')}
              onLoans={() => navigate('loans')}
              onMigration={() => navigate('more', 'migration')}
            />
            <SavingsSummary cycleMembers={cycleMembers} contributions={contributions} />
            <FinanceSummary operations={operations} ledgerEntries={ledgerEntries} />
          </div>
        ) : null}

        {activeSection === 'savings' ? (
          <div className="section-view">
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
          </div>
        ) : null}

        {activeSection === 'loans' ? (
          <div className="section-view">
            <LoansPanel
              cycle={cycle}
              cycleMembers={cycleMembers}
              loans={loans}
              payments={loanPayments}
              schedules={loanSchedules}
              onSaved={async () => {
                await refreshAll();
                setMessage('Operacion de prestamo confirmada.');
              }}
              onError={(error) => setMessage(userSafeError(error))}
            />
          </div>
        ) : null}

        {activeSection === 'polla' ? (
          <div className="section-view">
            <PollaPanel
              cycle={cycle}
              cycleMembers={cycleMembers}
              activities={pollaActivities}
              contributions={pollaContributions}
              prizes={pollaPrizes}
              onSaved={async () => {
                await refreshAll();
                setMessage('Operacion de polla confirmada.');
              }}
              onError={(error) => setMessage(userSafeError(error))}
            />
          </div>
        ) : null}

        {activeSection === 'more' ? (
          <div className="section-view">
            <MoreTabs activeSection={activeMoreSection} onChange={navigateMore} />
            {activeMoreSection === 'bank' ? (
              <BankPanel
                cycle={cycle}
                bankAccounts={bankAccounts}
                reconciliations={bankReconciliations}
                ledgerEntries={ledgerEntries}
                operations={operations}
                onSaved={async () => {
                  await refreshAll();
                  setMessage('Operacion bancaria confirmada.');
                }}
                onError={(error) => setMessage(userSafeError(error))}
              />
            ) : null}
            {activeMoreSection === 'movements' ? (
              <MovementsPanel operations={operations} ledgerEntries={ledgerEntries} />
            ) : null}
            {activeMoreSection === 'settlements' ? (
              <SettlementPanel
                cycleMembers={cycleMembers}
                bankAccounts={bankAccounts}
                settlements={memberSettlements}
                onSaved={async () => {
                  await refreshAll();
                  setMessage('Liquidacion actualizada.');
                }}
                onError={(error) => setMessage(userSafeError(error))}
              />
            ) : null}
            {activeMoreSection === 'profit' ? (
              <ProfitDistributionPanel
                cycle={cycle}
                bankAccounts={bankAccounts}
                distributions={loanProfitDistributions}
                payments={loanProfitDistributionPayments}
                onSaved={async () => {
                  await refreshAll();
                  setMessage('Utilidad actualizada.');
                }}
                onError={(error) => setMessage(userSafeError(error))}
              />
            ) : null}
            {activeMoreSection === 'exports' ? (
              <ExportsPanel
                workspace={workspace}
                cycle={cycle}
                cycleMembers={cycleMembers}
                contributions={contributions}
                operations={operations}
                ledgerEntries={ledgerEntries}
                loans={loans}
                loanPayments={loanPayments}
                loanSchedules={loanSchedules}
                pollaActivities={pollaActivities}
                pollaContributions={pollaContributions}
                pollaPrizes={pollaPrizes}
                bankAccounts={bankAccounts}
                bankReconciliations={bankReconciliations}
                memberSettlements={memberSettlements}
                memberSettlementPayments={memberSettlementPayments}
                loanProfitDistributions={loanProfitDistributions}
                loanProfitDistributionPayments={loanProfitDistributionPayments}
                loanProfitDistributionPolicies={loanProfitDistributionPolicies}
                loanProfitDistributionAllocations={loanProfitDistributionAllocations}
                migrationDryRun={migrationDryRunReport}
              />
            ) : null}
            {activeMoreSection === 'migration' ? (
              <>
                <LegacyPanel
                  report={legacyPrevalidationReport}
                  migrationReport={migrationDryRunReport}
                  onReport={setLegacyPrevalidationReport}
                  onMigrationReport={setMigrationDryRunReport}
                />
                <FutureModules />
              </>
            ) : null}
          </div>
        ) : null}
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
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

function NavigationStyles() {
  return (
    <style>
      {`
        .section-tabs {
          background: #f6f8f5;
          border-bottom: 1px solid #d9e2d5;
          box-shadow: 0 8px 24px rgba(23, 32, 38, 0.12);
          display: flex;
          gap: 8px;
          isolation: isolate;
          left: 0;
          overflow-x: auto;
          padding: 8px clamp(12px, 4vw, 48px);
          position: sticky;
          right: 0;
          scrollbar-width: thin;
          transform: translateZ(0);
          top: 0;
          z-index: 2147483000;
        }

        .section-tab {
          background: #ffffff;
          border: 1px solid #cbd5c6;
          color: #14532d;
          flex: 0 0 auto;
          font-weight: 700;
          min-height: 44px;
          position: relative;
          scroll-margin-top: calc(var(--primary-nav-height) + 16px);
          touch-action: manipulation;
          white-space: nowrap;
          z-index: 2147483001;
        }

        .section-tab[aria-current="page"] {
          background: #14532d;
          border-color: #14532d;
          color: #ffffff;
        }

        .more-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .more-tab {
          background: #ffffff;
          border: 1px solid #cbd5c6;
          color: #14532d;
          min-height: 38px;
        }

        .more-tab[aria-current="page"] {
          background: #14532d;
          border-color: #14532d;
          color: #ffffff;
        }

        .section-view {
          display: grid;
          gap: 18px;
        }

        .home-cut-panel {
          align-items: end;
          display: grid;
          gap: 12px;
          grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
        }

        .home-cut-panel h2 {
          margin: 0;
        }

        .quick-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .export-status {
          margin: 10px 0 0;
        }

        .summary-list {
          display: grid;
          gap: 8px;
          margin: 0;
        }

        .summary-list div {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid #d9e2d5;
          padding-bottom: 8px;
        }

        @media (min-width: 980px) {
          .layout {
            padding-left: 280px;
          }

          .section-tabs {
            align-content: start;
            border-top: 0;
            border-bottom: 0;
            border-right: 1px solid #d9e2d5;
            bottom: 0;
            box-shadow: none;
            flex-direction: column;
            left: 0;
            overflow-y: auto;
            padding: 24px 16px;
            position: fixed;
            top: 59px;
            width: 232px;
            z-index: 2147483000;
          }
        }

        @media (max-width: 979px) {
          .layout {
            padding-bottom: 48px;
          }

          .section-tabs {
            justify-content: space-between;
            min-height: var(--primary-nav-height);
          }

          .section-tab {
            flex: 1 1 0;
            font-size: clamp(0.72rem, 2.65vw, 0.86rem);
            line-height: 1.15;
            min-width: 0;
            padding-left: 6px;
            padding-right: 6px;
            white-space: normal;
          }

          .home-cut-panel {
            grid-template-columns: 1fr;
          }
        }
      `}
    </style>
  );
}

function SectionTabs({
  activeSection,
  onChange
}: {
  activeSection: AppSectionId;
  onChange: (section: AppSectionId) => void;
}) {
  return (
    <nav className="section-tabs" aria-label="Secciones principales">
      {appSections.map((section) => (
        <button
          key={section.id}
          type="button"
          className="section-tab"
          aria-current={section.id === activeSection ? 'page' : undefined}
          onClick={() => onChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function MoreTabs({
  activeSection,
  onChange
}: {
  activeSection: MoreSectionId;
  onChange: (section: MoreSectionId) => void;
}) {
  return (
    <nav className="more-tabs" aria-label="Secciones de mas opciones">
      {moreSections.map((section) => (
        <button
          key={section.id}
          type="button"
          className="more-tab"
          aria-current={section.id === activeSection ? 'page' : undefined}
          onClick={() => onChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
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
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}

function HomeActionsPanel({
  cycleMembers,
  migrationReport,
  onSavings,
  onLoans,
  onMigration
}: {
  cycleMembers: CycleMember[];
  migrationReport: MigrationDryRunReport | null;
  onSavings: () => void;
  onLoans: () => void;
  onMigration: () => void;
}) {
  const decisionCount = migrationReport?.issues.filter((issue) => issue.category === 'requires_decision').length ?? 0;
  const blockerCount = migrationReport?.issues.filter((issue) => issue.category === 'blocking').length ?? 0;

  return (
    <section className="panel">
      <h2>Inicio</h2>
      <p className="muted">
        {cycleMembers.length === 0
          ? 'La base operativa no tiene socios cargados en este ciclo. Un respaldo legacy prevalidado no equivale a importacion.'
          : `Ciclo operativo con ${cycleMembers.length} socios visibles para este usuario.`}
      </p>
      {migrationReport ? (
        <p className={blockerCount || decisionCount ? 'warning' : 'notice'}>
          Migracion leida: {blockerCount} bloqueantes y {decisionCount} decisiones pendientes. El dry-run no publica datos operativos.
        </p>
      ) : null}
      <div className="quick-actions">
        <button type="button" onClick={onSavings}>Registrar aporte</button>
        <button type="button" onClick={onLoans}>Registrar cobro</button>
        <button type="button" onClick={onSavings}>Consultar socio</button>
        <button type="button" onClick={onMigration}>Revisar migracion</button>
      </div>
    </section>
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

function FinanceSummary({ operations, ledgerEntries }: { operations: FinancialOperation[]; ledgerEntries: LedgerEntry[] }) {
  const [cutDate, setCutDate] = useState(todayCivilDate());
  const balances = useMemo(() => {
    const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
    const byAccount = new Map<string, Decimal>();
    for (const entry of ledgerEntries) {
      const operation = operationsById.get(entry.operation_id);
      if (operation && operation.effective_date > cutDate) {
        continue;
      }
      byAccount.set(entry.account, (byAccount.get(entry.account) ?? new Decimal(0)).plus(entry.amount));
    }
    return byAccount;
  }, [cutDate, ledgerEntries, operations]);

  return (
    <>
      <section className="panel home-cut-panel">
        <h2>Resumen al corte</h2>
        <label>
          Corte
          <input type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} />
        </label>
      </section>
      <section className="metrics">
        <div>
          <span>Caja reconstruida</span>
          <strong>{formatCop(balances.get('cash') ?? 0)}</strong>
        </div>
        <div>
          <span>Cartera</span>
          <strong>{formatCop(balances.get('loans_receivable') ?? 0)}</strong>
        </div>
        <div>
          <span>Ahorro por pagar</span>
          <strong>{formatCop(new Decimal(0).minus(balances.get('savings_liability') ?? 0))}</strong>
        </div>
        <div>
          <span>Bolsa polla</span>
          <strong>{formatCop(new Decimal(0).minus(balances.get('polla_pool') ?? 0))}</strong>
        </div>
        <div>
          <span>Premios pendientes</span>
          <strong>{formatCop(new Decimal(0).minus(balances.get('prizes_payable') ?? 0))}</strong>
        </div>
        <div>
          <span>Fondo utilidad prestamos</span>
          <strong>{formatCop(new Decimal(0).minus(balances.get('member_loan_profit_fund') ?? 0))}</strong>
        </div>
        <div>
          <span>Administracion por pagar</span>
          <strong>{formatCop(new Decimal(0).minus(balances.get('admin_payable') ?? 0))}</strong>
        </div>
      </section>
    </>
  );
}

function MovementsPanel({ operations, ledgerEntries }: { operations: FinancialOperation[]; ledgerEntries: LedgerEntry[] }) {
  const [cutDate, setCutDate] = useState(todayCivilDate());
  const operationsById = useMemo(() => new Map(operations.map((operation) => [operation.id, operation])), [operations]);
  const visibleOperations = operations.filter((operation) => operation.effective_date <= cutDate);
  const visibleEntries = ledgerEntries.filter((entry) => {
    const operation = operationsById.get(entry.operation_id);
    return !operation || operation.effective_date <= cutDate;
  });

  return (
    <section className="panel wide">
      <h2>Movimientos financieros</h2>
      <label>
        Corte
        <input type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Referencia</th>
              <th>Partidas</th>
            </tr>
          </thead>
          <tbody>
            {visibleOperations.map((operation) => {
              const entries = visibleEntries.filter((entry) => entry.operation_id === operation.id);
              return (
                <tr key={operation.id}>
                  <td>{operation.effective_date}</td>
                  <td>{operation.operation_type}</td>
                  <td>{operation.reference_table ?? 'Sin referencia'}</td>
                  <td>{entries.map((entry) => `${entry.account}: ${formatCop(entry.amount)}`).join(' / ') || 'Sin partidas visibles'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visibleOperations.length === 0 ? <p className="muted">No hay movimientos publicados hasta el corte elegido.</p> : null}
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
  const [monthlyQuota, setMonthlyQuota] = useState('');
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
      setMonthlyQuota('');
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
  const [amountText, setAmountText] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilDate());
  const [appliedMonth, setAppliedMonth] = useState(new Date().getMonth() + 1);
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

function LoansPanel({
  cycle,
  cycleMembers,
  loans,
  payments,
  schedules,
  onSaved,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  loans: LoanContract[];
  payments: LoanPayment[];
  schedules: LoanSchedule[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [borrowerMemberId, setBorrowerMemberId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [referredByMemberId, setReferredByMemberId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [method, setMethod] = useState('fixed_interest');
  const [rateUnit, setRateUnit] = useState('MONTHLY_FIXED');
  const [rateValue, setRateValue] = useState('');
  const [termMonths, setTermMonths] = useState(1);
  const [startDate, setStartDate] = useState(todayCivilDate());
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [capitalAmount, setCapitalAmount] = useState('');
  const [interestAmount, setInterestAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayCivilDate());
  const [paymentKind, setPaymentKind] = useState<'regular' | 'prepayment'>('regular');
  const [prepaymentQuote, setPrepaymentQuote] = useState<LoanPrepaymentQuote | null>(null);
  const [pending, setPending] = useState(false);

  const loanRows = loans.map((loan) => {
    const postedPayments = payments.filter((payment) => payment.loan_id === loan.id && payment.status !== 'reversed');
    const legacyPaidCapital = new Decimal(loan.legacy_paid_capital_amount ?? 0);
    const legacyPaidInterest = new Decimal(loan.legacy_paid_interest_amount ?? 0);
    const paidCapital = postedPayments.reduce((sum, payment) => sum.plus(payment.capital_amount), legacyPaidCapital);
    const paidInterest = postedPayments.reduce((sum, payment) => sum.plus(payment.interest_amount), legacyPaidInterest);
    const nextSchedule = schedules.find((schedule) => schedule.loan_id === loan.id && schedule.status === 'projected');
    return { loan, pendingPrincipal: new Decimal(loan.principal).minus(paidCapital), paidInterest, nextSchedule };
  });

  async function submitLoan(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      cycleId: cycle.id,
      borrowerMemberId: borrowerMemberId || null,
      externalBorrowerName: borrowerMemberId ? null : externalName,
      referredByMemberId: referredByMemberId || null,
      principal: toDatabaseMoney(parseCop(principal, 'principal')),
      method,
      rateUnit,
      rateValue: parseCop(rateValue, 'tasa').div(100).toString(),
      termMonths,
      startDate
    };
    await runPendingFinancialAction({
      scope: `loan:create:${cycle.id}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => createLoanContract({
        cycleId: cycle.id,
        borrowerMemberId: payload.borrowerMemberId,
        externalBorrowerName: payload.externalBorrowerName,
        referredByMemberId: payload.referredByMemberId,
        principal: payload.principal,
        method,
        rateUnit,
        rateValue: payload.rateValue,
        termMonths,
        startDate,
        idempotencyKey
      })
    });
  }

  async function disburseLoan(loanId: string) {
    await runPendingFinancialAction({
      scope: `loan:disburse:${cycle.id}:${loanId}`,
      payload: { loanId, startDate },
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => confirmLoanDisbursement(loanId, startDate, idempotencyKey)
    });
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      loanId: selectedLoanId,
      paymentDate,
      amount: toDatabaseMoney(parseCop(paymentAmount, 'pago')),
      capitalAmount: toDatabaseMoney(parseCop(capitalAmount, 'capital')),
      interestAmount: toDatabaseMoney(parseCop(interestAmount, 'interes')),
      kind: paymentKind
    };
    await runPendingFinancialAction({
      scope: `loan:payment:${cycle.id}:${selectedLoanId}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => recordLoanPayment({
        loanId: selectedLoanId,
        idempotencyKey,
        paymentDate,
        amount: payload.amount,
        capitalAmount: payload.capitalAmount,
        interestAmount: payload.interestAmount,
        kind: paymentKind
      })
    });
  }

  async function quotePrepayment() {
    if (!selectedLoanId) {
      return;
    }
    setPending(true);
    try {
      const quote = await quoteLoanPrepayment(selectedLoanId, paymentDate);
      setPrepaymentQuote(quote);
      setPaymentAmount(formatNumberForInput(quote.total_due));
      setCapitalAmount(formatNumberForInput(quote.principal_due));
      setInterestAmount(formatNumberForInput(quote.interest_due));
      setPaymentKind('prepayment');
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function submitQuotedPrepayment() {
    if (!selectedLoanId) {
      return;
    }
    await runPendingFinancialAction({
      scope: `loan:prepayment:${cycle.id}:${selectedLoanId}`,
      payload: { loanId: selectedLoanId, paymentDate, quote: prepaymentQuote },
      setPending,
      onSaved: async () => {
        setPrepaymentQuote(null);
        await onSaved();
      },
      onError,
      action: (idempotencyKey) => confirmLoanPrepayment(selectedLoanId, paymentDate, idempotencyKey)
    });
  }

  return (
    <section className="panel">
      <h2>Prestamos y cobros</h2>
      <form onSubmit={submitLoan} className="form-grid">
        <label>
          Socio deudor
          <select value={borrowerMemberId} onChange={(event) => setBorrowerMemberId(event.target.value)} disabled={pending}>
            <option value="">Deudor externo</option>
            {cycleMembers.map((item) => <option key={item.id} value={item.member_id}>{item.member?.display_name}</option>)}
          </select>
        </label>
        <label>
          Deudor externo
          <input value={externalName} onChange={(event) => setExternalName(event.target.value)} disabled={pending || Boolean(borrowerMemberId)} />
        </label>
        <label>
          Referido por
          <select value={referredByMemberId} onChange={(event) => setReferredByMemberId(event.target.value)} disabled={pending}>
            <option value="">Sin referido</option>
            {cycleMembers.map((item) => <option key={item.id} value={item.member_id}>{item.member?.display_name}</option>)}
          </select>
        </label>
        <label>
          Principal
          <input value={principal} onChange={(event) => setPrincipal(event.target.value)} disabled={pending} />
        </label>
        <label>
          Metodo
          <select value={method} onChange={(event) => setMethod(event.target.value)} disabled={pending}>
            <option value="amortized">Amortizado</option>
            <option value="fixed_interest">Interes fijo</option>
            <option value="interest_only">Solo interes</option>
          </select>
        </label>
        <label>
          Base tasa
          <select value={rateUnit} onChange={(event) => setRateUnit(event.target.value)} disabled={pending}>
            <option value="MONTHLY_FIXED">Fijo mensual sobre principal</option>
            <option value="EA">EA</option>
          </select>
        </label>
        <label>
          Tasa %
          <input value={rateValue} onChange={(event) => setRateValue(event.target.value)} disabled={pending} />
        </label>
        <label>
          Plazo meses
          <input type="number" min="1" value={termMonths} onChange={(event) => setTermMonths(Number(event.target.value))} disabled={pending} />
        </label>
        <label>
          Fecha desembolso
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={pending} />
        </label>
        <button type="submit" disabled={pending}>{pending ? 'Guardando...' : 'Crear contrato'}</button>
      </form>
      <form onSubmit={submitPayment} className="form-grid compact-form">
        <label>
          Prestamo
          <select value={selectedLoanId} onChange={(event) => setSelectedLoanId(event.target.value)} required disabled={pending}>
            <option value="">Seleccionar</option>
            {loanRows.map(({ loan, pendingPrincipal }) => <option key={loan.id} value={loan.id}>{loan.borrower?.display_name ?? loan.external_borrower_name} - {formatCop(pendingPrincipal)}</option>)}
          </select>
        </label>
        <label><span>Pago</span><input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} disabled={pending} /></label>
        <label><span>Capital</span><input value={capitalAmount} onChange={(event) => setCapitalAmount(event.target.value)} disabled={pending} /></label>
        <label><span>Interes</span><input value={interestAmount} onChange={(event) => setInterestAmount(event.target.value)} disabled={pending} /></label>
        <label><span>Fecha cobro</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} disabled={pending} /></label>
        <label>
          Tipo cobro
          <select value={paymentKind} onChange={(event) => setPaymentKind(event.target.value as 'regular' | 'prepayment')} disabled={pending}>
            <option value="regular">Regular</option>
            <option value="prepayment">Prepago</option>
          </select>
        </label>
        <button type="submit" disabled={pending || !selectedLoanId}>Registrar cobro</button>
        <button type="button" disabled={pending || !selectedLoanId} onClick={() => void quotePrepayment()}>Cotizar prepago</button>
        <button type="button" disabled={pending || !selectedLoanId || !prepaymentQuote} onClick={() => void submitQuotedPrepayment()}>Confirmar prepago cotizado</button>
      </form>
      {prepaymentQuote ? (
        <p className="status">Cotizacion: capital {formatCop(prepaymentQuote.principal_due)}, interes {formatCop(prepaymentQuote.interest_due)}, total {formatCop(prepaymentQuote.total_due)}</p>
      ) : null}
      <div className="mini-list">
        {loanRows.map(({ loan, pendingPrincipal, paidInterest, nextSchedule }) => (
          <p key={loan.id}>
            <strong>{loan.borrower?.display_name ?? loan.external_borrower_name}</strong>: {loan.status}, cartera {formatCop(pendingPrincipal)}, interes cobrado {formatCop(paidInterest)}
            {nextSchedule ? `, proximo ${nextSchedule.due_date} ${formatCop(new Decimal(nextSchedule.principal_due).plus(nextSchedule.interest_due))}` : ''}
            {loan.status === 'draft' ? <button type="button" onClick={() => void disburseLoan(loan.id)} disabled={pending}>Desembolsar</button> : null}
          </p>
        ))}
      </div>
    </section>
  );
}

function PollaPanel({
  cycle,
  cycleMembers,
  activities,
  contributions,
  prizes,
  onSaved,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  activities: PollaActivity[];
  contributions: PollaContribution[];
  prizes: PollaPrize[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [activityName, setActivityName] = useState('');
  const [activityMonth, setActivityMonth] = useState(new Date().getMonth() + 1);
  const [activityId, setActivityId] = useState('');
  const [cycleMemberId, setCycleMemberId] = useState('');
  const [pollaAmount, setPollaAmount] = useState('');
  const [pollaPaidDate, setPollaPaidDate] = useState(todayCivilDate());
  const [prizeGross, setPrizeGross] = useState('');
  const [prizeAwardedAt, setPrizeAwardedAt] = useState(todayCivilDate());
  const [prizePaidDate, setPrizePaidDate] = useState(todayCivilDate());
  const [pending, setPending] = useState(false);

  async function submitActivity(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await createPollaActivity({ cycleId: cycle.id, year: cycle.year, month: activityMonth, name: activityName });
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function submitContribution(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      activityId,
      cycleMemberId,
      amount: toDatabaseMoney(parseCop(pollaAmount, 'aporte polla')),
      paidDate: pollaPaidDate
    };
    await runPendingFinancialAction({
      scope: `polla:contribution:${cycle.id}:${activityId}:${cycleMemberId}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => registerPollaContribution({
        activityId,
        cycleMemberId,
        amount: payload.amount,
        paidDate: pollaPaidDate,
        idempotencyKey
      })
    });
  }

  async function submitPrize(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      activityId,
      winnerCycleMemberId: cycleMemberId,
      grossAmount: toDatabaseMoney(parseCop(prizeGross, 'premio bruto')),
      awardedAt: prizeAwardedAt
    };
    await runPendingFinancialAction({
      scope: `polla:prize:${cycle.id}:${activityId}:${cycleMemberId}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => awardPollaPrize({
        activityId,
        winnerCycleMemberId: cycleMemberId,
        grossAmount: payload.grossAmount,
        awardedAt: prizeAwardedAt,
        idempotencyKey
      })
    });
  }

  async function payPrize(prizeId: string) {
    await runPendingFinancialAction({
      scope: `polla:pay-prize:${cycle.id}:${prizeId}`,
      payload: { prizeId, prizePaidDate },
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => payPollaPrize(prizeId, prizePaidDate, idempotencyKey)
    });
  }

  return (
    <section className="panel">
      <h2>Pollas y premios</h2>
      <form onSubmit={submitActivity} className="form-grid">
        <label><span>Nombre actividad</span><input value={activityName} onChange={(event) => setActivityName(event.target.value)} disabled={pending} /></label>
        <MonthSelect label="Mes" value={activityMonth} onChange={setActivityMonth} disabled={pending} />
        <button type="submit" disabled={pending}>Crear actividad</button>
      </form>
      <form onSubmit={submitContribution} className="form-grid compact-form">
        <label>
          Actividad
          <select value={activityId} onChange={(event) => setActivityId(event.target.value)} disabled={pending} required>
            <option value="">Seleccionar</option>
            {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name} {activity.period_year}-{activity.period_month}</option>)}
          </select>
        </label>
        <label>
          Participante / ganador
          <select value={cycleMemberId} onChange={(event) => setCycleMemberId(event.target.value)} disabled={pending} required>
            <option value="">Seleccionar</option>
            {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
          </select>
        </label>
        <label><span>Aporte polla</span><input value={pollaAmount} onChange={(event) => setPollaAmount(event.target.value)} disabled={pending} /></label>
        <label><span>Fecha aporte</span><input type="date" value={pollaPaidDate} onChange={(event) => setPollaPaidDate(event.target.value)} disabled={pending} /></label>
        <button type="submit" disabled={pending || !activityId || !cycleMemberId}>Registrar aporte</button>
      </form>
      <form onSubmit={submitPrize} className="form-grid compact-form">
        <label><span>Premio bruto</span><input value={prizeGross} onChange={(event) => setPrizeGross(event.target.value)} disabled={pending} /></label>
        <label><span>Fecha premio</span><input type="date" value={prizeAwardedAt} onChange={(event) => setPrizeAwardedAt(event.target.value)} disabled={pending} /></label>
        <button type="submit" disabled={pending || !activityId || !cycleMemberId}>Asignar premio</button>
      </form>
      <label>
        Fecha pago premio
        <input type="date" value={prizePaidDate} onChange={(event) => setPrizePaidDate(event.target.value)} disabled={pending} />
      </label>
      <div className="mini-list">
        {contributions.map((contribution) => {
          const member = cycleMembers.find((item) => item.id === contribution.cycle_member_id);
          const activity = activities.find((item) => item.id === contribution.activity_id);
          const participantLabel = member?.member?.display_name ?? contribution.legacy_participant_label ?? 'participante legacy';
          return (
            <p key={contribution.id}>
              Aporte {activity?.name ?? 'actividad'} / {participantLabel} / {formatCop(contribution.amount)} / {contribution.paid_date} / {contribution.status}
            </p>
          );
        })}
        {prizes.map((prize) => (
          <p key={prize.id}>
            Premio {formatCop(prize.gross_amount)} / neto {formatCop(prize.net_amount)} / {prize.status}
            {prize.legacy_payment_status === 'historical_payment_unverified' ? ' / pago historico no verificado' : ''}
            {prize.status === 'pending_payment' ? <button type="button" onClick={() => void payPrize(prize.id)} disabled={pending}>Pagar neto</button> : null}
          </p>
        ))}
      </div>
    </section>
  );
}

function BankPanel({
  cycle,
  bankAccounts,
  reconciliations,
  ledgerEntries,
  operations,
  onSaved,
  onError
}: {
  cycle: Cycle;
  bankAccounts: BankAccount[];
  reconciliations: BankReconciliation[];
  ledgerEntries: LedgerEntry[];
  operations: FinancialOperation[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [maskedIdentifier, setMaskedIdentifier] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilDate());
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [interestGross, setInterestGross] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [externalBalance, setExternalBalance] = useState('');
  const [pending, setPending] = useState(false);

  const balances = useMemo(() => {
    const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
    const byBank = new Map<string, Decimal>();
    let physicalCash = new Decimal(0);
    let unknownCash = new Decimal(0);
    for (const entry of ledgerEntries) {
      if (entry.account !== 'cash') continue;
      const operation = operationsById.get(entry.operation_id);
      if (operation && operation.effective_date > effectiveDate) continue;
      if (entry.liquidity_location === 'bank' && entry.bank_account_id) {
        byBank.set(entry.bank_account_id, (byBank.get(entry.bank_account_id) ?? new Decimal(0)).plus(entry.amount));
      } else if (entry.liquidity_location === 'cash') {
        physicalCash = physicalCash.plus(entry.amount);
      } else {
        unknownCash = unknownCash.plus(entry.amount);
      }
    }
    return { byBank, physicalCash, unknownCash };
  }, [effectiveDate, ledgerEntries, operations]);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await action();
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function runFinancial(actionName: string, payload: Record<string, unknown>, action: (idempotencyKey: string) => Promise<unknown>) {
    await runPendingFinancialAction({
      scope: `bank:${actionName}:${cycle.id}:${selectedBank}`,
      payload,
      setPending,
      onSaved,
      onError,
      action
    });
  }

  const selectedBank = bankAccountId || bankAccounts[0]?.id || '';

  return (
    <section className="panel wide">
      <h2>Banco y conciliacion</h2>
      <div className="form-grid">
        <label><span>Cuenta</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={pending} /></label>
        <label><span>Entidad</span><input value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} disabled={pending} /></label>
        <label><span>Identificador</span><input value={maskedIdentifier} onChange={(event) => setMaskedIdentifier(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending} onClick={() => void run(() => createBankAccount({ cycleId: cycle.id, displayName, institutionName, maskedIdentifier }))}>Crear cuenta</button>
        <label>
          Cuenta operativa
          <select value={selectedBank} onChange={(event) => setBankAccountId(event.target.value)} disabled={pending}>
            <option value="">Seleccionar</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
          </select>
        </label>
        <label><span>Fecha</span><input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} disabled={pending} /></label>
        <label><span>Monto</span><input value={amount} onChange={(event) => setAmount(event.target.value)} disabled={pending} /></label>
        <label><span>Referencia</span><input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !selectedBank} onClick={() => void runFinancial('opening', { effectiveDate, amount: toDatabaseMoney(parseCop(amount, 'apertura')), reference }, (idempotencyKey) => recordBankOpening({ cycleId: cycle.id, bankAccountId: selectedBank, idempotencyKey, effectiveDate, amount: toDatabaseMoney(parseCop(amount, 'apertura')), reference }))}>Registrar apertura</button>
        <button type="button" disabled={pending || !selectedBank} onClick={() => void runFinancial('external-financing', { effectiveDate, amount: toDatabaseMoney(parseCop(amount, 'financiacion')), reference }, (idempotencyKey) => recordBankExternalFinancing({ cycleId: cycle.id, bankAccountId: selectedBank, idempotencyKey, effectiveDate, amount: toDatabaseMoney(parseCop(amount, 'financiacion')), reference }))}>Registrar financiacion</button>
        <label><span>Interes bruto</span><input value={interestGross} onChange={(event) => setInterestGross(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !selectedBank} onClick={() => void runFinancial('interest', { effectiveDate, grossAmount: toDatabaseMoney(parseCop(interestGross, 'interes')), withholdingAmount: '0.00', feeAmount: '0.00', reference }, (idempotencyKey) => recordBankInterest({ cycleId: cycle.id, bankAccountId: selectedBank, idempotencyKey, effectiveDate, grossAmount: toDatabaseMoney(parseCop(interestGross, 'interes')), withholdingAmount: '0.00', feeAmount: '0.00', reference }))}>Registrar interes</button>
        <label><span>Comision</span><input value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !selectedBank} onClick={() => void runFinancial('fee', { effectiveDate, amount: toDatabaseMoney(parseCop(feeAmount, 'comision')), reference }, (idempotencyKey) => recordBankFee({ cycleId: cycle.id, bankAccountId: selectedBank, idempotencyKey, effectiveDate, amount: toDatabaseMoney(parseCop(feeAmount, 'comision')), reference }))}>Registrar comision</button>
        <button type="button" disabled={pending || !selectedBank} onClick={() => void runFinancial('transfer', { effectiveDate, fromLocation: 'bank', fromBankAccountId: selectedBank, toLocation: 'cash', toBankAccountId: null, amount: toDatabaseMoney(parseCop(amount, 'traslado')), reference }, (idempotencyKey) => recordLiquidityTransfer({ cycleId: cycle.id, idempotencyKey, effectiveDate, fromLocation: 'bank', fromBankAccountId: selectedBank, toLocation: 'cash', toBankAccountId: null, amount: toDatabaseMoney(parseCop(amount, 'traslado')), reference }))}>Trasladar a efectivo</button>
        <label><span>Saldo externo</span><input value={externalBalance} onChange={(event) => setExternalBalance(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !selectedBank} onClick={() => void run(() => createBankReconciliation({ cycleId: cycle.id, bankAccountId: selectedBank, openingVerifiedBalance: '0.00', openingDate: cycle.starts_on, externalBalance: toDatabaseMoney(parseCop(externalBalance, 'saldo externo')), asOfDate: effectiveDate, reference }))}>Conciliar corte</button>
      </div>
      <div className="mini-list">
        {bankAccounts.map((account) => (
          <p key={account.id}>{account.display_name}: {formatCop(balances.byBank.get(account.id) ?? 0)} en banco</p>
        ))}
        <p>Efectivo: {formatCop(balances.physicalCash)} / Ubicacion pendiente: {formatCop(balances.unknownCash)}</p>
        {reconciliations.slice(0, 3).map((item) => (
          <p key={item.id}>Conciliacion {item.as_of_date}: libro {formatCop(item.reconstructed_balance)}, externo {formatCop(item.external_balance)}, diferencia {formatCop(item.difference_amount)}</p>
        ))}
      </div>
    </section>
  );
}

function SettlementPanel({
  cycleMembers,
  bankAccounts,
  settlements,
  onSaved,
  onError
}: {
  cycleMembers: CycleMember[];
  bankAccounts: BankAccount[];
  settlements: MemberSettlement[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [cycleMemberId, setCycleMemberId] = useState('');
  const [cutDate, setCutDate] = useState(todayCivilDate());
  const [annualFee, setAnnualFee] = useState('');
  const [penalty, setPenalty] = useState('');
  const [otherDiscounts, setOtherDiscounts] = useState('0');
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [settlementId, setSettlementId] = useState('');
  const [paidDate, setPaidDate] = useState(todayCivilDate());
  const [liquidityLocation, setLiquidityLocation] = useState<LiquidityLocation>('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);

  async function previewSettlement() {
    if (!cycleMemberId) return;
    setPending(true);
    try {
      setPreview(await previewMemberSettlement({
        cycleMemberId,
        cutDate,
        annualAdminFee: toDatabaseMoney(parseCop(annualFee, 'cuota anual')),
        penaltyAmount: toDatabaseMoney(parseCop(penalty, 'penalidad')),
        otherDiscounts: toDatabaseMoney(parseCop(otherDiscounts, 'otros descuentos'))
      }));
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function confirmSettlement() {
    if (!preview) return;
    const payload = {
      cycleMemberId,
      cutDate,
      annualAdminFee: toDatabaseMoney(parseCop(annualFee, 'cuota anual')),
      penaltyAmount: toDatabaseMoney(parseCop(penalty, 'penalidad')),
      otherDiscounts: toDatabaseMoney(parseCop(otherDiscounts, 'otros descuentos')),
      previewHash: preview.preview_hash
    };
    await runPendingFinancialAction({
      scope: `settlement:confirm:${cycleMemberId}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => confirmMemberSettlement({ ...payload, idempotencyKey })
    });
  }

  async function paySettlement() {
    const payload = {
      settlementId,
      paidDate,
      liquidityLocation,
      bankAccountId: liquidityLocation === 'bank' ? bankAccountId : null,
      reference
    };
    await runPendingFinancialAction({
      scope: `settlement:pay:${settlementId}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => payMemberSettlement({ ...payload, idempotencyKey })
    });
  }

  return (
    <section className="panel">
      <h2>Liquidaciones</h2>
      <div className="form-grid">
        <label>
          Socio
          <select value={cycleMemberId} onChange={(event) => setCycleMemberId(event.target.value)} disabled={pending}>
            <option value="">Seleccionar</option>
            {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
          </select>
        </label>
        <label><span>Corte</span><input type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} disabled={pending} /></label>
        <label><span>Cuota anual</span><input value={annualFee} onChange={(event) => setAnnualFee(event.target.value)} disabled={pending} /></label>
        <label><span>Penalidad</span><input value={penalty} onChange={(event) => setPenalty(event.target.value)} disabled={pending} /></label>
        <label><span>Otros descuentos</span><input value={otherDiscounts} onChange={(event) => setOtherDiscounts(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !cycleMemberId} onClick={() => void previewSettlement()}>Previsualizar</button>
        <button type="button" disabled={pending || !cycleMemberId || !preview} onClick={() => void confirmSettlement()}>Confirmar</button>
      </div>
      {preview ? (
        <dl className="definition-grid">
          <dt>Ahorro</dt><dd>{formatCop(preview.capital)}</dd>
          <dt>Rendimiento</dt><dd>{formatCop(preview.recognized_yield, 2)}</dd>
          <dt>Premios</dt><dd>{formatCop(preview.pending_net_prizes)}</dd>
          <dt>Deudas</dt><dd>{formatCop(preview.debts)}</dd>
          <dt>Neto</dt><dd>{formatCop(preview.net, 2)}</dd>
          <dt>Transferencia</dt><dd>{formatCop(preview.transfer_amount)}</dd>
        </dl>
      ) : null}
      <div className="form-grid compact-form">
        <label>
          Liquidacion
          <select value={settlementId} onChange={(event) => setSettlementId(event.target.value)} disabled={pending}>
            <option value="">Seleccionar</option>
            {settlements.map((item) => {
              const member = cycleMembers.find((candidate) => candidate.id === item.cycle_member_id);
              return <option key={item.id} value={item.id}>{member?.member?.display_name ?? item.id} / {item.status} / {formatCop(item.transfer_amount)}</option>;
            })}
          </select>
        </label>
        <label><span>Fecha pago</span><input type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} disabled={pending} /></label>
        <label>
          Ubicacion
          <select value={liquidityLocation} onChange={(event) => setLiquidityLocation(event.target.value as LiquidityLocation)} disabled={pending}>
            <option value="bank">Banco</option>
            <option value="cash">Efectivo</option>
          </select>
        </label>
        <label>
          Cuenta pago
          <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} disabled={pending || liquidityLocation === 'cash'}>
            <option value="">Seleccionar</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
          </select>
        </label>
        <label><span>Referencia pago</span><input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !settlementId} onClick={() => void paySettlement()}>Registrar pago</button>
      </div>
    </section>
  );
}

function ProfitDistributionPanel({
  cycle,
  bankAccounts,
  distributions,
  payments,
  onSaved,
  onError
}: {
  cycle: Cycle;
  bankAccounts: BankAccount[];
  distributions: LoanProfitDistribution[];
  payments: LoanProfitDistributionPayment[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [cutDate, setCutDate] = useState(todayCivilDate());
  const [policyVersion, setPolicyVersion] = useState('');
  const [policyDescription, setPolicyDescription] = useState('');
  const [costs, setCosts] = useState('0');
  const [committedYield, setCommittedYield] = useState('0');
  const [reserve, setReserve] = useState('0');
  const [preview, setPreview] = useState<ProfitDistributionPreview | null>(null);
  const [distributionId, setDistributionId] = useState('');
  const [paidDate, setPaidDate] = useState(todayCivilDate());
  const [liquidityLocation, setLiquidityLocation] = useState<LiquidityLocation>('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);

  async function runPreview() {
    setPending(true);
    try {
      setPreview(await previewLoanProfitDistribution({
        cycleId: cycle.id,
        cutDate,
        policyVersion,
        costsAmount: toDatabaseMoney(parseCop(costs, 'costos')),
        committedYieldAmount: toDatabaseMoney(parseCop(committedYield, 'rendimiento comprometido')),
        reserveAmount: toDatabaseMoney(parseCop(reserve, 'reserva'))
      }));
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function approvePolicy() {
    setPending(true);
    try {
      await createLoanProfitDistributionPolicy({ cycleId: cycle.id, policyVersion, description: policyDescription });
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function confirmDistribution() {
    if (!preview) return;
    const payload = {
      cycleId: cycle.id,
      cutDate,
      policyVersion,
      costsAmount: toDatabaseMoney(parseCop(costs, 'costos')),
      committedYieldAmount: toDatabaseMoney(parseCop(committedYield, 'rendimiento comprometido')),
      reserveAmount: toDatabaseMoney(parseCop(reserve, 'reserva')),
      previewHash: preview.preview_hash
    };
    await runPendingFinancialAction({
      scope: `profit:confirm:${cycle.id}:${policyVersion}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => confirmLoanProfitDistribution({ ...payload, idempotencyKey })
    });
  }

  async function payDistribution() {
    const payload = {
      distributionId,
      paidDate,
      liquidityLocation,
      bankAccountId: liquidityLocation === 'bank' ? bankAccountId : null,
      reference
    };
    await runPendingFinancialAction({
      scope: `profit:pay:${distributionId}`,
      payload,
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => payLoanProfitDistribution({ ...payload, idempotencyKey })
    });
  }

  return (
    <section className="panel">
      <h2>Utilidad neta</h2>
      <div className="form-grid">
        <label><span>Corte</span><input type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} disabled={pending} /></label>
        <label><span>Politica</span><input value={policyVersion} onChange={(event) => setPolicyVersion(event.target.value)} disabled={pending} /></label>
        <label><span>Descripcion politica</span><input value={policyDescription} onChange={(event) => setPolicyDescription(event.target.value)} disabled={pending} /></label>
        <label><span>Costos</span><input value={costs} onChange={(event) => setCosts(event.target.value)} disabled={pending} /></label>
        <label><span>Rendimiento comprometido</span><input value={committedYield} onChange={(event) => setCommittedYield(event.target.value)} disabled={pending} /></label>
        <label><span>Reserva</span><input value={reserve} onChange={(event) => setReserve(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !policyVersion || !policyDescription} onClick={() => void approvePolicy()}>Aprobar politica</button>
        <button type="button" disabled={pending} onClick={() => void runPreview()}>Previsualizar</button>
        <button type="button" disabled={pending || !preview} onClick={() => void confirmDistribution()}>Confirmar</button>
      </div>
      {preview ? (
        <dl className="definition-grid">
          <dt>Fondo reconocido</dt><dd>{formatCop(preview.recognized_fund)}</dd>
          <dt>Distribuible</dt><dd>{formatCop(preview.distributable)}</dd>
          <dt>Elegibles</dt><dd>{preview.eligible_count}</dd>
          <dt>Por socio</dt><dd>{formatCop(preview.per_member)}</dd>
          <dt>Residual</dt><dd>{formatCop(preview.rounding_residual)}</dd>
          <dt>Politica aprobada</dt><dd>{preview.policy_approved ? 'Si' : 'No'}</dd>
          <dt>Liquidez</dt><dd>{formatCop(preview.liquidity_available)}</dd>
          <dt>Deficit</dt><dd>{formatCop(preview.liquidity_deficit)}</dd>
        </dl>
      ) : null}
      <div className="form-grid compact-form">
        <label>
          Reparto
          <select value={distributionId} onChange={(event) => setDistributionId(event.target.value)} disabled={pending}>
            <option value="">Seleccionar</option>
            {distributions.map((item) => <option key={item.id} value={item.id}>{item.policy_version} / {item.status} / {formatCop(item.payment_amount)}</option>)}
          </select>
        </label>
        <label><span>Fecha pago</span><input type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} disabled={pending} /></label>
        <label>
          Ubicacion
          <select value={liquidityLocation} onChange={(event) => setLiquidityLocation(event.target.value as LiquidityLocation)} disabled={pending}>
            <option value="bank">Banco</option>
            <option value="cash">Efectivo</option>
          </select>
        </label>
        <label>
          Cuenta pago
          <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} disabled={pending || liquidityLocation === 'cash'}>
            <option value="">Seleccionar</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
          </select>
        </label>
        <label><span>Referencia pago</span><input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} /></label>
        <button type="button" disabled={pending || !distributionId} onClick={() => void payDistribution()}>Registrar pago</button>
      </div>
      <div className="mini-list">
        {payments.slice(0, 3).map((payment) => <p key={payment.id}>Pago utilidad {formatCop(payment.amount)} / {payment.paid_date} / {payment.reference}</p>)}
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

function LegacyPanel({
  report,
  migrationReport,
  onReport,
  onMigrationReport
}: {
  report: LegacyPrevalidationReport | null;
  migrationReport: MigrationDryRunReport | null;
  onReport: (report: LegacyPrevalidationReport | null) => void;
  onMigrationReport: (report: MigrationDryRunReport | null) => void;
}) {
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

  async function run() {
    setPending(true);
    setError('');
    try {
      const prevalidation = prevalidateLegacySources({ csvText: csvText || undefined, jsonText: jsonText || undefined });
      const sourceHash = await sha256Browser([jsonText || '', csvText || ''].join('\n---CSV---\n'));
      onReport(prevalidation);
      onMigrationReport(buildMigrationDryRun({
        csvText: csvText || undefined,
        jsonText: jsonText || undefined,
        sourceHash
      }));
    } catch (caught) {
      onReport(null);
      onMigrationReport(null);
      setError(userSafeError(caught));
    } finally {
      setPending(false);
    }
  }

  function downloadReport() {
    if (!report && !migrationReport) {
      return;
    }
    triggerDownload({
      contents: JSON.stringify({ hu001Prevalidation: report, blockDDryRun: migrationReport }, null, 2),
      mimeType: 'application/json;charset=utf-8',
      fileName: `natillera-${fileTimestamp()}-dry-run-migracion.json`
    });
  }

  return (
    <section className="panel wide">
      <h2>Migracion D: prevalidacion y dry-run</h2>
      <p className="muted">Este modulo lee archivos legacy y genera evidencia local. No importa datos a la base operativa ni resuelve decisiones financieras.</p>
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
        <button type="button" onClick={() => void run()} disabled={pending || (!csvText && !jsonText)}>{pending ? 'Validando...' : 'Prevalidar sin escrituras'}</button>
        <button type="button" onClick={downloadReport} disabled={!report && !migrationReport}>Descargar dry-run D</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {report || migrationReport ? (
        <div className="report">
          {migrationReport ? (
            <dl className="definition-grid">
              <dt>Estado real</dt><dd>Archivo leido y dry-run generado; importacion operativa no ejecutada.</dd>
              <dt>Fuentes</dt><dd>{migrationReport.inventory.sourceNames.join(', ') || 'Sin nombre fuente'}</dd>
              <dt>Fecha mas reciente</dt><dd>{migrationReport.inventory.latestDateFound ?? 'No detectada'}</dd>
            </dl>
          ) : null}
          {migrationReport ? (
            <dl className="definition-grid">
              <dt>Hash fuente</dt><dd>{migrationReport.inventory.sourceHash.slice(0, 16)}...</dd>
              <dt>Mapeos</dt><dd>{migrationReport.mappings.length}</dd>
              <dt>Bloqueantes</dt><dd>{migrationReport.issues.filter((issue) => issue.category === 'blocking').length}</dd>
              <dt>Decisiones</dt><dd>{migrationReport.issues.filter((issue) => issue.category === 'requires_decision').length}</dd>
            </dl>
          ) : null}
          <details>
            <summary>Ver inventario tecnico</summary>
            <pre>{JSON.stringify(migrationReport?.inventory ?? report?.inventory, null, 2)}</pre>
          </details>
          <details open>
            <summary>Problemas y decisiones</summary>
            <ul>
              {(migrationReport?.issues ?? []).slice(0, 20).map((issue) => <li key={issue.id}><strong>{issue.category}</strong> {issue.code}: {issue.effect}</li>)}
              {!migrationReport && report?.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.severity}</strong> {issue.code}: {issue.message}</li>)}
            </ul>
          </details>
        </div>
      ) : null}
    </section>
  );
}

async function sha256Browser(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function FutureModules() {
  return (
    <section className="panel wide muted">
      <h2>Modulos posteriores</h2>
      <p>La importacion productiva, cierre de ciclo y despliegue siguen bloqueados. D agrega ensayo aislado, staging, conciliacion y restauracion verificable; los comprobantes privados solo cuentan como migrados si existen bytes y manifiesto recuperable.</p>
    </section>
  );
}

type DownloadState = 'idle' | 'preparing' | 'success' | 'error';

function ExportsPanel({
  workspace,
  cycle,
  cycleMembers,
  contributions,
  operations,
  ledgerEntries,
  loans,
  loanPayments,
  loanSchedules,
  pollaActivities,
  pollaContributions,
  pollaPrizes,
  bankAccounts,
  bankReconciliations,
  memberSettlements,
  memberSettlementPayments,
  loanProfitDistributions,
  loanProfitDistributionPayments,
  loanProfitDistributionPolicies,
  loanProfitDistributionAllocations,
  migrationDryRun
}: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  operations: FinancialOperation[];
  ledgerEntries: LedgerEntry[];
  loans: LoanContract[];
  loanPayments: LoanPayment[];
  loanSchedules: LoanSchedule[];
  pollaActivities: PollaActivity[];
  pollaContributions: PollaContribution[];
  pollaPrizes: PollaPrize[];
  bankAccounts: BankAccount[];
  bankReconciliations: BankReconciliation[];
  memberSettlements: MemberSettlement[];
  memberSettlementPayments: MemberSettlementPayment[];
  loanProfitDistributions: LoanProfitDistribution[];
  loanProfitDistributionPayments: LoanProfitDistributionPayment[];
  loanProfitDistributionPolicies: LoanProfitDistributionPolicy[];
  loanProfitDistributionAllocations: LoanProfitDistributionAllocation[];
  migrationDryRun: MigrationDryRunReport | null;
}) {
  const [jsonState, setJsonState] = useState<DownloadState>('idle');
  const [csvState, setCsvState] = useState<DownloadState>('idle');
  const [migrationState, setMigrationState] = useState<DownloadState>('idle');
  const [error, setError] = useState('');

  const counts = {
    socios: cycleMembers.length,
    aportes: contributions.length,
    operaciones: operations.length,
    partidas: ledgerEntries.length,
    prestamos: loans.length,
    pagosPrestamo: loanPayments.length,
    pollas: pollaActivities.length,
    premios: pollaPrizes.length,
    cuentasBanco: bankAccounts.length,
    conciliaciones: bankReconciliations.length,
    liquidaciones: memberSettlements.length,
    repartos: loanProfitDistributions.length
  };

  async function runDownload(kind: 'json' | 'csv' | 'migration') {
    const setState = kind === 'json' ? setJsonState : kind === 'csv' ? setCsvState : setMigrationState;
    setState('preparing');
    setError('');
    try {
      if (kind === 'json') {
        const backup = buildBlockDExport({
          workspace,
          cycle,
          cycleMembers,
          contributions,
          operations,
          ledgerEntries,
          loans,
          loanPayments,
          loanSchedules,
          pollaActivities,
          pollaContributions,
          pollaPrizes,
          bankAccounts,
          bankReconciliations,
          memberSettlements,
          memberSettlementPayments,
          loanProfitDistributions,
          loanProfitDistributionPayments,
          loanProfitDistributionPolicies,
          loanProfitDistributionAllocations,
          migrationDryRun
        });
        triggerDownload({
          contents: JSON.stringify(backup, null, 2),
          mimeType: 'application/json;charset=utf-8',
          fileName: `natillera-${cycle.year}-${fileTimestamp()}-respaldo-abcd.json`
        });
      } else if (kind === 'csv') {
        triggerDownload({
          contents: buildCsvReport({
            workspace,
            cycle,
            cycleMembers,
            contributions,
            operations,
            ledgerEntries,
            loans,
            loanPayments,
            pollaActivities,
            pollaContributions,
            pollaPrizes,
            bankAccounts,
            bankReconciliations,
            memberSettlements,
            loanProfitDistributions
          }),
          mimeType: 'text/csv;charset=utf-8',
          fileName: `natillera-${cycle.year}-${fileTimestamp()}-reporte.csv`
        });
      } else {
        if (!migrationDryRun) {
          throw new Error('Primero genera un informe en Mas > Migracion.');
        }
        triggerDownload({
          contents: JSON.stringify(migrationDryRun, null, 2),
          mimeType: 'application/json;charset=utf-8',
          fileName: `natillera-${cycle.year}-${fileTimestamp()}-informe-migracion.json`
        });
      }
      setState('success');
    } catch (caught) {
      setError(userSafeError(caught));
      setState('error');
    }
  }

  return (
    <section className="panel wide">
      <h2>Respaldos y exportaciones</h2>
      <p className="muted">Workspace {workspace.name}, ciclo {cycle.year}. El JSON respalda la base actual visible por RLS; el CSV es un reporte y no reemplaza el respaldo JSON.</p>
      <dl className="summary-list">
        {Object.entries(counts).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <div className="actions">
        <button type="button" onClick={() => void runDownload('json')} disabled={jsonState === 'preparing'}>{jsonState === 'preparing' ? 'Preparando...' : 'Descargar respaldo JSON'}</button>
        <button type="button" onClick={() => void runDownload('csv')} disabled={csvState === 'preparing'}>{csvState === 'preparing' ? 'Preparando...' : 'Descargar reporte CSV'}</button>
        <button type="button" onClick={() => void runDownload('migration')} disabled={migrationState === 'preparing' || !migrationDryRun}>{migrationState === 'preparing' ? 'Preparando...' : 'Descargar informe de migracion'}</button>
      </div>
      {!migrationDryRun ? <p className="warning">El informe de migracion esta deshabilitado porque todavia no se ha generado un dry-run en esta sesion.</p> : null}
      {jsonState === 'success' ? <p className="notice export-status">Descarga JSON iniciada por el navegador.</p> : null}
      {csvState === 'success' ? <p className="notice export-status">Descarga CSV iniciada por el navegador.</p> : null}
      {migrationState === 'success' ? <p className="notice export-status">Descarga de informe iniciada por el navegador.</p> : null}
      {error ? <p className="error export-status">{error}</p> : null}
    </section>
  );
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function triggerDownload(input: { contents: string; mimeType: string; fileName: string }) {
  const blob = new Blob([input.contents], { type: input.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = input.fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1_000);
}

function buildCsvReport(input: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  operations: FinancialOperation[];
  ledgerEntries: LedgerEntry[];
  loans: LoanContract[];
  loanPayments: LoanPayment[];
  pollaActivities: PollaActivity[];
  pollaContributions: PollaContribution[];
  pollaPrizes: PollaPrize[];
  bankAccounts: BankAccount[];
  bankReconciliations: BankReconciliation[];
  memberSettlements: MemberSettlement[];
  loanProfitDistributions: LoanProfitDistribution[];
}) {
  const rows: unknown[][] = [
    ['seccion', 'id', 'nombre_o_tipo', 'fecha', 'monto', 'estado', 'detalle'],
    ['metadata', input.workspace.id, input.workspace.name, new Date().toISOString(), '', input.cycle.status, `ciclo ${input.cycle.year} ${input.cycle.name}`],
    ...input.cycleMembers.map((item) => ['socios', item.id, item.member?.display_name ?? '', '', item.monthly_quota, item.savings_status, `rango ${item.participation_start_month}-${item.participation_end_month}`]),
    ...input.contributions.map((item) => ['aportes_ahorro', item.id, item.member_id, item.effective_date, item.amount, item.source, monthKey(item.applied_year, item.applied_month)]),
    ...input.loans.map((item) => ['prestamos', item.id, item.borrower?.display_name ?? item.external_borrower_name ?? '', item.start_date, item.principal, item.status, `${item.method} ${item.rate_unit}`]),
    ...input.loanPayments.map((item) => ['cobros_prestamo', item.id, item.loan_id, item.payment_date, item.amount, item.status, `${item.kind} capital ${item.capital_amount} interes ${item.interest_amount}`]),
    ...input.pollaActivities.map((item) => ['polla_actividades', item.id, item.name, `${item.period_year}-${String(item.period_month).padStart(2, '0')}`, '', item.status, '']),
    ...input.pollaContributions.map((item) => ['polla_aportes', item.id, item.cycle_member_id, item.paid_date, item.amount, item.status, item.activity_id]),
    ...input.pollaPrizes.map((item) => ['polla_premios', item.id, item.winner_cycle_member_id, item.awarded_at, item.net_amount, item.status, `bruto ${item.gross_amount}`]),
    ...input.bankAccounts.map((item) => ['banco_cuentas', item.id, item.display_name, '', '', item.status, item.masked_identifier ?? '']),
    ...input.bankReconciliations.map((item) => ['banco_conciliaciones', item.id, item.bank_account_id, item.as_of_date, item.difference_amount, item.status, `externo ${item.external_balance}`]),
    ...input.memberSettlements.map((item) => ['liquidaciones', item.id, item.cycle_member_id, item.cut_date, item.transfer_amount, item.status, item.preview_hash]),
    ...input.loanProfitDistributions.map((item) => ['utilidad_repartos', item.id, item.policy_version, item.cut_date, item.payment_amount, item.status, item.preview_hash]),
    ...input.operations.map((item) => ['operaciones', item.id, item.operation_type, item.effective_date, '', item.reverses_operation_id ? 'reversal' : 'posted', item.reference_table ?? '']),
    ...input.ledgerEntries.map((item) => ['partidas', item.id, item.account, '', item.amount, item.liquidity_location, item.bank_account_id ?? ''])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

function formatNumberForInput(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(2).toFixed(2).replace('.', ',');
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
