import { CopInput } from './CopInput';
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import { buildMonthRows, isSchedulePaid, openInstallments, progressPercent, scheduleRemaining, summarizeCollections, summarizeMonth, type MonthRow } from './viewSummaries';
import { getCurrentSession, logout, requestOtp, verifyOtp } from '../data/auth';
import {
  activateFinRules2026,
  getServerCivilToday,
  reverseLoanProfitPeriods,
  reverseBankYieldDistribution,
  confirmLoanProfitPeriods,
  listLoanProfitPeriodDistributions,
  payLoanProfitPeriods,
  listLoanProfitPeriodAllocations,
  payLoanProfitAllocation,
  type LoanProfitPeriodAllocation,
  previewLoanProfitPeriods,
  type LoanProfitPeriodDistribution,
  type LoanProfitPeriodsPreview,
  confirmBankYieldDistribution,
  fixCycleCloseDate,
  getFinRulesActivationChecks,
  type FinRulesChecks,
  confirmLoanProfitDistribution,
  confirmMemberSettlement,
  createBankAccount,
  createBankReconciliation,
  createLoanProfitDistributionPolicy,
  listBankAccounts,
  listBankReconciliations,
  listBankYieldDistributions,
  listLoanProfitDistributionAllocations,
  listLoanProfitDistributionPayments,
  listLoanProfitDistributionPolicies,
  listLoanProfitDistributions,
  listMemberSettlementPayments,
  listMemberSettlements,
  locateUnknownLiquidity,
  payLoanProfitDistribution,
  payMemberSettlement,
  previewBankYieldDistribution,
  previewAdminWithdrawal,
  type AdminWithdrawalPreview,
  previewLoanProfitDistribution,
  previewMemberSettlement,
  recordBankFee,
  recordBankExternalFinancing,
  recordBankInterest,
  recordBankOpening,
  recordLiquidityTransfer,
  withdrawAdminFund,
  type BankYieldPreview,
  type LiquidityLocation,
  type ProfitDistributionPreview,
  type SettlementPreview
} from '../data/blockC';
import { exportNatilleraBackup } from '../data/recovery';
import { listFinancialOperations, listLedgerEntries, reverseFinancialOperation } from '../data/finance';
import { reversePollaPrize, cancelPollaActivity } from '../data/polla';
import { canReverseOperation } from '../domain/financialCorrections';
import { confirmLoanDisbursement, confirmLoanPrepayment, createLoanContract, listLoanPayments, listLoanSchedules, listLoans, quoteLoanPayment, quoteLoanPrepayment, recordLoanPayment, type LoanPrepaymentQuote } from '../data/loans';
import { createCycleMember, listCycleMembers, updateCycleMember } from '../data/members';
import { payPollaPrize, awardPollaPrizeToCapital, confirmLegacyPollaPrizeUnpaid, createPollaActivity, creditPollaPrizeToCapital, listMemberCapitalCredits, listPollaActivities, listPollaContributions, listPollaPrizes, registerPollaContribution } from '../data/polla';
import { listSavingsContributions, registerContribution } from '../data/savings';
import { fetchWorkspaceContext } from '../data/workspace';
import { monthKey } from '../domain/date';
import { formatCop, parseCop, toDatabaseMoney } from '../domain/money';
import { buildPendingContributionOperation, type PendingContributionOperation } from '../domain/pendingContribution';
import { validateContributionDraft, type ContributionMethod } from '../domain/savings';
import { previewWithdrawal } from '../domain/withdrawal';
import { clearPendingContribution, readPendingContribution, writePendingContribution } from '../lib/pendingContributionStorage';
import { clearPendingFinancialOperation, getOrCreatePendingFinancialOperation, readPendingFinancialOperation, writePendingFinancialOperation, type PendingFinancialOperation } from '../lib/pendingFinancialOperationStorage';
import { supabase } from '../lib/supabase';
import type {
  BankYieldDistribution,
  MemberCapitalCredit, BankAccount, BankReconciliation, Cycle, CycleMember, FinancialOperation, LedgerEntry, LoanContract, LoanPayment, LoanProfitDistribution, LoanProfitDistributionAllocation, LoanProfitDistributionPayment, LoanProfitDistributionPolicy, LoanSchedule, MemberSettlement, MemberSettlementPayment, PollaActivity, PollaContribution, PollaPrize, SavingsContribution, Workspace } from '../lib/types';
import { userSafeError } from '../lib/userMessages';
import { SettlementDetails } from './SettlementDetails';
import { StatementCheck } from './StatementCheck';
import { MemberPeriodContext } from './MemberPeriodContext';
import { MemberDirectory, MemberKpis } from './MemberDirectory';
import { Avatar, QuickIcon, FinancialMetricCard, OverviewLoading, initials } from './OverviewPrimitives';
import { FinancialCut, FinancialCutField, FinancialCutPicker, useFinancialCut } from './FinancialCut';
import { MoneyReconstruction } from './MoneyReconstruction';
import { originalPrincipalAtCut, reconstructMoney } from '../domain/financialReconstruction';
import { bankPosition } from '../domain/bankPosition';
import { loanPosition, loanSchedulesAtCut } from '../domain/loanPosition';
import { BankPositionCard, BankInterestHistory } from './BankPositionCard';
import { displayDate } from './displayDate';
import { CompletionReceipt } from './CompletionReceipt';
import { CashLocationCorrections } from './CashLocationCorrections';
import { PersonalFunds } from './PersonalFunds';
import { FinancialInsights, MemberSavingsInsight, AdminProjection } from './FinancialInsights';
import { collectedLoanInterest } from './insightModels';
import { adminPosition } from '../domain/adminPosition';
import {pollaLabel as pollaDisplayName} from './pollaLabel';

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
type AppSectionId = 'home' | 'members' | 'savings' | 'loans' | 'polla' | 'more';
type MoreSectionId = 'bank' | 'movements' | 'yield' | 'admin' | 'settlements' | 'profit' | 'exports' | 'stats';
type SavingsSheetRequest = { kind: 'contribution' | 'member' | 'detail'; memberId?: string };
type LoanIntent = { kind: 'new' } | { kind: 'pay'; loanId: string };
type AppNotice = { tone: 'success' | 'warning' | 'danger' | 'uncertain'; text: string; sticky: boolean };

// Navegación móvil aprobada: Inicio, Socios, Ahorros, Préstamos, Más.
// Polla se conserva como ruta heredada (#/polla) y como acceso de escritorio; en móvil se abre desde Más.
const appSections: { id: AppSectionId; label: string; desktopOnly?: boolean }[] = [
  { id: 'home', label: 'Inicio' },
  { id: 'members', label: 'Socios' },
  { id: 'savings', label: 'Ahorros' },
  { id: 'loans', label: 'Préstamos' },
  { id: 'polla', label: 'Polla', desktopOnly: true },
  { id: 'more', label: 'Más' }
];

const moreSections: { id: MoreSectionId; label: string }[] = [
  { id: 'bank', label: 'Banco y caja' },
  { id: 'movements', label: 'Movimientos' },
  { id: 'yield', label: 'Rendimientos' },
  { id: 'admin', label: 'Administración' },
  { id: 'settlements', label: 'Cuentas finales' },
  { id: 'profit', label: 'Utilidades' },
  { id: 'exports', label: 'Respaldos' },
  { id: 'stats', label: 'Estadísticas' }
];

function makeIdempotencyKey() {
  return `ui-${crypto.randomUUID()}`;
}

const CIVIL_TIME_ZONE = 'America/Bogota';

function todayCivilDate(now: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CIVIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function civilToday() {
  const date = todayCivilDate();
  return { date, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
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

function readNavigationHash(): { section: AppSectionId; moreSection: MoreSectionId | null } {
  const [sectionValue, moreValue] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = appSections.some((item) => item.id === sectionValue) ? sectionValue as AppSectionId : 'home';
  const moreSection = moreSections.some((item) => item.id === moreValue) ? moreValue as MoreSectionId : null;
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
  const [capitalCredits, setCapitalCredits] = useState<MemberCapitalCredit[]>([]);
  const [bankYieldDistributions, setBankYieldDistributions] = useState<BankYieldDistribution[]>([]);
  const initialNavigation = readNavigationHash();
  const [activeSection, setActiveSectionState] = useState<AppSectionId>(initialNavigation.section);
  const [activeMoreSection, setActiveMoreSectionState] = useState<MoreSectionId | null>(initialNavigation.moreSection);
  const lastMoreSection = useRef<MoreSectionId | null>(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<AppNotice | null>(null);

  function notifySuccess(text: string) {
    setNotice({ tone: 'success', text, sticky: false });
  }

  function notifyError(error: unknown) {
    if (isAmbiguousOperationError(error)) {
      setNotice({ tone: 'uncertain', text: `No se pudo confirmar si la operación quedó guardada. Revisa antes de repetirla. ${userSafeError(error)}`, sticky: true });
      return;
    }
    setNotice({ tone: 'danger', text: userSafeError(error), sticky: true });
  }
  const [savingsSheetRequest, setSavingsSheetRequest] = useState<SavingsSheetRequest | null>(null);
  const [loanIntent, setLoanIntent] = useState<LoanIntent | null>(null);
  const [toastKey, setToastKey] = useState(0);

  function navigate(section: AppSectionId, moreSection: MoreSectionId | null = null) {
    setActiveSectionState(section);
    if (section === 'more') {
      setActiveMoreSectionState(moreSection);
    }
    window.location.hash = section === 'more' && moreSection ? `/${section}/${moreSection}` : `/${section}`;
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
      setCapitalCredits([]);
      setBankYieldDistributions([]);
      setViewState('no-access');
      return;
    }
    const [membersData, contributionData] = await Promise.all([
      listCycleMembers(context.activeCycle.id),
      listSavingsContributions(context.activeCycle.id)
    ]);
    const [operationData, ledgerData, loansData, loanPaymentsData, loanScheduleData, activitiesData, pollaContributionData, prizesData, bankAccountData, reconciliationData, settlementData, settlementPaymentData, distributionData, distributionPaymentData, policyData, allocationData, creditData, yieldData] = await Promise.all([
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
      listLoanProfitDistributionAllocations(context.activeCycle.id),
      listMemberCapitalCredits(context.activeCycle.id),
      listBankYieldDistributions(context.activeCycle.id)
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
    setCapitalCredits(creditData);
    setBankYieldDistributions(yieldData);
    setViewState('ready');
  }

  async function handleContributionSaved() {
    try {
      await refreshAll();
      clearPendingContribution();
      notifySuccess('Aporte confirmado por la base.');
    } catch (error) {
      setNotice({ tone: 'warning', text: `Aporte guardado, pero no se pudo refrescar la pantalla: ${userSafeError(error)}`, sticky: true });
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

  useEffect(() => {
    if (viewState !== 'ready') return;
    const header = document.querySelector<HTMLElement>('.topbar');
    const navigation = document.querySelector<HTMLElement>('.section-tabs');
    const style = document.documentElement.style;
    const measure = () => {
      if (header) style.setProperty('--measured-topbar-height', `${header.getBoundingClientRect().height}px`);
      if (navigation) style.setProperty('--measured-nav-height', `${navigation.getBoundingClientRect().height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (navigation) observer.observe(navigation);
    return () => {
      observer.disconnect();
      style.removeProperty('--measured-topbar-height');
      style.removeProperty('--measured-nav-height');
    };
  }, [viewState]);

  useEffect(() => {
    if (viewState !== 'ready') return;
    const content = document.getElementById('contenido');
    const target = activeSection === 'more' && !activeMoreSection && lastMoreSection.current
      ? content?.querySelector<HTMLElement>(`[data-more-section="${lastMoreSection.current}"]`)
      : content?.querySelector<HTMLElement>('h2');
    window.scrollTo(0, 0);
    if (target) {
      if (target.tagName === 'H2') target.tabIndex = -1;
      target.focus({ preventScroll: true });
      if (target.matches('[data-more-section]')) target.scrollIntoView({ block: 'nearest' });
    }
    if (activeSection === 'more' && activeMoreSection) lastMoreSection.current = activeMoreSection;
  }, [activeSection, activeMoreSection, viewState]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    setToastKey((value) => value + 1);
    if (notice.sticky) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (viewState === 'loading') {
    return <Shell><OverviewLoading /></Shell>;
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
    return <Shell><section className="overview-error" role="alert"><h1>No se pudo cargar la información</h1><p>{message}</p><button type="button" onClick={() => window.location.reload()}>Reintentar</button></section></Shell>;
  }

  if (!workspace || !cycle) {
    return null;
  }

  const moreStatuses: MoreHubStatus = {
    bank: { sub: 'Cuentas y ubicaciones' }, movements: { sub: 'Historial y correcciones' }, yield: { sub: 'Abonos y reparto' },
    admin: { sub: 'Ingresos y retiros' }, settlements: { sub: 'Cálculos y pagos' }, profit: { sub: 'Derechos y reparto' },
    stats: { sub: 'Tendencias y distribución' }, exports: { sub: 'Exportación y recuperación' }
  };

  return (
    <Shell>
      <FinancialCut key={cycle.id} cycle={cycle} today={todayCivilDate()}><FinancialInsights data={{cycle,members:cycleMembers,contributions,credits:capitalCredits,settlements:memberSettlements,operations,entries:ledgerEntries,loans,payments:loanPayments,schedules:loanSchedules,onLoans:()=>navigate('loans'),onSavings:memberId=>{setSavingsSheetRequest({kind:'detail',memberId});navigate('savings')},onMembers:()=>navigate('members'),onMovements:()=>navigateMore('movements')}}>
      <FinancialCorrections operations={operations} onSaved={async () => { await refreshAll(); notifySuccess('Registro anulado. Los saldos se actualizaron.'); }} onError={notifyError}>
      <TopBar email={session.user.email ?? ''} cycle={cycle} onLogout={() => logout().then(() => setSession(null))} />
      <SectionTabs activeSection={activeSection} onChange={(section) => navigate(section)} />
      <main id="contenido" className="layout">
        {notice ? (
          <div key={toastKey} className={notice.sticky ? 'app-toast is-sticky' : 'app-toast'}>
            <InlineNotice tone={notice.tone}>
              <span>{notice.text}</span>
              {notice.sticky ? <button type="button" className="toast-close" onClick={() => setNotice(null)}>Entendido</button> : null}
            </InlineNotice>
          </div>
        ) : null}

        {activeSection === 'home' ? (
          <div className="section-view">
            <HomeDashboard
              bankAccounts={bankAccounts}
              cycle={cycle}
              settlements={memberSettlements}
              cycleMembers={cycleMembers}
              contributions={contributions}
              operations={operations}
              ledgerEntries={ledgerEntries}
              loans={loans}
              loanPayments={loanPayments}
              loanSchedules={loanSchedules}
              pollaPrizes={pollaPrizes}
              onNewLoan={() => {
                setLoanIntent({ kind: 'new' });
                navigate('loans');
              }}
              onLoanPayment={(loanId) => {
                setLoanIntent({ kind: 'pay', loanId });
                navigate('loans');
              }}
              onPolla={() => navigate('polla')}
              onSavings={() => navigate('savings')}
              onRegisterContribution={(memberId) => {
                setSavingsSheetRequest({ kind: 'contribution', memberId });
                navigate('savings');
              }}
              onLoans={() => navigate('loans')}
              onBank={() => navigateMore('bank')}
              onYield={() => navigateMore('yield')}
              greetingName={greetingName(session.user.email)}
            />
          </div>
        ) : null}

        {activeSection === 'members' ? (
          <div className="section-view">
            <MembersWorkspace
              workspace={workspace}
              cycle={cycle}
              cycleMembers={cycleMembers}
              contributions={contributions}
              capitalCredits={capitalCredits}
              settlements={memberSettlements}
              onMemberSaved={async () => {
                await refreshAll();
                notifySuccess('Socio guardado.');
              }}
              onViewSavings={(memberId) => { setSavingsSheetRequest({kind: 'detail', memberId}); navigate('savings'); }}
              onError={notifyError}
            />
          </div>
        ) : null}

        {activeSection === 'savings' ? (
          <div className="section-view">
            <SavingsWorkspace
              cycle={cycle}
              cycleMembers={cycleMembers}
              contributions={contributions}
              capitalCredits={capitalCredits}
              workspace={workspace}
              sheetRequest={savingsSheetRequest}
              onSheetRequestHandled={() => setSavingsSheetRequest(null)}
              onMemberSaved={async () => {
                await refreshAll();
                notifySuccess('Socio guardado.');
              }}
              onContributionSaved={handleContributionSaved}
              onError={notifyError}
            />
          </div>
        ) : null}

        {activeSection === 'loans' ? (
          <div className="section-view">
            <LoansPanel
              bankAccounts={bankAccounts}
              cycle={cycle}
              cycleMembers={cycleMembers}
              loans={loans}
              payments={loanPayments}
              schedules={loanSchedules}
              operations={operations}
              ledgerEntries={ledgerEntries}
              settlements={memberSettlements}
              intent={loanIntent}
              onIntentHandled={() => setLoanIntent(null)}
              onSaved={async () => {
                await refreshAll();
                notifySuccess('Operación de préstamo confirmada.');
              }}
              onError={notifyError}
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
              ledgerEntries={ledgerEntries}
              bankAccounts={bankAccounts}
              onSaved={async () => {
                await refreshAll();
                notifySuccess('Operación de polla confirmada.');
              }}
              onError={notifyError}
            />
          </div>
        ) : null}

        {activeSection === 'more' ? (
          <div className="section-view">
            <div className="more-layout" data-mode={activeMoreSection ? 'module' : 'directory'}>
            {!activeMoreSection ? <PageHeading id="mas-titulo" eyebrow="Opciones y herramientas" title="Más" /> : null}
            <MoreTabs activeSection={activeMoreSection} onChange={navigateMore} onOpenPolla={() => navigate('polla')} statuses={moreStatuses} />
            <div className="more-content">
            {activeMoreSection ? <button type="button" className="more-return" onClick={() => navigate('more')}>‹ Más</button> : null}
            {activeMoreSection === 'bank' ? (
              <BankPanel
                cycle={cycle}
                bankAccounts={bankAccounts}
                reconciliations={bankReconciliations}
                ledgerEntries={ledgerEntries}
                operations={operations}
                onSaved={async () => {
                  await refreshAll();
                  notifySuccess('Operación bancaria confirmada.');
                }}
                onError={notifyError}
              />
            ) : null}
            {activeMoreSection === 'movements' ? (
              <MovementsPanel operations={operations} ledgerEntries={ledgerEntries} cycleMembers={cycleMembers} loans={loans} />
            ) : null}
            {activeMoreSection === 'settlements' ? (
              <SettlementPanel
                cycle={cycle}
                cycleMembers={cycleMembers}
                bankAccounts={bankAccounts}
                settlements={memberSettlements}
                loans={loans}
                prizes={pollaPrizes}
                activities={pollaActivities}
                credits={capitalCredits}
                onSaved={async () => {
                  await refreshAll();
                  notifySuccess('Cuenta final actualizada.');
                }}
                onError={notifyError}
              />
            ) : null}
            {activeMoreSection === 'profit' ? (
              <ProfitDistributionPanel
                cycle={cycle}
                cycleMembers={cycleMembers}
                bankAccounts={bankAccounts}
                ledgerEntries={ledgerEntries}
                distributions={loanProfitDistributions}
                payments={loanProfitDistributionPayments}
                policies={loanProfitDistributionPolicies}
                allocations={loanProfitDistributionAllocations}
                onSaved={async () => {
                  await refreshAll();
                  notifySuccess('Ganancia de préstamos actualizada.');
                }}
                onError={notifyError}
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
              />
            ) : null}
            {activeMoreSection === 'yield' ? (
              <BankYieldPanel
                cycle={cycle}
                cycleMembers={cycleMembers}
                distributions={bankYieldDistributions}
                accounts={bankAccounts} operations={operations} entries={ledgerEntries}
                onMovements={() => navigateMore('movements')}
                credits={capitalCredits}
                onBack={() => navigate('more')}
                onSaved={async () => {
                  await refreshAll();
                  notifySuccess('Rendimiento repartido.');
                }}
                onError={notifyError}
              />
            ) : null}
            {activeMoreSection === 'stats' ? (
              <StatsPanel
                operations={operations}
                ledgerEntries={ledgerEntries}
                loans={loans}
                loanPayments={loanPayments}
                loanSchedules={loanSchedules}
                cycleMembers={cycleMembers}
                onMovements={() => navigateMore('movements')}
                onBack={() => navigate('more')}
              />
            ) : null}
            {activeMoreSection === 'admin' ? (
              <AdminFundPanel
                cycle={cycle}
                bankAccounts={bankAccounts}
                operations={operations}
                ledgerEntries={ledgerEntries}
                onBack={() => navigate('more')}
                onSaved={async () => {
                  await refreshAll();
                  notifySuccess('Retiro registrado.');
                }}
                onError={notifyError}
              />
            ) : null}
            </div>
            </div>
          </div>
        ) : null}
      </main>
      </FinancialCorrections></FinancialInsights></FinancialCut>
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

type CorrectionTarget={kind:'operation'|'prize'|'activity';id:string;label:string;date?:string};
const CorrectionContext=createContext<{operations:FinancialOperation[];open:(target:CorrectionTarget)=>void}|null>(null);
export function FinancialCorrections({operations,onSaved,onError,children}:{operations:FinancialOperation[];onSaved:()=>Promise<void>;onError:(e:unknown)=>void;children:React.ReactNode}) {
  const [target,setTarget]=useState<CorrectionTarget|null>(null),[reason,setReason]=useState('Error de registro'),[date,setDate]=useState(todayCivilDate()),[pending,setPending]=useState(false),[error,setError]=useState('');
  const today=useServerCivilToday();
  function open(next:CorrectionTarget){setTarget(next);setDate(today);setReason('Error de registro');setError('');}
  async function confirm(){
    if(!target||pending||!reason.trim()||!date||date>today||target.date&&date<target.date)return;
    const current=target;
    await runPendingFinancialAction({scope:`correction:${current.kind}:${current.id}`,payload:{target:current.id,kind:current.kind,date,reason:reason.trim()},setPending,
      onSaved:async()=>{await onSaved();setTarget(null);},onError:e=>{setError(userSafeError(e));onError(e);},
      action:idempotencyKey=>current.kind==='prize'?reversePollaPrize({prizeId:current.id,effectiveDate:date,reason:reason.trim(),idempotencyKey}):current.kind==='activity'?cancelPollaActivity({activityId:current.id,reason:reason.trim(),idempotencyKey}):reverseFinancialOperation({operationId:current.id,effectiveDate:date,reason:reason.trim(),idempotencyKey})});
  }
  return <CorrectionContext.Provider value={{operations,open}}>{children}{target?<Sheet title={target.kind==='activity'?'Cancelar polla':'Anular registro'} onClose={()=>setTarget(null)} closeDisabled={pending}><div className="sheet-form">
    <p className="sheet-sub">{target.label}</p><p>{target.kind==='prize'?'Se desharán el premio, su abono al capital o entrega y su comisión en una sola operación. Los aportes de la polla se conservan.':target.kind==='activity'?'La polla dejará de aparecer. Primero deben estar anulados sus premios y aportes.':'Se deshará este registro y se actualizarán los saldos y el estado correspondiente.'}</p>
    {error?<InlineNotice tone="danger">{error}</InlineNotice>:null}
    {target.kind!=='activity'?<label>Fecha de la anulación<input type="date" min={target.date} max={today} value={date} onChange={e=>setDate(e.target.value)} disabled={pending}/></label>:null}
    <label>Motivo<input value={reason} onChange={e=>setReason(e.target.value)} disabled={pending}/></label>
    <Button type="button" onClick={()=>void confirm()} disabled={pending||!reason.trim()||!date||date>today||!!target.date&&date<target.date}>{pending?'Anulando...':target.kind==='activity'?'Confirmar cancelación':'Confirmar anulación'}</Button>
  </div></Sheet>:null}</CorrectionContext.Provider>;
}
export function UndoOperationButton({operationId,sourceId,label='Anular'}:{operationId?:string;sourceId?:string;label?:string}) {
  const context=useContext(CorrectionContext);
  const operation=context?.operations.find(item=>operationId?item.id===operationId:item.reference_id===sourceId&&item.operation_type==='savings_contribution_linked');
  if(!context||!operation||!canReverseOperation(operation,context.operations))return null;
  return <button type="button" className="link-button correction-button" onClick={()=>context.open({kind:'operation',id:operation.id,label:describeOperation(operation.operation_type).label,date:operation.effective_date})}>{label}</button>;
}
export function UndoPollaButton({target}:{target:CorrectionTarget}) {
  const context=useContext(CorrectionContext);
  return context?<button type="button" className="link-button correction-button" onClick={()=>context.open(target)}>{target.kind==='activity'?'Cancelar polla':'Anular premio'}</button>:null;
}

function TopBar({ email, cycle, onLogout }: { email: string; cycle?: Cycle | null; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-logo" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M5 19c0-8 4-13 14-14 0 9-4 14-12 14" /><path d="M5 19c3-5 6-8 10-10" /></svg>
        </span>
        <span className="topbar-brand-text">
          <strong>{cycle ? cycle.name : 'Natillera Manager'}</strong>
          {cycle ? <span>Ciclo {formatCycleRange(cycle)}</span> : null}
        </span>
      </div>
      <div className="topbar-account">
        <span className="topbar-email">{email}</span>
        {/* Sin fuente de notificaciones: control deshabilitado y sin indicador. */}
        <button type="button" className="topbar-bell" disabled aria-label="Notificaciones (no disponibles todavía)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 21h4" /></svg>
        </button>
        <Button type="button" variant="quiet" className="topbar-logout" onClick={onLogout}>Salir</Button>
      </div>
    </header>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} className={['button', `button-${variant}`, className].filter(Boolean).join(' ')} />;
}

function Panel({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <section {...props} className={['panel', className].filter(Boolean).join(' ')} />;
}

function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

function StatusBadge({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; children: React.ReactNode }) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}

function InlineNotice({
  tone,
  className,
  children
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'uncertain';
  className?: string;
  children: React.ReactNode;
}) {
  const isAlert = tone === 'danger';
  return (
    <p
      className={['inline-notice', `inline-notice-${tone}`, className].filter(Boolean).join(' ')}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
    >
      {children}
    </p>
  );
}

function NavIcon({ section }: { section: AppSectionId }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const
  };
  if (section === 'home') {
    return <svg {...common}><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></svg>;
  }
  if (section === 'members') {
    return <svg {...common}><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.2a3.2 3.2 0 010 5.6M17.5 14.2a5.5 5.5 0 013 4.8" /></svg>;
  }
  if (section === 'savings') {
    return <svg {...common}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M8 7V5h8v2M12 11v4" /></svg>;
  }
  if (section === 'loans') {
    return <svg {...common}><path d="M5 9h13l-3-3M19 15H6l3 3" /></svg>;
  }
  if (section === 'polla') {
    return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8l3 2-1 4h-4l-1-4z" /></svg>;
  }
  return <svg {...common} fill="currentColor" stroke="none"><circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" /></svg>;
}

function SectionTabs({
  activeSection,
  onChange,
  hiddenOnMobile = false
}: {
  activeSection: AppSectionId;
  onChange: (section: AppSectionId) => void;
  hiddenOnMobile?: boolean;
}) {
  return (
    <nav className={hiddenOnMobile ? 'section-tabs section-tabs-detail' : 'section-tabs'} aria-label="Secciones principales">
      {appSections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={section.desktopOnly ? 'section-tab section-tab-desktop' : 'section-tab'}
          aria-current={section.id === activeSection ? 'page' : undefined}
          data-parent-active={section.id === 'more' && activeSection === 'polla' ? 'true' : undefined}
          onClick={() => onChange(section.id)}
        >
          <NavIcon section={section.id} />
          <span>{section.label}</span>
        </button>
      ))}
    </nav>
  );
}

type MoreHubStatus = Partial<Record<MoreSectionId, { sub: string; tone?: 'warn' | 'accent' }>>;
const moreHubIcons: Record<MoreSectionId, { path: string; tone: string }> = {
  bank: { path: 'M4 10l8-5 8 5M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18', tone: 'quick-blue' },
  movements: { path: 'M4 6h16M4 12h16M4 18h10', tone: 'quick-gray' },
  yield: { path: 'M4 17l5-5 4 4 7-8M15 8h5v5', tone: 'quick-green' },
  admin: { path: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0', tone: 'quick-amber' },
  settlements: { path: 'M5 9h13l-3-3M19 15H6l3 3', tone: 'quick-green' },
  profit: { path: 'M19 5L5 19M7 7h.01M17 17h.01', tone: 'quick-amber' },
  exports: { path: 'M12 4v11M7 10l5 5 5-5M5 20h14', tone: 'quick-green' },
  stats: { path: 'M12 3a9 9 0 109 9h-9zM15 3.5A9 9 0 0120.5 9H15z', tone: 'quick-blue' },
};
const pollaHubIcon = { path: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7l3.5 2.5-1.3 4h-4.4l-1.3-4z', tone: 'quick-violet' };

export function MoreTabs({
  activeSection,
  onChange,
  onOpenPolla,
  statuses = {}
}: {
  activeSection: MoreSectionId | null;
  onChange: (section: MoreSectionId) => void;
  onOpenPolla?: () => void;
  statuses?: MoreHubStatus;
}) {
  const groups: { title: string; ids: MoreSectionId[] }[] = [
    { title: 'Dinero', ids: ['bank', 'movements', 'yield', 'admin', 'settlements', 'profit', 'stats'] },
    { title: 'Herramientas', ids: ['exports'] }
  ];
  return (
    <nav className="more-hub" aria-label="Secciones de mas opciones">
      {groups.map((group) => (
        <div key={group.title} className="more-hub-group">
          <p className="more-hub-title">{group.title}</p>
          {group.title === 'Herramientas' && onOpenPolla ? (
            <button type="button" className="more-hub-item more-hub-polla" aria-label="Polla" onClick={onOpenPolla}>
              <span className={`quick-icon ${pollaHubIcon.tone}`} aria-hidden="true"><QuickIcon path={pollaHubIcon.path} /></span>
              <span className="more-hub-text"><strong>Polla</strong><span className="more-hub-sub">Aportes y premios</span></span>
            </button>
          ) : null}
          {group.ids.map((id) => {
            const section = moreSections.find((item) => item.id === id);
            if (!section) return null;
            const status = statuses[id];
            return (
              <button key={id} type="button" className="more-hub-item" data-more-section={id} aria-label={section.label} aria-current={id === activeSection ? 'page' : undefined} onClick={() => onChange(id)}>
                <span className={`quick-icon ${moreHubIcons[id].tone}`} aria-hidden="true"><QuickIcon path={moreHubIcons[id].path} /></span>
                <span className="more-hub-text">
                  <strong>{section.label}</strong>
                  {status ? <span className={status.tone ? `more-hub-sub is-${status.tone}` : 'more-hub-sub'}>{status.sub}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
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
      <Panel className="login-panel">
        <p className="eyebrow">Acceso privado</p>
        <h1>Natillera Manager</h1>
        <form onSubmit={submit}>
          <Field label="Correo autorizado">
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={pending || sent} />
          </Field>
          {sent ? (
            <Field label="Codigo recibido" hint="Usa el codigo temporal enviado al correo autorizado.">
              <input value={token} onChange={(event) => setToken(event.target.value)} inputMode="numeric" required disabled={pending} />
            </Field>
          ) : null}
          <Button type="submit" disabled={pending}>{pending ? 'Procesando...' : sent ? 'Ingresar' : 'Enviar codigo'}</Button>
        </form>
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      </Panel>
    </main>
  );
}

const shortMonths = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatCycleRange(cycle: Cycle) {
  const start = Number(cycle.starts_on.slice(5, 7));
  const end = Number(cycle.closes_on.slice(5, 7));
  return `${shortMonths[start - 1] ?? ''} – ${shortMonths[end - 1] ?? ''} ${cycle.year}`;
}

function formatLongToday() {
  const text = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: CIVIL_TIME_ZONE }).format(new Date()).replace(',', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Nombre para el saludo: se deriva del correo de la sesión; si no hay uno utilizable, el saludo va sin nombre.
function greetingName(email?: string | null) {
  const first = (email ?? '').split('@')[0].split(/[._+-]/)[0].trim();
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

function formatShortDate(isoDate: string) {
  return displayDate(isoDate);
}

function formatCopInput(value: Decimal) {
  const [integer, fraction] = value.toDecimalPlaces(2).toFixed(2).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === '00' ? grouped : `${grouped},${fraction}`;
}

function PageHeading({ id, eyebrow, title, actions }: { id: string; eyebrow: string; title: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        <h2 id={id}>{title}</h2>
        <p className="page-eyebrow">{eyebrow}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

function ProgressBar({ value, label, tone = 'primary', decorative = false }: { value: number; label?: string; tone?: 'primary' | 'soft'; decorative?: boolean }) {
  if (decorative) {
    return <div className={`progress progress-${tone}`} aria-hidden="true"><span style={{ width: `${value}%` }} /></div>;
  }
  return (
    <div className={`progress progress-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function SavingsSummary({
  totals,
  memberCount,
  title,
  action,
  savingsKeys = false
}: {
  totals: ReturnType<typeof buildSavingsTotals>;
  memberCount: number;
  title?: string;
  action?: React.ReactNode;
  savingsKeys?: boolean;
}) {
  const progress = progressPercent(totals.contributed, totals.expected);
  const metric = (key: string): Record<string, string> => savingsKeys
    ? { 'data-figure-key': key, 'data-savings-metric-key': key }
    : { 'data-figure-key': key };
  return (
    <article className="summary-card" aria-label="Resumen de ahorros">
      {title || action ? (
        <div className="card-head">
          {title ? <h3>{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      <div className="summary-main" {...metric('ahorro-recibido')}>
        <strong data-figure-value>{formatCop(totals.contributed)}</strong>
        <span data-figure-label>Recibido</span>
      </div>
      <ProgressBar value={progress} label={`${progress}% del ahorro esperado recibido`} />
      <dl className="stat-row">
        <div {...metric('cuotas-esperadas-ciclo')}>
          <dt data-figure-label>Meta del año</dt>
          <dd data-figure-value>{formatCop(totals.expected)}</dd>
        </div>
        <div {...metric('pendiente-descriptivo')}>
          <dt data-figure-label>Faltan por ahorrar</dt>
          <dd data-figure-value>{formatCop(totals.pending)}</dd>
        </div>
        <div {...metric('socios-ciclo')}>
          <dt data-figure-label>Socios</dt>
          <dd data-figure-value>{memberCount}</dd>
        </div>
      </dl>
      <p className="summary-note">
        Debería llevar a hoy {formatCop(totals.dueToday)}
        {totals.behindToday.gt(0) ? ` · faltan ${formatCop(totals.behindToday)}` : ' · al día'}
      </p>
    </article>
  );
}

function Sheet({ title, onClose, children, closeDisabled = false, variant }: { title: string; onClose: () => void; children: React.ReactNode; closeDisabled?: boolean; variant?: 'page' }) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = () => { if (!closeDisabled) onClose(); };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
      if (event.key === 'Tab' && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(item => item.getClientRects().length > 0);
        const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('sheet-open');
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={() => onCloseRef.current()} />
      <section ref={panelRef} className={variant === 'page' ? 'sheet sheet-page' : 'sheet'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          {variant === 'page' ? (
            <button type="button" className="sheet-back" aria-label="Volver" onClick={() => onCloseRef.current()} disabled={closeDisabled}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
          ) : null}
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="link-button sheet-cancel" onClick={() => onCloseRef.current()} disabled={closeDisabled}>Cancelar</button>
        </div>
        {children}
      </section>
    </div>,
    document.body
  );
}

type LoanRow = ReturnType<typeof buildLoanRows>[number];
type LoanTone = 'draft' | 'late' | 'soon' | 'ok' | 'review' | 'paid' | 'cancelled';
const weekdayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function buildLoanRows(loans: LoanContract[], payments: LoanPayment[], schedules: LoanSchedule[], cut = todayCivilDate(), operations: FinancialOperation[] = []) {
  return loans.map((loan) => {
    const position = loanPosition(loan, payments, cut, operations);
    const actualPaymentIds = new Set(position.actual.map(payment => payment.id));
    const allPayments = payments.filter((payment) => payment.loan_id === loan.id && payment.payment_date <= cut)
      .map(payment => ({ ...payment, status: actualPaymentIds.has(payment.id) ? 'posted' as const : 'reversed' as const }));
    const paidCapital = position.receiptCapital.plus(position.settledCapital);
    const paidInterest = position.actual.reduce((sum, payment) => sum.plus(payment.interest_amount), new Decimal(loan.legacy_paid_interest_amount ?? 0)).plus(position.settledInterest);
    const postedInterest = position.actual.reduce((sum, payment) => sum.plus(payment.interest_amount), new Decimal(0));
    const loanSchedules = loanSchedulesAtCut(loan, schedules, position)
      .filter((schedule) => schedule.status !== 'cancelled' || schedule.closed_by_settlement)
      .sort((left, right) => left.installment_number - right.installment_number);
    const nextSchedule = loanSchedules.find((schedule) => schedule.status === 'projected' && !schedule.legacy_declared_paid);
    const paidInstallments = loanSchedules.filter(isSchedulePaid).length;
    const legacyInstallments = loanSchedules.filter((schedule) => schedule.legacy_declared_paid).length;
    const legacyInterest = new Decimal(loan.legacy_paid_interest_amount ?? 0);
    return {
      loan: {...loan, status: position.status},
      settledCapital: position.settledCapital,
      settledInterest: position.settledInterest,
      settledByAccount: position.settled,
      borrower: loan.borrower?.display_name ?? loan.external_borrower_name ?? 'Sin nombre',
      pendingPrincipal: position.pendingPrincipal,
      paidCapital,
      paidInterest,
      postedInterest,
      allPayments,
      schedules: loanSchedules,
      nextSchedule,
      paidInstallments,
      legacyInstallments,
      appInstallments: paidInstallments - legacyInstallments,
      legacyInterest,
      totalInstallments: loanSchedules.length
    };
  });
}

// Cuota cerrada: pagada en la app o declarada pagada en el Excel. Usar scheduleOrigin para mostrar la diferencia.
function scheduleOrigin(schedule: LoanSchedule): 'legacy' | 'app' | 'open' {
  if (schedule.legacy_declared_paid) return 'legacy';
  if (schedule.status === 'paid') return 'app';
  return 'open';
}

function civilDays(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

function formatDayMonth(date: string) {
  return `${Number(date.slice(8, 10))} ${shortMonths[Number(date.slice(5, 7)) - 1] ?? ''}`;
}

function scheduleTotal(schedule: LoanSchedule) {
  return new Decimal(schedule.principal_due).plus(schedule.interest_due);
}

function describeLoan(row: LoanRow, today: string): { tone: LoanTone; label: string; detail: string; days: number | null } {
  const { loan, nextSchedule } = row;
  if (loan.status === 'draft') return { tone: 'draft', label: 'Borrador', detail: 'Falta desembolsar', days: null };
  if (loan.status === 'paid') return { tone: 'paid', label: row.settledByAccount ? 'Compensado' : 'Pagado', detail: row.settledByAccount ? 'Deuda cancelada en cuenta final' : 'Terminó de pagar', days: null };
  if (loan.status === 'cancelled') return { tone: 'cancelled', label: 'Cancelado', detail: 'Contrato cancelado', days: null };
  if (!nextSchedule) {
    return row.pendingPrincipal.gt(0)
      ? { tone: 'review', label: 'Revisar saldo', detail: `Cronograma terminado con ${formatCop(row.pendingPrincipal)} pendiente`, days: null }
      : { tone: 'ok', label: 'Al día', detail: 'Sin cuotas pendientes en el cronograma', days: null };
  }
  const days = civilDays(nextSchedule.due_date) - civilDays(today);
  const date = formatDayMonth(nextSchedule.due_date);
  if (days < 0) return { tone: 'late', label: 'Vencido', detail: `Debía pagar el ${date} · hace ${-days} ${days === -1 ? 'día' : 'días'}`, days };
  if (days === 0) return { tone: 'soon', label: 'Paga hoy', detail: `Paga hoy, ${date}`, days };
  if (days === 1) return { tone: 'soon', label: 'Paga mañana', detail: `Paga mañana, ${date}`, days };
  if (days <= 7) {
    const weekday = weekdayNames[new Date(civilDays(nextSchedule.due_date) * 86400000).getUTCDay()];
    return { tone: 'soon', label: 'Paga pronto', detail: `Paga el ${weekday} ${date}`, days };
  }
  return { tone: 'ok', label: 'Al día', detail: `Próximo pago ${date}`, days };
}

function StatusChip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-chip status-chip-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

function ProgressRing({ value, label, sub }: { value: number; label: string; sub: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ring">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle className="ring-track" cx="42" cy="42" r={radius} />
        <circle className="ring-value" cx="42" cy="42" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} />
      </svg>
      <div className="ring-label"><strong>{label}</strong><span>{sub}</span></div>
    </div>
  );
}

function HomeDashboard({
  bankAccounts,
  cycle,
  cycleMembers,
  contributions,
  operations,
  ledgerEntries,
  loans,
  loanPayments,
  loanSchedules,
  settlements,
  pollaPrizes,
  onSavings,
  onRegisterContribution,
  onLoans,
  onNewLoan,
  onLoanPayment,
  onPolla,
  onBank,
  onYield,
  greetingName,
}: {
  greetingName?: string;
  bankAccounts: BankAccount[];
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  operations: FinancialOperation[];
  ledgerEntries: LedgerEntry[];
  loans: LoanContract[];
  loanPayments: LoanPayment[];
  loanSchedules: LoanSchedule[];
  pollaPrizes: PollaPrize[];
  settlements: MemberSettlement[];
  onSavings: () => void;
  onRegisterContribution: (memberId?: string) => void;
  onLoans: () => void;
  onNewLoan: () => void;
  onLoanPayment: (loanId: string) => void;
  onPolla: () => void;
  onBank: () => void;
  onYield: () => void;
}) {
  const { cutDate } = useFinancialCut();
  const today = todayCivilDate();
  const loanInterest = collectedLoanInterest(operations, ledgerEntries, cutDate, settlements);
  const balances = useMemo(() => buildBalancesAtCut(operations, ledgerEntries, cutDate), [cutDate, ledgerEntries, operations]);
  const loanRows = useMemo(() => buildLoanRows(loans, loanPayments, loanSchedules, cutDate, operations), [loans, loanPayments, loanSchedules, cutDate, operations]);
  const activeRows = loanRows.filter((row) => row.loan.status === 'active');
  const cartera = new Decimal(balances.get('loans_receivable') ?? 0);
  const attention = activeRows
    .map((row) => ({ row, info: describeLoan(row, today) }))
    .filter(({ info }) => info.tone === 'review' || (info.days !== null && info.days <= 7))
    .sort((left, right) => (left.info.days ?? -9999) - (right.info.days ?? -9999));
  const pendingPrizes = pollaPrizes.filter((prize) => prize.status === 'pending_payment');

  const summaryBank = bankAccounts.find(account => /pibank/i.test(account.display_name + ' ' + account.institution_name)) ?? bankAccounts[0];
  const pibank = bankPosition(operations, ledgerEntries, summaryBank?.id ?? '', cutDate);
  const unlocatedCash = new Decimal(balances.get('cash:unknown') ?? 0);
  const methodNames = { amortized: 'Amortizado', fixed_interest: 'Interés fijo', interest_only: 'Solo interés' } as const;
  const upcoming = [...attention].sort((left, right) => (left.info.days ?? -9999) - (right.info.days ?? -9999));
  const visibleUpcoming = upcoming.slice(0, 5);

  return (
    <section className="home-page overview-home" aria-labelledby="inicio-titulo">
      <h2 id="inicio-titulo" className="sr-only">Inicio</h2>
      <div className="home-greeting">
        <p className="home-date">{formatLongToday()}</p>
        <p className="home-hello">{greetingName ? `Hola, ${greetingName}` : 'Hola'} <span aria-hidden="true">👋</span></p>
        <p className="home-hello-sub">Aquí tienes el resumen de tu natillera.</p><FinancialCutPicker appearance="capsule" />
      </div>

      <div className="home-metrics" aria-label="Resumen del ciclo">
        <FinancialMetricCard figureKey="dinero-en-caja" label={summaryBank && /pibank/i.test(summaryBank.display_name + summaryBank.institution_name) ? 'Dinero en Pibank' : 'Dinero en el banco'} value={formatCop(pibank.balance, 2)} support={summaryBank ? 'Ver banco y caja' : 'Sin cuenta bancaria registrada'} icon="M3 8h18v10H3zM3 8l2-3h14l2 3M12 11.5v3M9.5 13h5" tone="quick-green" onOpen={onBank} />
        <FinancialMetricCard figureKey="dinero-prestado" label="Por cobrar (préstamos)" value={formatCop(cartera, 2)} support="Capital pendiente" icon="M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v5C4 12.9 7.6 14 12 14s8-1.1 8-2.5v-5M4 11.5v5C4 17.9 7.6 19 12 19s8-1.1 8-2.5v-5" tone="quick-blue" onOpen={onLoans} />
        <FinancialMetricCard figureKey="intereses-prestamos-cobrados" label="Intereses de préstamos cobrados" value={formatCop(loanInterest.total, 2)} support="Acumulado del ciclo" icon="M5 19L19 5M7 7h.01M17 17h.01" tone="quick-blue" onOpen={onLoans} />
        <FinancialMetricCard figureKey="intereses-cobrados" label="Intereses bancarios" value={formatCop(pibank.interest, 2)} support="Incluidos en el saldo" icon="M5 20V10M12 20V4M19 20v-7" tone="quick-violet" onOpen={onYield} />
        <FinancialMetricCard figureKey="ahorro-del-ciclo" label="Ahorro de los socios" value={formatCop(new Decimal(balances.get('savings_liability') ?? 0).negated(), 2)} support="Incluye premios acreditados" icon="M5 12c0-3.3 3-6 7-6s7 2.7 7 6c0 2-1 3.6-2.5 4.6V19h-3v-1.2h-3V19h-3v-2.4C6 15.6 5 14 5 12zM16 11h.01M3 11c.2 1 .8 1.8 2 2" tone="quick-green" onOpen={onSavings} />
        <FinancialMetricCard figureKey="bolsa-polla" label="Bolsa de polla" value={formatCop(new Decimal(balances.get('polla_pool') ?? 0).negated(), 2)} support="Pendiente de jugar" icon="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3" tone="quick-amber" onOpen={onPolla} />
      </div>

      <section className="home-quick" aria-labelledby="acciones-rapidas-titulo">
        <h3 id="acciones-rapidas-titulo" className="home-section-title">Acciones rápidas</h3>
        <div className="quick-grid">
          <button type="button" className="quick-action quick-green" onClick={() => onRegisterContribution()}><span className="quick-action-icon"><QuickIcon path="M12 5v14M5 12h14" /></span><span>Registrar aporte</span></button>
          <button type="button" className="quick-action quick-blue" onClick={onLoans}><span className="quick-action-icon"><QuickIcon path="M5 9h13l-3-3M19 15H6l3 3" /></span><span>Registrar cobro</span></button>
          <button type="button" className="quick-action quick-violet" onClick={onNewLoan}><span className="quick-action-icon"><QuickIcon path="M4 6h16v12H4zM4 10h16M7 15h3" /></span><span>Nuevo préstamo</span></button>
          <button type="button" className="quick-action quick-amber" onClick={onPolla}><span className="quick-action-icon"><QuickIcon path="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3" /></span><span>Gestionar polla{pendingPrizes.length ? <small>{pendingPrizes.length} pendientes</small> : null}</span></button>
        </div>
      </section>

      <details className="home-interest-audit"><summary>Cómo se reconocen los intereses cobrados</summary><p>Interés bruto al {displayDate(cutDate)}. Incluye cobros y reconocimientos autorizados, netos de reversos. No se suma otra vez a Pibank ni es solo el 10 % del administrador.</p>{loanInterest.historical?<p>El histórico conciliado usa vencimientos como fecha de reconocimiento autorizada; no acredita la fecha bancaria real.</p>:null}{loanInterest.compensated?<p>Incluye interés P013 compensado en cuenta final, sin nuevo efectivo.</p>:null}<button type="button" className="link-button" onClick={onLoans}>Consultar préstamos y cobros</button></details>
      <MemberPeriodContext cycle={cycle} members={cycleMembers} contributions={contributions} cutDate={cutDate} compact onSavings={onSavings} />
      {unlocatedCash.gt(0) ? <InlineNotice tone="warning">Hay {formatCop(unlocatedCash, 2)} sin ubicación asignada. Revísalo en Banco y caja.</InlineNotice> : null}
      {new Decimal(balances.get('cash') ?? 0).lt(0) ? <InlineNotice tone="danger">El dinero disponible es negativo. Revisa los movimientos antes de operar.</InlineNotice> : null}
      {cycleMembers.length === 0 ? (
        <InlineNotice tone="warning">Este ciclo todavía no tiene socios registrados.</InlineNotice>
      ) : null}

      <article className="home-card home-upcoming">
        <div className="card-head">
          <div><h3>Próximos cobros</h3>{cutDate !== today ? <small className="muted">Agenda vigente al {displayDate(today)}</small> : null}</div>
          <button type="button" className="link-button" onClick={onLoans}>Ver todos <span aria-hidden="true">›</span></button>
        </div>
        {visibleUpcoming.length ? (
          <ul className="row-list">
            {visibleUpcoming.map(({ row, info }) => (
              <li key={row.loan.id}>
                <button type="button" className="row-button" onClick={() => onLoanPayment(row.loan.id)} aria-label={`${row.borrower}, ${info.label}, ${info.detail}`}>
                  <Avatar name={row.borrower} />
                  <span className="row-main">
                    <strong>{row.borrower}</strong>
                    <span className="row-sub">{[row.loan.legacy_id, row.loan.legacy_note || methodNames[row.loan.method]].filter(Boolean).join(' · ')}</span>
                    <span className="row-sub">{info.detail}</span>
                  </span>
                  <span className="row-end">
                    <span className="row-amount">{row.nextSchedule ? formatCop(scheduleRemaining(row.nextSchedule).total) : formatCop(row.pendingPrincipal)}</span>
                    <StatusChip tone={info.tone}>{info.label}</StatusChip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted card-empty">No hay cobros vencidos ni en los próximos 7 días.</p>
        )}
      </article>


    </section>
  );
}

// ===== Estadísticas · Distribución del dinero =====
// Solo grafica datos que el proyecto ya expone con el mismo corte (hoy): caja contable y cartera de capital pendiente
// (cuentas contables distintas). No es patrimonio: no descuenta ahorro por pagar, premios ni otras obligaciones.
type DonutSlice = { key: string; label: string; value: number; color: string; display: string };

function Donut({ slices, size = 200, stroke = 24, centerTop, centerBottom, label }: { slices: DonutSlice[]; size?: number; stroke?: number; centerTop: string; centerBottom: string; label: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let offset = 0;
  return (
    <div className="donut" style={{ height: size, width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e6ecea" strokeWidth={stroke} />
        {total > 0 ? slices.filter((slice) => slice.value > 0).map((slice) => {
          const length = (slice.value / total) * circumference;
          const node = (
            <circle key={slice.key} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={slice.color} strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          );
          offset += length;
          return node;
        }) : null}
      </svg>
      <div className="donut-center"><strong style={{ fontSize: centerTop.length <= 12 ? undefined : centerTop.length <= 15 ? '0.9375rem' : '0.8125rem' }}>{centerTop}</strong><span>{centerBottom}</span></div>
    </div>
  );
}

function formatTimeAgo(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('es-CO', { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}

function StatsPanel({
  operations,
  ledgerEntries,
  loans,
  loanPayments,
  loanSchedules,
  cycleMembers,
  onMovements,
  onBack
}: {
  operations: FinancialOperation[];
  ledgerEntries: LedgerEntry[];
  loans: LoanContract[];
  loanPayments: LoanPayment[];
  loanSchedules: LoanSchedule[];
  cycleMembers: CycleMember[];
  onMovements: () => void;
  onBack: () => void;
}) {
  const today = todayCivilDate();
  const balances = useMemo(() => buildBalancesAtCut(operations, ledgerEntries, today), [operations, ledgerEntries, today]);
  const cash = new Decimal(balances.get('cash') ?? 0);
  const receivable = new Decimal(balances.get('loans_receivable') ?? 0);
  const distributionTotal = cash.plus(receivable);
  const distributionAvailable = cash.gte(0) && receivable.gte(0) && distributionTotal.gt(0);
  const pct = (value: Decimal) => (distributionTotal.gt(0) ? Math.round(value.div(distributionTotal).mul(100).toNumber()) : 0);
  const slices: DonutSlice[] = [
    { key: 'cash', label: 'Dinero disponible', value: cash.toNumber(), color: '#00865d', display: formatCop(cash) },
    { key: 'receivable', label: 'Por cobrar (capital pendiente)', value: receivable.toNumber(), color: '#1767ed', display: formatCop(receivable) }
  ];

  const loanRows = useMemo(() => buildLoanRows(loans, loanPayments, loanSchedules, today, operations), [loans, loanPayments, loanSchedules, today, operations]);
  const statusDefs: { tone: LoanTone; label: string; color: string }[] = [
    { tone: 'ok', label: 'Al día', color: '#00865d' },
    { tone: 'soon', label: 'Por pagar (hoy o próximos 7 días)', color: '#e0a100' },
    { tone: 'late', label: 'Vencidos', color: '#d51e35' },
    { tone: 'review', label: 'Revisar saldo', color: '#e8590c' },
    { tone: 'draft', label: 'Borradores', color: '#7352d8' },
    { tone: 'paid', label: 'Pagados', color: '#7d8a94' },
    { tone: 'cancelled', label: 'Cancelados', color: '#b9c3c9' }
  ];
  const toneCounts = new Map<LoanTone, number>();
  for (const row of loanRows) {
    const tone = describeLoan(row, today).tone;
    toneCounts.set(tone, (toneCounts.get(tone) ?? 0) + 1);
  }
  const statusSlices = statusDefs.map((def) => ({ ...def, count: toneCounts.get(def.tone) ?? 0 })).filter((def) => def.count > 0);
  const loanTotal = loanRows.length;

  const memberNames = useMemo(() => new Map(cycleMembers.map((item) => [item.member_id, item.member?.display_name ?? ''])), [cycleMembers]);
  const loanNames = useMemo(() => new Map(loans.map((loan) => [loan.id, [loan.legacy_id, loan.borrower?.display_name ?? loan.external_borrower_name].filter(Boolean).join(' · ')])), [loans]);
  const recent = useMemo(() => {
    const entriesByOperation = new Map<string, LedgerEntry[]>();
    for (const entry of ledgerEntries) entriesByOperation.set(entry.operation_id, [...(entriesByOperation.get(entry.operation_id) ?? []), entry]);
    return [...operations]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 4)
      .map((operation) => {
        const original = operation.reverses_operation_id ? operations.find((item) => item.id === operation.reverses_operation_id) : undefined;
        const info = describeOperation(original?.operation_type ?? operation.operation_type);
        const label = original ? `Anulación de ${info.label.toLocaleLowerCase('es-CO')}` : info.label;
        const entries = entriesByOperation.get(operation.id) ?? [];
        const cashMove = entries.filter((entry) => entry.account === 'cash').reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
        const largest = entries.reduce((max, entry) => (new Decimal(entry.amount).abs().gt(max) ? new Decimal(entry.amount).abs() : max), new Decimal(0));
        const loanEntry = entries.find((entry) => entry.loan_id);
        const memberEntry = entries.find((entry) => entry.member_id);
        const who = (loanEntry?.loan_id ? loanNames.get(loanEntry.loan_id) : '') || (memberEntry?.member_id ? memberNames.get(memberEntry.member_id) : '') || '';
        return { operation, info, label, who, amount: cashMove.isZero() ? largest : cashMove.abs() };
      });
  }, [operations, ledgerEntries, loanNames, memberNames]);

  return (
    <section className="stats-page" aria-labelledby="estadisticas-titulo">
      <div className="page-heading stats-heading">
        <button type="button" className="stats-back" aria-label="Volver a Más" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="page-heading-copy">
          <h2 id="estadisticas-titulo">Distribución del dinero</h2>
          <p className="page-eyebrow">Corte al {formatShortDate(today)}</p>
        </div>
      </div>

      <article className="stats-card" aria-labelledby="dona-titulo">
        <h3 id="dona-titulo" className="sr-only">Dónde está el dinero</h3>
        {distributionAvailable ? (
          <>
            <Donut slices={slices} centerTop={formatCop(distributionTotal)} centerBottom="Dinero + por cobrar" label={`Distribución entre dinero disponible y préstamos por cobrar: ${slices.map((slice) => `${slice.label} ${slice.display} (${pct(new Decimal(slice.value))}%)`).join('; ')}`} />
            <ul className="legend">
              {slices.map((slice) => (
                <li key={slice.key}>
                  <span className="legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                  <span className="legend-label">{slice.label}</span>
                  <span className="legend-value">{slice.display}</span>
                  <span className="legend-pct">{pct(new Decimal(slice.value))}%</span>
                </li>
              ))}
            </ul>
            <p className="stats-note">Suma de dinero disponible y capital pendiente de préstamos, al corte de hoy. No es el patrimonio: no descuenta el ahorro de los socios, los premios ni otras obligaciones.</p>
          </>
        ) : (
          <div className="stats-empty" role="status">
            <Donut slices={[]} centerTop="—" centerBottom="No disponible" label="Distribución no disponible" />
            <strong>Distribución no disponible</strong>
            <p>{cash.lt(0) ? 'El dinero disponible es negativo al corte, por lo que no se puede repartir en un gráfico.' : 'Todavía no hay dinero ni préstamos registrados al corte.'}</p>
            <ul className="legend">
              <li><span className="legend-label">Dinero disponible</span><span className="legend-value">{formatCop(cash)}</span></li>
              <li><span className="legend-label">Por cobrar (capital pendiente)</span><span className="legend-value">{formatCop(receivable)}</span></li>
            </ul>
          </div>
        )}
      </article>

      <article className="stats-card" aria-labelledby="estado-cartera-titulo">
        <h3 id="estado-cartera-titulo">Estado de los préstamos</h3>
        {loanTotal ? (
          <div className="portfolio-status">
            <Donut size={112} stroke={14} slices={statusSlices.map((def) => ({ key: def.tone, label: def.label, value: def.count, color: def.color, display: String(def.count) }))} centerTop={String(loanTotal)} centerBottom={loanTotal === 1 ? 'préstamo' : 'préstamos'} label={`Estado de ${loanTotal} préstamos: ${statusSlices.map((def) => `${def.label} ${def.count}`).join('; ')}`} />
            <ul className="legend">
              {statusSlices.map((def) => (
                <li key={def.tone}>
                  <span className="legend-dot" style={{ background: def.color }} aria-hidden="true" />
                  <span className="legend-label">{def.label}</span>
                  <span className="legend-value">{def.count}</span>
                  <span className="legend-pct">({Math.round((def.count / loanTotal) * 100)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="muted card-empty">Todavía no hay préstamos en este ciclo.</p>}
      </article>

      <article className="stats-card" aria-labelledby="asesor-titulo">
        <h3 id="asesor-titulo">Préstamos vencidos por asesor</h3>
        <div className="stats-empty" role="status">
          <strong>Sin clasificación por asesor</strong>
          <p>El sistema todavía no registra asesores. El campo «referido por» de un préstamo no equivale a un asesor, por eso no se dibuja ninguna barra.</p>
        </div>
      </article>

      <article className="stats-card" aria-labelledby="actividad-titulo">
        <div className="card-head">
          <h3 id="actividad-titulo">Actividad reciente</h3>
          <button type="button" className="link-button" onClick={onMovements}>Ver toda <span aria-hidden="true">›</span></button>
        </div>
        {recent.length ? (
          <ul className="row-list">
            {recent.map(({ operation, info, label, who, amount }) => (
              <li key={operation.id}>
                <div className="row-static">
                  <span className={`movement-icon movement-${info.group}`} aria-hidden="true">{info.icon}</span>
                  <span className="row-main">
                    <strong>{label}{who ? ` · ${who}` : ''}</strong>
                    <span className="row-sub">{formatShortDate(operation.effective_date)}</span>
                  </span>
                  <span className="row-end">
                    <span className="row-amount">{formatCop(amount)}</span>
                    <span className="row-sub">{formatTimeAgo(operation.created_at)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted card-empty">Todavía no hay movimientos registrados.</p>}
      </article>
    </section>
  );
}

function buildBalancesAtCut(operations: FinancialOperation[], ledgerEntries: LedgerEntry[], cutDate: string) {
  const position = reconstructMoney(operations, ledgerEntries, cutDate);
  const balances = new Map(position.accounts);
  balances.set('cash:bank', position.bank); balances.set('cash:cash', position.physicalCash); balances.set('cash:unknown', position.unknown);
  return balances;
}

type DashboardMetric = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: 'primary' | 'secondary' | 'warning' | 'neutral';
};

function DashboardSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section-heading">
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function MetricGrid({ items }: { items: DashboardMetric[] }) {
  return (
    <div className="metric-tiles">
      {items.map((item) => (
        <article key={item.key} className="metric-tile" data-figure-key={item.key}>
          <span data-figure-label>{item.label}</span>
          <strong data-figure-value>{item.value}</strong>
          <small>{item.detail}</small>
        </article>
      ))}
    </div>
  );
}

const accountLabels: Record<string, string> = {
  cash: 'Dinero disponible',
  bank: 'Banco',
  savings_liability: 'Ahorro de socios',
  polla_pool: 'Bolsa polla',
  loans_receivable: 'Por cobrar (préstamos)',
  legacy_migration_equity: 'Ajuste de préstamos anteriores a la app',
  common_income: 'Ingresos comunes',
  prizes_payable: 'Premios por entregar',
  admin_payable: 'Mi ganancia como administrador',
  settlement_completion_liability: 'Consignación para cuenta final',
  member_loan_profit_fund: 'Ganancia de préstamos de los socios'
};

type MovementGroup = 'ahorro' | 'polla' | 'prestamos' | 'banco' | 'otros';

function humanizeKey(value: string) {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeOperation(type: string): { label: string; group: MovementGroup; icon: string } {
  const t = type.toLowerCase();
  if (t === 'legacy_loan_interest_correction') return { label: 'Conciliación de intereses anteriores', group: 'prestamos', icon: '%' };
  if (t === 'legacy_loan_cash_correction') return { label: 'Conciliación de caja de préstamos', group: 'prestamos', icon: '⇄' };
  if (t === 'legacy_fine_reclassification') return { label: 'Multas reconocidas al administrador', group: 'otros', icon: '%' };
  if (t === 'admin_fine_received') return { label: 'Multa recibida para el administrador', group: 'otros', icon: '%' };
  if (t === 'admin_fee_recognized') return { label: 'Cuota de administración', group: 'otros', icon: '%' };
  if (t === 'admin_penalty_recognized') return { label: 'Multa por retiro', group: 'otros', icon: '−' };
  if (t === 'bank_yield_settled') return { label: 'Rendimiento bancario incluido en cuenta final', group: 'banco', icon: '%' };
  if (t === 'legacy_opening') return { label: 'Saldo inicial registrado', group: 'otros', icon: '◎' };
  if (t === 'polla_prize_credited') return { label: 'Premio acreditado al capital', group: 'polla', icon: '★' };
  if (t === 'polla_prize_cancelled' || t === 'reversal') return {label:'Registro anulado',group:'otros',icon:'↶'};
  if (t === 'bank_yield_distributed') return { label: 'Rendimiento bancario repartido', group: 'banco', icon: '%' };
  if (t === 'admin_withdrawal') return { label: 'Retiro del fondo del administrador', group: 'otros', icon: '↑' };
  if (t === 'member_settlement_completion') return { label: 'Consignación para completar cuenta final', group: 'banco', icon: '+' };
  if (t === 'cash_location_corrected') return { label: 'Corrección de ubicación de cobro', group: 'banco', icon: '⇄' };
  if (t === 'personal_funds_received' || t === 'personal_funds_returned') return { label: t === 'personal_funds_received' ? 'Dinero personal recibido' : 'Dinero personal devuelto', group: 'banco', icon: '⇄' };
  if (t === 'bank_interest_received') return { label: 'Rendimiento bancario recibido', group: 'banco', icon: '%' };
  if (t === 'member_settlement_paid') return { label: 'Cuenta final pagada', group: 'otros', icon: '⇄' };
  if (t === 'polla_prize_awarded') return { label: 'Premio asignado', group: 'polla', icon: '★' };
  if (t.includes('withdrawal')) return { label: 'Retiro de ahorro', group: 'ahorro', icon: '↑' };
  if (t.includes('savings')) return { label: 'Aporte de ahorro', group: 'ahorro', icon: '↓' };
  if (t.includes('polla') && t.includes('prize') && t.includes('pay')) return { label: 'Pago de premio', group: 'polla', icon: '★' };
  if (t.includes('polla') && t.includes('prize')) return { label: 'Premio de polla asignado', group: 'polla', icon: '★' };
  if (t.includes('polla')) return { label: 'Aporte de polla', group: 'polla', icon: '★' };
  if (t.includes('loan') && t.includes('profit')) return { label: 'Ganancia de préstamos de los socios', group: 'prestamos', icon: '%' };
  if (t.includes('loan') && t.includes('disburs')) return { label: 'Desembolso de préstamo', group: 'prestamos', icon: '↑' };
  if (t.includes('loan') && t.includes('prepay')) return { label: 'Pago total de préstamo', group: 'prestamos', icon: '↓' };
  if (t.includes('loan')) return { label: 'Pago de préstamo', group: 'prestamos', icon: '↓' };
  if (t.includes('settlement')) return { label: 'Cuenta final de socio', group: 'otros', icon: '⇄' };
  if (t.includes('interest')) return { label: 'Intereses del banco', group: 'banco', icon: '%' };
  if (t.includes('fee')) return { label: 'Comisión bancaria', group: 'banco', icon: '−' };
  if (t.includes('opening')) return { label: 'Saldo inicial del banco', group: 'banco', icon: '◎' };
  if (t.includes('liquidity') || t.includes('transfer')) return { label: 'Mover entre banco y efectivo', group: 'banco', icon: '⇄' };
  if (t.includes('financing')) return { label: 'Financiación externa', group: 'banco', icon: '↓' };
  if (t.includes('income')) return { label: 'Ingreso', group: 'otros', icon: '↓' };
  if (t.includes('expense')) return { label: 'Gasto', group: 'otros', icon: '↑' };
  return { label: humanizeKey(type), group: 'otros', icon: '•' };
}

function signedCop(value: Decimal) {
  return `${value.gte(0) ? '+' : '−'}${formatCop(value.abs(), 2)}`;
}

function MovementsPanel({ operations, ledgerEntries, cycleMembers, loans }: { operations: FinancialOperation[]; ledgerEntries: LedgerEntry[]; cycleMembers: CycleMember[]; loans: LoanContract[] }) {
  const memberNames = useMemo(() => new Map(cycleMembers.map((item) => [item.member_id, item.member?.display_name ?? ''])), [cycleMembers]);
  const loanNames = useMemo(() => new Map(loans.map((loan) => [loan.id, [loan.legacy_id, loan.borrower?.display_name ?? loan.external_borrower_name].filter(Boolean).join(' · ')])), [loans]);
  const [cutDate, setCutDate] = useState(todayCivilDate());
  const [group, setGroup] = useState<MovementGroup | 'all'>('all');
  const [openId, setOpenId] = useState('');
  const entriesByOperation = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    for (const entry of ledgerEntries) {
      map.set(entry.operation_id, [...(map.get(entry.operation_id) ?? []), entry]);
    }
    return map;
  }, [ledgerEntries]);
  const items = operations
    .filter((operation) => operation.effective_date <= cutDate)
    .map((operation) => {
      const corrected=operation.reverses_operation_id?operations.find(item=>item.id===operation.reverses_operation_id):undefined;
      const originalInfo=describeOperation(corrected?.operation_type??operation.operation_type);
      const info=corrected?{...originalInfo,label:`Anulación de ${originalInfo.label.toLocaleLowerCase('es-CO')}`}:originalInfo;
      const reversed=operations.some(item=>item.reverses_operation_id===operation.id&&item.effective_date<=cutDate);
      const entries = entriesByOperation.get(operation.id) ?? [];
      const cash = entries.filter((entry) => entry.account === 'cash').reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
      const largest = entries.reduce((max, entry) => (new Decimal(entry.amount).abs().gt(max.abs()) ? new Decimal(entry.amount) : max), new Decimal(0));
      const loanEntry = entries.find((entry) => entry.loan_id);
      const memberEntry = entries.find((entry) => entry.member_id);
      const who = (loanEntry?.loan_id ? loanNames.get(loanEntry.loan_id) : '') || (memberEntry?.member_id ? memberNames.get(memberEntry.member_id) : '') || '';
      return { operation, info, reversed, entries, cash, who, hasCash: !cash.isZero(), main: cash.isZero() ? largest.abs() : cash };
    })
    .sort((left, right) => right.operation.effective_date.localeCompare(left.operation.effective_date));
  const visible = items.filter((item) => group === 'all' || item.info.group === group);
  const cashIn = visible.reduce((sum, item) => (item.cash.gt(0) ? sum.plus(item.cash) : sum), new Decimal(0));
  const cashOut = visible.reduce((sum, item) => (item.cash.lt(0) ? sum.plus(item.cash.abs()) : sum), new Decimal(0));
  const groups: { key: string; title: string; items: typeof visible }[] = [];
  for (const item of visible) {
    const key = item.operation.effective_date.slice(0, 7);
    let bucket = groups.find((candidate) => candidate.key === key);
    if (!bucket) {
      bucket = { key, title: `${months[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(item);
  }
  const groupOptions: { id: MovementGroup | 'all'; label: string }[] = [
    { id: 'all', label: 'Todo' },
    { id: 'ahorro', label: 'Ahorro' },
    { id: 'polla', label: 'Polla' },
    { id: 'prestamos', label: 'Préstamos' },
    { id: 'banco', label: 'Banco' },
    { id: 'otros', label: 'Otros' }
  ];

  return (
    <section className="panel wide movements-panel" aria-labelledby="movimientos-titulo">
      <div className="card-head">
        <h2 id="movimientos-titulo">Movimientos financieros</h2>
        <label className="inline-date">
          Corte
          <input type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} />
        </label>
      </div>
      <div className="flow-totals">
        <div><span>Entró a caja</span><strong className="tone-in">{signedCop(cashIn)}</strong></div>
        <div><span>Salió de caja</span><strong>{signedCop(cashOut.neg())}</strong></div>
      </div>
      <div className="filter-chips" role="group" aria-label="Filtrar movimientos">
        {groupOptions.map((option) => (
          <button key={option.id} type="button" className="filter-chip" aria-pressed={group === option.id} onClick={() => setGroup(option.id)}>{option.label}</button>
        ))}
      </div>
      {groups.map((bucket) => (
        <div key={bucket.key} className="movement-group">
          <h3 className="group-title">{bucket.title}</h3>
          <ol className="movement-list">
            {bucket.items.map(({ operation, info, reversed, entries, who, hasCash, main }) => {
              const open = openId === operation.id;
              return (
                <li key={operation.id}>
                  <button type="button" className="movement-row" aria-expanded={open} onClick={() => setOpenId(open ? '' : operation.id)}>
                    <span className={`movement-icon movement-${info.group}`} aria-hidden="true">{info.icon}</span>
                    <span className="row-main">
                      <strong>{info.label}{who ? ` · ${who}` : ''}</strong>
                      <span className="row-sub">{formatShortDate(operation.effective_date)}{hasCash ? '' : ' · no mueve caja'}{reversed?' · Revertido':''}</span>
                    </span>
                    <span className={`row-amount${hasCash && main.gt(0) ? ' tone-in' : ''}`}>{hasCash ? signedCop(main) : formatCop(main, 2)}</span>
                  </button>
                  {open ? (
                    <div className="entry-box">
                      <span className="entry-title">Detalle del movimiento</span>
                      {typeof operation.payload.reference === 'string' ? <span>Referencia: {operation.payload.reference}</span> : null}
                      {operation.reverses_operation_id?<span className="tag">Anulación registrada</span>:<UndoOperationButton operationId={operation.id}/>}
                      {entries.length ? entries.map((entry) => (
                        <span key={entry.id} className="entry-line"><span>{accountLabels[entry.account] ?? humanizeKey(entry.account)}</span><span>{signedCop(new Decimal(entry.amount))}</span></span>
                      )) : <span>Sin partidas visibles.</span>}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      {visible.length === 0 ? <p className="muted">No hay movimientos publicados hasta el corte elegido.</p> : null}
    </section>
  );
}

function SavingsWorkspace({
  workspace,
  cycle,
  cycleMembers,
  contributions,
  capitalCredits,
  sheetRequest,
  onSheetRequestHandled,
  onMemberSaved,
  onContributionSaved,
  onError
}: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  capitalCredits: MemberCapitalCredit[];
  sheetRequest: SavingsSheetRequest | null;
  onSheetRequestHandled: () => void;
  onMemberSaved: () => Promise<void>;
  onContributionSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const totals = useMemo(() => buildSavingsTotals(cycleMembers, contributions), [cycleMembers, contributions]);
  const [sheet, setSheet] = useState<SavingsSheetRequest | null>(() => {
    const stored = readPendingContribution();
    return stored && stored.draft.appliedYear === cycle.year ? { kind: 'contribution' } : null;
  });

  useEffect(() => {
    if (sheetRequest) {
      setSheet(sheetRequest);
      onSheetRequestHandled();
    }
  }, [sheetRequest, onSheetRequestHandled]);

  const closeSheet = () => setSheet(null);

  return (
    <div className="savings-page">
      <PageHeading
        id="ahorros-titulo"
        eyebrow={`Control de aportes del ciclo ${formatCycleRange(cycle)}.`}
        title="Ahorros"
        actions={(
          <>
            <Button type="button" variant="quiet" className="hide-on-mobile" onClick={() => setSheet({ kind: 'member' })}>Nuevo socio</Button>
            <Button type="button" onClick={() => setSheet({ kind: 'contribution' })} disabled={cycleMembers.length === 0}>Registrar aporte</Button>
          </>
        )}
      />

      <SavingsMonthExplorer
        cycle={cycle}
        cycleMembers={cycleMembers}
        contributions={contributions}
        totals={totals}
        onDetail={(memberId) => setSheet({ kind: 'detail', memberId })}
      />

      <SavingsContributionHistory cycleMembers={cycleMembers} contributions={contributions} />

      {sheet?.kind === 'contribution' ? (
        <Sheet title="Registrar aporte" onClose={closeSheet}>
          <ContributionForm
            cycle={cycle}
            cycleMembers={cycleMembers}
            initialMemberId={sheet.memberId}
            onSaved={onContributionSaved}
            onDone={closeSheet}
            onError={onError}
          />
        </Sheet>
      ) : null}

      {sheet?.kind === 'detail' && sheet.memberId ? (() => {
        const item = cycleMembers.find((candidate) => candidate.id === sheet.memberId);
        return item ? (
          <Sheet title={item.member?.display_name ?? 'Socio'} onClose={closeSheet}>
            <MemberCapitalDetail cycle={cycle} item={item} contributions={contributions} credits={capitalCredits} />
          </Sheet>
        ) : null;
      })() : null}

      {sheet?.kind === 'member' ? (
        <Sheet title={sheet.memberId ? 'Editar socio' : 'Nuevo socio'} onClose={closeSheet}>
          <MemberForm
            workspace={workspace}
            cycle={cycle}
            cycleMembers={cycleMembers}
            initialEditingId={sheet.memberId}
            onSaved={onMemberSaved}
            onDone={closeSheet}
            onError={onError}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

type SavingsMonthFilter = 'all' | 'paid' | 'pending';

function SavingsMonthExplorer({
  cycle,
  cycleMembers,
  contributions,
  totals,
  onDetail
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  totals: ReturnType<typeof buildSavingsTotals>;
  onDetail: (cycleMemberId: string) => void;
}) {
  const startMonth = Number(cycle.starts_on.slice(5, 7));
  const endMonth = Number(cycle.closes_on.slice(5, 7));
  const [month, setMonth] = useState(() => {
    const today = civilToday();
    if (today.year === cycle.year) return Math.min(Math.max(today.month, startMonth), endMonth);
    const latest = contributions.reduce((max, item) => (item.applied_year === cycle.year ? Math.max(max, item.applied_month) : max), 0);
    return latest || startMonth;
  });
  const [filter, setFilter] = useState<SavingsMonthFilter>('all');
  const [query, setQuery] = useState('');
  const monthNumbers = useMemo(() => Array.from({ length: endMonth - startMonth + 1 }, (_, index) => startMonth + index), [startMonth, endMonth]);
  const byMonth = useMemo(() => new Map(monthNumbers.map((value) => {
    const rows = buildMonthRows(cycle, cycleMembers, contributions, value);
    return [value, { rows, summary: summarizeMonth(rows) }] as const;
  })), [cycle, cycleMembers, contributions, monthNumbers]);
  const current = byMonth.get(month);
  const rows = current?.rows ?? [];
  const summary = current?.summary ?? summarizeMonth([]);
  const today = civilToday();
  const isFutureMonth = today.year < cycle.year || (today.year === cycle.year && month > today.month);
  const totalProgress = progressPercent(totals.contributed, totals.expected);
  const windowStart = Math.min(Math.max(month - 1, startMonth), Math.max(startMonth, endMonth - 3));
  const stripMonths = monthNumbers.filter((value) => value >= windowStart && value < windowStart + 4);
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO');
  const normalizedQuery = normalize(query.trim());
  const counts = {
    all: rows.length,
    paid: rows.filter((row) => row.paid.gt(0)).length,
    pending: summary.pending
  };
  const filterOptions: { id: SavingsMonthFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'paid', label: 'Con aporte' },
    { id: 'pending', label: 'Pendientes' }
  ];
  const visible = rows
    .filter((row) => (filter === 'all' ? true : filter === 'paid' ? row.paid.gt(0) : row.state !== 'complete'))
    .filter((row) => normalize(`${row.item.member?.display_name ?? ''} ${row.item.member?.legacy_id ?? ''}`).includes(normalizedQuery));
  const monthName = months[month - 1];
  const stateLabel = (row: MonthRow) => row.state === 'complete' ? 'Pagado' : row.state === 'partial' ? 'Parcial' : 'Pendiente';
  const stateTone = (row: MonthRow) => row.state === 'complete' ? 'ok' : row.state === 'partial' ? 'soon' : isFutureMonth ? 'paid' : 'late';

  return (
    <div className="savings-explorer">
      <div className="savings-kpis">
        <article className="kpi-card" data-figure-key="ahorro-total-ciclo">
          <span className="metric-icon quick-green" aria-hidden="true"><QuickIcon path="M5 12c0-3.3 3-6 7-6s7 2.7 7 6c0 2-1 3.6-2.5 4.6V19h-3v-1.2h-3V19h-3v-2.4C6 15.6 5 14 5 12zM16 11h.01M3 11c.2 1 .8 1.8 2 2" /></span>
          <div className="kpi-body">
            <span className="kpi-label" data-figure-label>Total ahorrado (ciclo)</span>
            <strong className="kpi-value" data-figure-value>{formatCop(totals.contributed)}</strong>
            <small className="kpi-sub">de {formatCop(totals.expected)} esperado</small>
            <span className="metric-progress"><ProgressBar value={totalProgress} label={`${totalProgress}% del ahorro esperado recibido`} /><span>{totalProgress}%</span></span>
            <small className="kpi-sub">Debería llevar a hoy {formatCop(totals.dueToday)}{totals.behindToday.gt(0) ? ` · faltan ${formatCop(totals.behindToday)}` : ' · al día'}</small>
          </div>
        </article>
        <article className="kpi-card" data-figure-key="recaudo-del-mes">
          <span className="metric-icon quick-blue" aria-hidden="true"><QuickIcon path="M5 20V10M12 20V4M19 20v-7" /></span>
          <div className="kpi-body">
            <span className="kpi-label" data-figure-label>Recaudo del mes ({monthName.toLowerCase()})</span>
            <strong className="kpi-value" data-figure-value>{formatCop(summary.collected)}</strong>
            <small className="kpi-sub">{summary.contributors} de {summary.count} socios han aportado</small>
            <span className="metric-progress"><ProgressBar value={summary.progress} label={`${summary.progress}% de la cuota esperada del mes`} /><span>{summary.progress}%</span></span>
          </div>
        </article>
      </div>

      <section className="month-picker" aria-label="Seleccionar mes">
        <div className="month-picker-row">
          <button type="button" className="month-step" aria-label="Mes anterior" disabled={month <= startMonth} onClick={() => setMonth(month - 1)}>‹</button>
          <label className="month-select">
            <span className="sr-only">Mes</span>
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {monthNumbers.map((value) => <option key={value} value={value}>{months[value - 1]} {cycle.year}</option>)}
            </select>
          </label>
          <button type="button" className="month-step" aria-label="Mes siguiente" disabled={month >= endMonth} onClick={() => setMonth(month + 1)}>›</button>
        </div>
        <div className="month-strip" role="group" aria-label="Meses del ciclo">
          {stripMonths.map((value) => {
            const info = byMonth.get(value)?.summary;
            return (
              <button key={value} type="button" className="month-tile" aria-pressed={value === month} onClick={() => setMonth(value)} aria-label={`${months[value - 1]}: ${formatCop(info?.collected ?? 0)}, ${info?.progress ?? 0}% de la cuota`}>
                <span className="month-tile-name">{shortMonths[value - 1].charAt(0).toUpperCase() + shortMonths[value - 1].slice(1)}</span>
                <span className="month-tile-amount">{info && info.collected.gt(0) ? formatCop(info.collected) : '—'}</span>
                <span className="month-tile-bar" aria-hidden="true"><span style={{ width: `${info?.progress ?? 0}%` }} /></span>
                <span className="month-tile-pct">{info?.progress ?? 0}%</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="filter-chips" role="group" aria-label="Filtrar aportes del mes">
        {filterOptions.map((option) => (
          <button key={option.id} type="button" className="filter-chip" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
            {option.label}<span className="filter-count">{counts[option.id]}</span>
          </button>
        ))}
      </div>
      <p className="filter-note">«Con aporte» incluye parciales y completos; «Pendientes» incluye parciales y sin aporte, por eso pueden solaparse.</p>

      <label className="search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
        <span className="sr-only">Buscar socio</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar socio…" />
      </label>

      <article className="home-card savings-month-list" aria-label={`Aportes de ${monthName.toLowerCase()}`}>
        {visible.length ? (
          <ul className="row-list">
            {visible.map((row) => {
              const missing = Decimal.max(row.quota.minus(row.paid), 0);
              const extra = row.paid.minus(row.quota);
              return (
                <li key={row.item.id} data-savings-member-row={row.item.id}>
                  <button type="button" className="row-button" onClick={() => onDetail(row.item.id)} aria-label={`${row.item.member?.display_name ?? 'Socio'}, ${stateLabel(row)}, ver detalle`}>
                    <Avatar name={row.item.member?.display_name ?? 'Socio'} />
                    <span className="row-main">
                      <strong>{row.item.member?.display_name ?? 'Socio sin nombre'}</strong>
                      <span className="row-sub">Cuota {formatCop(row.quota)}{row.state === 'complete' ? (extra.gt(0) ? ` · ${formatCop(extra)} extra` : '') : row.eligible ? ` · faltan ${formatCop(missing)}` : ''}</span>
                    </span>
                    <span className="row-end">
                      <span className="row-amount">{formatCop(row.paid)}</span>
                      <StatusChip tone={stateTone(row)}>{stateLabel(row)}</StatusChip>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted card-empty">{rows.length ? 'No hay socios que coincidan con el filtro o la búsqueda.' : cycleMembers.length ? `Ningún socio participa en ${monthName.toLowerCase()}.` : 'Aún no hay socios en este ciclo.'}</p>
        )}
      </article>
    </div>
  );
}

// Socios mantiene formularios existentes; el directorio solo presenta datos ya cargados.
function MembersWorkspace({
  workspace,
  cycle,
  cycleMembers,
  contributions,
  capitalCredits,
  settlements,
  onMemberSaved,
  onViewSavings,
  onError
}: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  capitalCredits: MemberCapitalCredit[];
  settlements: MemberSettlement[];
  onMemberSaved: () => Promise<void>;
  onViewSavings: (memberId: string) => void;
  onError: (error: unknown) => void;
}) {
  const { cutDate } = useFinancialCut();
  const [sheet, setSheet] = useState<SavingsSheetRequest | null>(null);
  const closeSheet = () => setSheet(null);
  return (
    <div className="members-page overview-members">
      <PageHeading
        id="socios-pagina-titulo"
        eyebrow={`Ciclo ${formatCycleRange(cycle)} · ${months[Number(cutDate.slice(5, 7)) - 1]}`}
        title="Socios"
      />
      <MemberKpis cycle={cycle} members={cycleMembers} contributions={contributions} settlements={settlements} cutDate={cutDate} today={todayCivilDate()} />
      <MemberDirectory cycle={cycle} members={cycleMembers} contributions={contributions} settlements={settlements} cutDate={cutDate} today={todayCivilDate()} onNew={() => setSheet({ kind: 'member' })} onViewSavings={onViewSavings} onEdit={memberId => setSheet({ kind: 'member', memberId })} onDetail={memberId => setSheet({ kind: 'detail', memberId })} />

      {sheet?.kind === 'detail' && sheet.memberId ? (() => {
        const item = cycleMembers.find((candidate) => candidate.id === sheet.memberId);
        return item ? (
          <Sheet title={item.member?.display_name ?? 'Socio'} onClose={closeSheet}>
            <MemberCapitalDetail cycle={cycle} item={item} contributions={contributions} credits={capitalCredits} />
          </Sheet>
        ) : null;
      })() : null}

      {sheet?.kind === 'member' ? (
        <Sheet title={sheet.memberId ? 'Editar socio' : 'Nuevo socio'} onClose={closeSheet}>
          <MemberForm
            workspace={workspace}
            cycle={cycle}
            cycleMembers={cycleMembers}
            initialEditingId={sheet.memberId}
            onSaved={onMemberSaved}
            onDone={closeSheet}
            onError={onError}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

function buildSavingsTotals(cycleMembers: CycleMember[], contributions: SavingsContribution[], atDate = todayCivilDate()) {
  const contributed = contributions.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const expected = cycleMembers.reduce((sum, item) => {
    const activeMonths = item.participation_end_month - item.participation_start_month + 1;
    return sum.plus(new Decimal(item.monthly_quota).mul(activeMonths));
  }, new Decimal(0));
  const today = { month: Number(atDate.slice(5, 7)) };
  const dueToday = cycleMembers.reduce((sum, item) => {
    const lastDueMonth = Math.min(item.participation_end_month, today.month);
    const months = Math.max(0, lastDueMonth - item.participation_start_month + 1);
    return sum.plus(new Decimal(item.monthly_quota).mul(months));
  }, new Decimal(0));
  return { contributed, expected, pending: Decimal.max(expected.minus(contributed), 0), dueToday, behindToday: Decimal.max(dueToday.minus(contributed), 0) };
}

function MemberForm({
  workspace,
  cycle,
  cycleMembers,
  initialEditingId,
  onSaved,
  onDone,
  onError
}: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  initialEditingId?: string;
  onSaved: () => Promise<void>;
  onDone?: () => void;
  onError: (error: unknown) => void;
}) {
  const [editingId, setEditingId] = useState('');
  const editing = cycleMembers.find((item) => item.id === editingId);
  const [displayName, setDisplayName] = useState('');
  const [legacyId, setLegacyId] = useState('');
  const [monthlyQuota, setMonthlyQuota] = useState('');
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [participatesInPolla, setParticipatesInPolla] = useState(true);
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
      setParticipatesInPolla(true);
      setParticipatesInLoanProfit(true);
      return;
    }
    setDisplayName(selected.member?.display_name ?? '');
    setLegacyId(selected.member?.legacy_id ?? '');
    setMonthlyQuota(new Decimal(selected.monthly_quota).toFixed(0));
    setStartMonth(selected.participation_start_month);
    setEndMonth(selected.participation_end_month);
    setParticipatesInPolla(selected.participates_in_polla);
    setParticipatesInLoanProfit(selected.participates_in_polla);
  }

  useEffect(() => {
    if (initialEditingId) {
      loadEditing(initialEditingId);
    }
    // Solo al abrir la hoja.
  }, []);

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
      onDone?.();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="sheet-form">
      <label>
        Editar socio
        <select aria-label="Editar socio" value={editingId} onChange={(event) => loadEditing(event.target.value)} disabled={pending}>
          <option value="">Nuevo socio</option>
          {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
        </select>
      </label>
      <label>
        Nombre visible
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required disabled={pending} />
      </label>
      <label>
        Cuota mensual
        <CopInput value={monthlyQuota} onChange={(event) => setMonthlyQuota(event.target.value)} required disabled={pending} inputMode="decimal" placeholder="100.000" />
        <small className="field-hint">{editing ? 'Si ya tiene aportes, la cuota y el rango no se pueden cambiar hacia atrás.' : 'Ejemplo: 100.000'}</small>
      </label>
      <div className="form-pair">
        <MonthSelect label="Desde" value={startMonth} onChange={setStartMonth} disabled={pending} />
        <MonthSelect label="Hasta" value={endMonth} onChange={setEndMonth} disabled={pending} />
      </div>
      <div className="sheet-form">
        <span className="field-label">Modalidad</span>
        <div className="segmented" role="group" aria-label="Modalidad del socio">
          <button type="button" aria-pressed={participatesInPolla} disabled={pending} onClick={() => { setParticipatesInPolla(true); setParticipatesInLoanProfit(true); }}>Polla, Pibank y utilidades</button>
          <button type="button" aria-pressed={!participatesInPolla} disabled={pending} onClick={() => { setParticipatesInPolla(false); setParticipatesInLoanProfit(false); }}>Solo ahorro 12 % EA</button>
        </div>
        <small className="field-hint">{participatesInPolla ? 'Juega polla, recibe rendimientos Pibank y ganancia de préstamos de los socios. No recibe 12 % EA.' : 'Recibe 12 % EA sobre cada aporte. No juega polla ni recibe Pibank ni utilidades.'}</small>
      </div>
      <label>
        Código del socio (opcional)
        <input value={legacyId} onChange={(event) => setLegacyId(event.target.value)} disabled={pending} />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Guardando...' : editing ? 'Actualizar socio' : 'Crear socio'}</button>
    </form>
  );
}

function ContributionForm({
  cycle,
  cycleMembers,
  initialMemberId,
  onSaved,
  onDone,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  initialMemberId?: string;
  onSaved: () => Promise<void>;
  onDone?: () => void;
  onError: (error: unknown) => void;
}) {
  const [cycleMemberId, setCycleMemberId] = useState(initialMemberId ?? '');
  const [amountText, setAmountText] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilDate());
  const [appliedMonth, setAppliedMonth] = useState(() => civilToday().month);
  const [method, setMethod] = useState<ContributionMethod>('bank_transfer');
  const [pendingOperation, setPendingOperation] = useState<PendingContributionOperation | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const selected = cycleMembers.find((item) => item.id === cycleMemberId);

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
    setFieldErrors({});
    setFormError('');
    setPending(true);
    let operationForRetry: PendingContributionOperation | null = null;
    let savedByServer = false;
    try {
      validateContributionDraft({
        memberId: cycleMemberId,
        amountText,
        effectiveDate,
        appliedYear: cycle.year,
        appliedMonth,
        method,
        idempotencyKey: pendingOperation?.idempotencyKey ?? 'local-validation-key'
      });
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
      onDone?.();
    } catch (error) {
      if (operationForRetry && !savedByServer) {
        const unknownOperation = { ...operationForRetry, status: 'unknown' as const, updatedAt: new Date().toISOString() };
        setPendingOperation(unknownOperation);
        writePendingContribution(unknownOperation);
      }
      const message = userSafeError(error);
      setContributionFieldError(message, setFieldErrors, setFormError);
      onError(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="sheet-form">
      {pendingOperation ? (
        <InlineNotice tone="warning">
          Hay un aporte sin confirmar. Vuelve a guardarlo sin cambiar los datos para terminar la misma operación.
        </InlineNotice>
      ) : null}
      {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
      <label className={fieldErrors.member ? 'field field-invalid' : 'field'}>
        Socio
        <select aria-label="Socio del aporte" value={cycleMemberId} onChange={(event) => setCycleMemberId(event.target.value)} required disabled={pending}>
          <option value="">Seleccionar</option>
          {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
        </select>
        {fieldErrors.member ? (
          <small className="field-error">{fieldErrors.member}</small>
        ) : selected ? (
          <small className="field-hint">Cuota {formatCop(selected.monthly_quota)} · {months[selected.participation_start_month - 1]} a {months[selected.participation_end_month - 1]}</small>
        ) : null}
      </label>
      <div className="amount-group">
        <label className={fieldErrors.amount ? 'field field-invalid' : 'field'}>
          Monto recibido
          <CopInput className="input-amount" value={amountText} onChange={(event) => setAmountText(event.target.value)} required disabled={pending} inputMode="decimal" placeholder="150.000" />
          {fieldErrors.amount ? <small className="field-error">{fieldErrors.amount}</small> : null}
        </label>
        {selected ? (
          <div className="chip-row" aria-label="Montos rápidos">
            {[1, 2, 3].map((count) => (
              <button
                key={count}
                type="button"
                className="chip"
                disabled={pending}
                onClick={() => setAmountText(formatCopInput(new Decimal(selected.monthly_quota).mul(count)))}
              >
                {count === 1 ? '1 cuota' : `${count} cuotas`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="form-pair">
        <MonthSelect label="Mes aplicado" value={appliedMonth} onChange={setAppliedMonth} disabled={pending} />
        <label className={fieldErrors.date ? 'field field-invalid' : 'field'}>
          Fecha efectiva
          <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required disabled={pending} />
          {fieldErrors.date ? <small className="field-error">{fieldErrors.date}</small> : null}
        </label>
      </div>
      {fieldErrors.month ? <small className="field-error">{fieldErrors.month}</small> : null}
      <label>
        Método
        <select value={method} onChange={(event) => setMethod(event.target.value as ContributionMethod)} disabled={pending}>
          <option value="bank_transfer">Transferencia</option>
          <option value="bank_deposit">Consignación bancaria</option>
          <option value="cash">Efectivo</option>
          <option value="other">Otro</option>
        </select>
      </label>
      <small className="field-hint">La fecha efectiva es el día real del pago; desde ahí el aporte genera rendimiento.</small>
      <button type="submit" disabled={pending || cycleMembers.length === 0}>{pending ? 'Confirmando...' : 'Guardar aporte'}</button>
    </form>
  );
}

function setContributionFieldError(
  message: string,
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setFormError: React.Dispatch<React.SetStateAction<string>>
) {
  const lower = message.toLowerCase();
  if (lower.includes('socio')) {
    setFieldErrors({ member: message });
    return;
  }
  if (lower.includes('aporte') || lower.includes('monto') || lower.includes('positivo') || lower.includes('decimales')) {
    setFieldErrors({ amount: message });
    return;
  }
  if (lower.includes('fecha')) {
    setFieldErrors({ date: message });
    return;
  }
  if (lower.includes('mes')) {
    setFieldErrors({ month: message });
    return;
  }
  setFormError(message);
}

function memberStatus(total: Decimal, expected: Decimal) {
  if (total.isZero()) {
    return 'Sin aportes';
  }
  if (total.gte(expected)) {
    const extra = total.minus(expected);
    return extra.gt(0) ? `Completo · ${formatCop(extra)} extra` : 'Completo';
  }
  return `Faltan ${formatCop(expected.minus(total))}`;
}

function SavingsContributionHistory({ cycleMembers, contributions }: { cycleMembers: CycleMember[]; contributions: SavingsContribution[] }) {
  const [showAll, setShowAll] = useState(false);
  const [order, setOrder] = useState<'effective' | 'created'>('effective');
  const [openId, setOpenId] = useState('');
  const membersByCycleMemberId = new Map(cycleMembers.map((item) => [item.id, item]));
  const sorted = [...contributions].sort((left, right) =>
    order === 'effective'
      ? right.effective_date.localeCompare(left.effective_date) || right.created_at.localeCompare(left.created_at)
      : right.created_at.localeCompare(left.created_at)
  );
  const visible = showAll ? sorted : sorted.slice(0, 8);

  return (
    <Panel className="savings-history-panel" aria-labelledby="historial-titulo">
      <div className="card-head">
        <h2 id="historial-titulo">Últimos aportes</h2>
        <div className="segmented segmented-small" role="group" aria-label="Ordenar aportes">
          <button type="button" aria-pressed={order === 'effective'} onClick={() => setOrder('effective')}>Por fecha de pago</button>
          <button type="button" aria-pressed={order === 'created'} onClick={() => setOrder('created')}>Por registro</button>
        </div>
      </div>
      {visible.length ? (
        <ol className="history-list">
          {visible.map((contribution) => {
            const member = membersByCycleMemberId.get(contribution.cycle_member_id);
            const open = openId === contribution.id;
            return (
              <li key={contribution.id} data-savings-contribution-row={contribution.id} className="history-item">
                <button type="button" className="history-row" aria-expanded={open} onClick={() => setOpenId(open ? '' : contribution.id)}>
                  <span className="history-main">
                    <span className="history-name">{member?.member?.display_name ?? 'Socio'}</span>
                    <span className="history-meta">
                      {order === 'effective' ? `Pagado el ${formatShortDate(contribution.effective_date)}` : `Registrado el ${formatShortDate(todayCivilDate(new Date(contribution.created_at)))}`} · cuota de {months[contribution.applied_month - 1].toLowerCase()} · {contributionMethodLabel(contribution.method)}
                    </span>
                  </span>
                  <span className="history-amount">{formatCop(contribution.amount)}</span>
                </button>
                {open ? (
                  <div className="entry-box">
                    <span className="entry-line"><span>Origen</span><span>{contribution.source === 'manual' ? 'Registrado en la app' : contributionSourceLabel(contribution.source)}</span></span>
                    {contribution.status!=='reversed'?<UndoOperationButton sourceId={contribution.id}/>:<span className="tag">Revertido</span>}
                    <span className="entry-line"><span>Mes aplicado</span><span>{months[contribution.applied_month - 1]} {contribution.applied_year}</span></span>
                    <span className="entry-line"><span>Pagado el</span><span>{formatShortDate(contribution.effective_date)}</span></span>
                    <span className="entry-line"><span>Registrado el</span><span>{formatShortDate(todayCivilDate(new Date(contribution.created_at)))}</span></span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">Aún no hay aportes registrados en este ciclo.</p>
      )}
      {contributions.length > 8 ? (
        <button type="button" className="link-button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Ver menos' : `Ver todos (${contributions.length})`}
        </button>
      ) : null}
    </Panel>
  );
}

function contributionMethodLabel(method: SavingsContribution['method']) {
  return {
    bank_transfer: 'Transferencia',
    bank_deposit: 'Consignación bancaria',
    cash: 'Efectivo',
    other: 'Otro'
  }[method];
}

function contributionSourceLabel(source: SavingsContribution['source']) {
  return {
    manual: 'Manual',
    legacy_prevalidation: 'Registrado',
    legacy_migration_trial: 'Registrado',
    legacy_operational_import: 'Registrado'
  }[source];
}

type LoanFilter = 'open' | 'due' | 'late' | 'today' | 'ok' | 'paid' | 'all';
type PayMode = 'cuota' | 'other' | 'total';

export function LoansPanel({
  bankAccounts = [],
  cycle,
  cycleMembers,
  loans,
  payments,
  schedules,
  operations = [],
  ledgerEntries,
  settlements = [],
  intent,
  onIntentHandled,
  onSaved,
  onError
}: {
  cycle: Cycle;
  bankAccounts?: BankAccount[];
  cycleMembers: CycleMember[];
  loans: LoanContract[];
  payments: LoanPayment[];
  schedules: LoanSchedule[];
  operations?: FinancialOperation[];
  ledgerEntries?: LedgerEntry[];
  settlements?: MemberSettlement[];
  intent: LoanIntent | null;
  onIntentHandled: () => void;
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
  const loanDetailRef = useRef<HTMLDivElement>(null);
  const loanOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [detailNavigation, setDetailNavigation] = useState(0);
  useEffect(() => {
    if (!detailNavigation) return;
    loanDetailRef.current?.focus({ preventScroll: true });
    loanDetailRef.current?.scrollIntoView({ block: 'start' });
  }, [detailNavigation]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [capitalAmount, setCapitalAmount] = useState('');
  const [interestAmount, setInterestAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayCivilDate());
  const [paymentNote, setPaymentNote] = useState('');
  const [receiptTo, setReceiptTo] = useState<MoneySheetLocation>({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: bankAccounts[0]?.id ?? '' });
  const [paymentKind, setPaymentKind] = useState<'regular' | 'prepayment'>('regular');
  const [prepaymentQuote, setPrepaymentQuote] = useState<LoanPrepaymentQuote | null>(null);
  const [paymentPlanKey, setPaymentPlanKey] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LoanFilter>('open');
  const [loanError, setLoanError] = useState('');
  const [pending, setPending] = useState(false);
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>('cuota');
  const [showPaidInstallments, setShowPaidInstallments] = useState(false);
  const [disburseTarget, setDisburseTarget] = useState<{ loanId: string; date: string } | null>(null);

  const today = todayCivilDate();
  const financialCut = useFinancialCut();
  const cut = financialCut.cutDate || today;
  const serverToday = useServerCivilToday();
  const latestCut = serverToday < cycle.closes_on ? serverToday : cycle.closes_on;
  const historicalCut = cut < latestCut;
  const historicalMessage = 'Consulta histórica: cambia la fecha de corte al último día disponible para registrar pagos o desembolsos.';
  const loanRows = useMemo(() => buildLoanRows(loans, payments, schedules, cut, operations), [loans, payments, schedules, cut, operations]);
  const described = loanRows.map((row) => ({ row, info: describeLoan(row, cut) }));
  const urgency: Record<LoanTone, number> = { late: 0, review: 1, soon: 2, draft: 3, ok: 4, paid: 5, cancelled: 6 };
  // Los filtros nuevos ('late', 'today') solo seleccionan la clasificación existente de describeLoan; 'due' conserva su predicado.
  const filterMatches = ({ row, info }: { row: LoanRow; info: { tone: LoanTone; days: number | null } }, value: LoanFilter) => {
    const tone = info.tone;
    if (value === 'all') return true;
    if (value === 'open') return tone !== 'paid' && tone !== 'cancelled';
    if (value === 'due') return tone === 'late' || tone === 'soon' || tone === 'review';
    // 'Vencidos' y 'Paga hoy' usan las mismas cuotas abiertas que los resúmenes: un préstamo con una cuota vencida y otra que vence hoy aparece en ambos.
    if (value === 'late') return openInstallments(row, cut).overdue.length > 0;
    if (value === 'today') return openInstallments(row, cut).dueToday.length > 0;
    if (value === 'ok') return tone === 'ok';
    return tone === 'paid';
  };
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO');
  const normalizedQuery = normalizeSearch(query.trim());
  const visibleLoans = described
    .filter((entry) => filterMatches(entry, filter) && normalizeSearch(`${entry.row.borrower} ${entry.row.loan.legacy_id ?? ''}`).includes(normalizedQuery))
    .sort((left, right) => urgency[left.info.tone] - urgency[right.info.tone] || (left.info.days ?? 999) - (right.info.days ?? 999));
  const filterOptions: { id: LoanFilter; label: string }[] = [
    { id: 'open', label: 'Abiertos' },
    { id: 'due', label: 'Por cobrar' },
    { id: 'late', label: 'Vencidos' },
    { id: 'today', label: 'Paga hoy' },
    { id: 'ok', label: 'Al día' },
    { id: 'paid', label: 'Pagados' },
    { id: 'all', label: 'Todos' }
  ];
  const activeLoanRows = loanRows.filter((row) => row.loan.status === 'active');
  const cartera = ledgerEntries ? reconstructMoney(operations,ledgerEntries,cut).receivable : activeLoanRows.reduce((sum, row) => sum.plus(row.pendingPrincipal), new Decimal(0));
  const financialContext = useContext(CorrectionContext);
  const lentPrincipal = originalPrincipalAtCut(loans, financialContext?.operations ?? [], cut);
  const interestCollected = ledgerEntries ? collectedLoanInterest(operations,ledgerEntries,cut,settlements).total : loanRows.reduce((sum, row) => sum.plus(row.postedInterest).plus(row.legacyInterest).plus(row.settledInterest), new Decimal(0));
  // Cuotas abiertas vencidas / que vencen hoy: se suma lo que falta (scheduleRemaining) de cada cuota; no se recalcula ningún interés.
  // Si algún préstamo activo no tiene cronograma, las cifras son un mínimo conocido y se presentan como «No disponible».
  const collections = summarizeCollections(loanRows, cut);
  const collectionsKnown = collections.complete;
  const unscheduledNote = `${collections.unscheduledLoans} ${collections.unscheduledLoans === 1 ? 'préstamo' : 'préstamos'} sin cronograma`;
  const selectedRow = loanRows.find(({ loan }) => loan.id === selectedLoanId);
  const automaticApplication = selectedRow?.loan.method === 'amortized' && selectedRow.loan.rate_unit === 'EA' && selectedRow.loan.settlement_agreement_code !== 'P013_FIRST_MONTH';
  const applicationKey = `${selectedLoanId}|${paymentDate}|${paymentAmount}`;
  useEffect(() => {
    if (!paymentOpen || payMode === 'total' || !automaticApplication) return;
    let cancelled = false;
    setPaymentPlanKey('');
    const timer = window.setTimeout(() => {
      let amount: string;
      try { amount = toDatabaseMoney(parseCop(paymentAmount, 'pago')); } catch { return; }
      const attempt = readPendingFinancialOperation(`loan:payment:${cycle.id}:${selectedLoanId}`);
      if (attempt) {
        let saved;
        try { saved = JSON.parse(attempt.canonicalPayload); } catch { setLoanError('No se pudo recuperar el cobro pendiente. Revisa su estado antes de registrar otro.'); return; }
        if (saved.loanId === selectedLoanId && saved.paymentDate === paymentDate && saved.amount === amount) {
          setCapitalAmount(formatCopInput(new Decimal(saved.capitalAmount)));
          setInterestAmount(formatCopInput(new Decimal(saved.interestAmount)));
          setPaymentPlanKey(applicationKey);
          return;
        }
      }
      void quoteLoanPayment(selectedLoanId, paymentDate, amount).then((plan) => {
        if (cancelled) return;
        setCapitalAmount(formatCopInput(new Decimal(plan.capital_amount)));
        setInterestAmount(formatCopInput(new Decimal(plan.interest_amount)));
        setPaymentPlanKey(applicationKey);
        setLoanError('');
      }).catch((error) => { if (!cancelled) setLoanError(userSafeError(error)); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [paymentOpen, payMode, automaticApplication, selectedLoanId, paymentDate, paymentAmount, applicationKey, cycle.id]);
  const selectedInfo = selectedRow ? describeLoan(selectedRow, cut) : null;
  const methodLabels = { amortized: 'Amortizado', fixed_interest: 'Interés fijo', interest_only: 'Solo interés' };
  const paymentSummary = (() => {
    try {
      if (!paymentAmount || !capitalAmount || !interestAmount) return null;
      const total = parseCop(paymentAmount, 'pago');
      const capital = parseCop(capitalAmount, 'capital');
      const interest = parseCop(interestAmount, 'interes');
      return { total, capital, interest, matches: total.eq(capital.plus(interest)) };
    } catch {
      return null;
    }
  })();

  // Atajo de "2 cuotas": solo existe si hay al menos dos cuotas abiertas; suma lo que falta de cada una (scheduleRemaining).
  const openForShortcut = selectedRow ? selectedRow.schedules.filter((schedule) => schedule.status !== 'cancelled' && !isSchedulePaid(schedule)).slice(0, 2) : [];
  const twoInstallments = openForShortcut.length === 2 && selectedRow?.loan.status === 'active'
    ? openForShortcut.reduce((acc, schedule) => {
        const remaining = scheduleRemaining(schedule);
        return { capital: acc.capital.plus(remaining.capital), interest: acc.interest.plus(remaining.interest), total: acc.total.plus(remaining.total) };
      }, { capital: new Decimal(0), interest: new Decimal(0), total: new Decimal(0) })
    : null;

  function applyTwoInstallments() {
    if (!twoInstallments) return;
    setPayMode('other');
    setPrepaymentQuote(null);
    setLoanError('');
    setPaymentKind('regular');
    setPaymentAmount(formatCopInput(twoInstallments.total));
    if (!automaticApplication) {
      setCapitalAmount(formatCopInput(twoInstallments.capital));
      setInterestAmount(formatCopInput(twoInstallments.interest));
    }
  }

  function selectLoan(loanId: string, opener?: HTMLButtonElement) {
    setSelectedLoanId(loanId);
    setPrepaymentQuote(null);
    setShowPaidInstallments(false);
    if (opener) {
      loanOpenerRef.current = opener;
      setDetailNavigation(value => value + 1);
    }
    if (!loanId) requestAnimationFrame(() => loanOpenerRef.current?.focus());
  }

  function applyPayMode(mode: PayMode, row: LoanRow | undefined = selectedRow) {
    setPayMode(mode);
    setPrepaymentQuote(null);
    setLoanError('');
    if (mode === 'cuota' && row?.nextSchedule) {
      const next = row.nextSchedule;
      const remaining = scheduleRemaining(next);
      setCapitalAmount(formatCopInput(remaining.capital));
      setInterestAmount(formatCopInput(remaining.interest));
      setPaymentAmount(formatCopInput(remaining.total));
      setPaymentKind('regular');
    } else if (mode === 'other') {
      setPaymentAmount('');
      setCapitalAmount('');
      setInterestAmount('');
      setPaymentKind('regular');
    } else if (mode === 'total') {
      void quotePrepayment(row?.loan.id);
    }
  }

  function openPayment(mode: PayMode, row: LoanRow | undefined = selectedRow) {
    if (pending) return;
    if (historicalCut) { setLoanError(historicalMessage); return; }
    setPaymentOpen(true);
    setPaymentNote('');
    const attempt = row ? readPendingFinancialOperation(`loan:${mode === 'total' ? 'prepayment' : 'payment'}:${cycle.id}:${row.loan.id}`) : null;
    if (attempt) {
      let saved;
      try { saved = JSON.parse(attempt.canonicalPayload); } catch { setLoanError('No se pudo recuperar el cobro pendiente. Revisa su estado antes de registrar otro.'); return; }
      if (saved.loanId === row?.loan.id) {
        setPaymentNote(saved.note ?? '');
        setReceiptTo({ location: saved.bankAccountId ? 'bank' : 'cash', bankAccountId: saved.bankAccountId ?? '' });
        setPaymentDate(saved.paymentDate);
        if (mode === 'total' && saved.quote) {
          setPrepaymentQuote(saved.quote); setPayMode('total'); setPaymentKind('prepayment');
          setPaymentAmount(formatNumberForInput(saved.quote.total_due)); setCapitalAmount(formatNumberForInput(saved.quote.principal_due)); setInterestAmount(formatNumberForInput(saved.quote.interest_due));
          return;
        }
        setPaymentAmount(formatCopInput(new Decimal(saved.amount)));
        setCapitalAmount(formatCopInput(new Decimal(saved.capitalAmount)));
        setInterestAmount(formatCopInput(new Decimal(saved.interestAmount)));
        setPaymentKind(saved.kind);
        setPayMode('other');
        return;
      }
    }
    applyPayMode(mode, row);
  }

  useEffect(() => {
    if (!intent) {
      return;
    }
    if (intent.kind === 'new') {
      setLoanError('');
      setNewLoanOpen(true);
    } else {
      const row = loanRows.find((candidate) => candidate.loan.id === intent.loanId);
      if (row) {
        selectLoan(row.loan.id);
        openPayment(row.nextSchedule ? 'cuota' : 'other', row);
      }
    }
    onIntentHandled();
  }, [intent]);

  async function submitLoan(event: React.FormEvent) {
    event.preventDefault();
    setLoanError('');
    let amount: string;
    let rate: string;
    try {
      amount = toDatabaseMoney(parseCop(principal, 'principal'));
      rate = parseCop(rateValue, 'tasa').div(100).toString();
    } catch (error) {
      setLoanError(userSafeError(error));
      return;
    }
    const payload = {
      cycleId: cycle.id,
      borrowerMemberId: borrowerMemberId || null,
      externalBorrowerName: borrowerMemberId ? null : externalName,
      referredByMemberId: referredByMemberId || null,
      principal: amount,
      method,
      rateUnit,
      rateValue: rate,
      termMonths,
      startDate
    };
    await runPendingFinancialAction({
      scope: `loan:create:${cycle.id}`,
      payload,
      setPending,
      onSaved: async () => {
        setNewLoanOpen(false);
        await onSaved();
      },
      onError: (error) => {
        setLoanError(userSafeError(error));
        onError(error);
      },
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

  function openDisburse(loan: LoanContract) {
    if (historicalCut) { setLoanError(historicalMessage); return; }
    setLoanError('');
    setDisburseTarget({ loanId: loan.id, date: loan.start_date || todayCivilDate() });
  }

  async function disburseLoan(loanId: string, disbursementDate: string) {
    if (historicalCut) { setLoanError(historicalMessage); return; }
    await runPendingFinancialAction({
      scope: `loan:disburse:${cycle.id}:${loanId}`,
      payload: { loanId, disbursementDate },
      setPending,
      onSaved: async () => {
        setDisburseTarget(null);
        await onSaved();
      },
      onError: (error) => {
        setLoanError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => confirmLoanDisbursement(loanId, disbursementDate, idempotencyKey)
    });
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (historicalCut) { setLoanError(historicalMessage); return; }
    if (receiptTo.location === 'bank' && !receiptTo.bankAccountId) return;
    if (automaticApplication && paymentPlanKey !== applicationKey) return;
    setLoanError('');
    let amounts: { amount: string; capitalAmount: string; interestAmount: string };
    try {
      amounts = {
        amount: toDatabaseMoney(parseCop(paymentAmount, 'pago')),
        capitalAmount: toDatabaseMoney(parseCop(capitalAmount, 'capital')),
        interestAmount: toDatabaseMoney(parseCop(interestAmount, 'interes'))
      };
    } catch (error) {
      setLoanError(userSafeError(error));
      return;
    }
    const pendingReceipt = readPendingFinancialOperation(`loan:payment:${cycle.id}:${selectedLoanId}`);
    let originalPayload;
    try { originalPayload = pendingReceipt ? JSON.parse(pendingReceipt.canonicalPayload) : null; }
    catch { setLoanError('No se pudo recuperar el cobro pendiente. Revisa su estado antes de registrar otro.'); return; }
    const withDestination = !originalPayload || Object.hasOwn(originalPayload, 'bankAccountId');
    const destination = receiptTo.location === 'bank' ? receiptTo.bankAccountId : null;
    const withNote = !originalPayload || Object.hasOwn(originalPayload, 'note');
    const payload = { loanId: selectedLoanId, paymentDate, ...amounts, kind: paymentKind, ...(withDestination ? { bankAccountId: destination } : {}), ...(withNote ? { note: paymentNote.trim() || null } : {}) };
    await runPendingFinancialAction({
      scope: `loan:payment:${cycle.id}:${selectedLoanId}`,
      payload,
      setPending,
      onSaved: async () => {
        await onSaved();
        setPrepaymentQuote(null);
        setPaymentOpen(false);
      },
      onError: (error) => {
        setLoanError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => recordLoanPayment({
        loanId: selectedLoanId,
        idempotencyKey,
        paymentDate,
        amount: payload.amount,
        capitalAmount: payload.capitalAmount,
        interestAmount: payload.interestAmount,
        kind: paymentKind,
        bankAccountId: withDestination ? destination : undefined,
        note: withNote ? payload.note : undefined
      })
    });
  }

  async function quotePrepayment(loanId = selectedLoanId) {
    if (historicalCut) { setLoanError(historicalMessage); return; }
    if (!loanId) {
      return;
    }
    setPending(true);
    setLoanError('');
    try {
      const quote = await quoteLoanPrepayment(loanId, paymentDate);
      setPrepaymentQuote(quote);
      setPaymentAmount(formatNumberForInput(quote.total_due));
      setCapitalAmount(formatNumberForInput(quote.principal_due));
      setInterestAmount(formatNumberForInput(quote.interest_due));
      setPaymentKind('prepayment');
    } catch (error) {
      setLoanError(userSafeError(error));
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function submitQuotedPrepayment() {
    if (historicalCut) { setLoanError(historicalMessage); return; }
    if (!selectedLoanId || !prepaymentQuote || receiptTo.location === 'bank' && !receiptTo.bankAccountId) {
      return;
    }
    const pendingReceipt = readPendingFinancialOperation(`loan:prepayment:${cycle.id}:${selectedLoanId}`);
    let originalPayload;
    try { originalPayload = pendingReceipt ? JSON.parse(pendingReceipt.canonicalPayload) : null; }
    catch { setLoanError('No se pudo recuperar el cobro pendiente. Revisa su estado antes de registrar otro.'); return; }
    const withDestination = !originalPayload || Object.hasOwn(originalPayload, 'bankAccountId');
    const destination = receiptTo.location === 'bank' ? receiptTo.bankAccountId : null;
    const withNote = !originalPayload || Object.hasOwn(originalPayload, 'note');
    await runPendingFinancialAction({
      scope: `loan:prepayment:${cycle.id}:${selectedLoanId}`,
      payload: { loanId: selectedLoanId, paymentDate, quote: prepaymentQuote, ...(withDestination ? { bankAccountId: destination } : {}), ...(withNote ? { note: paymentNote.trim() || null } : {}) },
      setPending,
      onSaved: async () => {
        await onSaved();
        setPrepaymentQuote(null);
        setPaymentOpen(false);
      },
      onError: (error) => {
        setLoanError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => confirmLoanPrepayment(selectedLoanId, paymentDate, idempotencyKey, prepaymentQuote.quote_hash, withDestination ? destination : undefined, withNote ? paymentNote.trim() || null : undefined)
    });
  }

  const next = selectedRow?.nextSchedule;
  const referrer = selectedRow?.loan.referred_by_member_id
    ? cycleMembers.find((item) => item.member_id === selectedRow.loan.referred_by_member_id)?.member?.display_name
    : undefined;
  const ringPct = selectedRow && selectedRow.totalInstallments ? Math.round((selectedRow.paidInstallments / selectedRow.totalInstallments) * 100) : selectedRow?.loan.status === 'paid' ? 100 : 0;
  const paidSchedules = selectedRow ? selectedRow.schedules.filter(isSchedulePaid) : [];
  const openSchedules = selectedRow ? selectedRow.schedules.filter((schedule) => schedule.status !== 'cancelled' && !isSchedulePaid(schedule)) : [];
  const closedSchedules = selectedRow ? selectedRow.schedules.filter(schedule => schedule.closed_by_settlement) : [];
  const payModeLabels: Record<PayMode, string> = { cuota: 'Cuota', other: 'Otro monto', total: 'Pagar todo' };

  // Atajos de tipo de pago: van debajo del monto (como en la referencia); en pago total, donde no hay monto, quedan bajo su propio título.
  const payTypeChips = (
    <div className="segmented pay-shortcuts" role="group" aria-label="Tipo de pago">
      {(['cuota', 'other', 'total'] as PayMode[]).map((mode) => (
        <button key={mode} type="button" aria-pressed={payMode === mode} onClick={() => applyPayMode(mode)} disabled={pending || (mode === 'cuota' && !next)}>{payModeLabels[mode]}</button>
      ))}
      {twoInstallments ? (
        <button type="button" aria-pressed={payMode === 'other' && paymentAmount === formatCopInput(twoInstallments.total)} onClick={() => applyTwoInstallments()} disabled={pending}>2 cuotas</button>
      ) : null}
    </div>
  );
  return (
    <section className="loans-page" aria-labelledby="prestamos-titulo">
      <div className="page-heading">
        <div className="page-heading-copy">
          <h2 id="prestamos-titulo">Préstamos</h2>
          <p className="page-eyebrow">Gestiona los préstamos y su seguimiento.</p>
        </div>
        <div className="page-actions">
          <Button type="button" className="button-add" onClick={() => { setLoanError(''); setNewLoanOpen(true); }}><span aria-hidden="true" className="button-add-plus">+</span><span className="button-add-label">Nuevo préstamo</span></Button>
        </div>
      </div>
      {loanError && !paymentOpen && !newLoanOpen ? <InlineNotice tone="danger">{loanError}</InlineNotice> : null}
      {historicalCut && !selectedRow ? <InlineNotice tone="neutral">{historicalMessage}</InlineNotice> : null}

      {!selectedRow ? (
        <>
          <div className="loans-portfolio" data-figure-key="cartera-activa">
            <span className="metric-icon quick-green" aria-hidden="true"><QuickIcon path="M9 4h6l-1.5 3h-3zM8 9c-2.5 2-4 4.5-4 7.5C4 19 6.5 20 12 20s8-1 8-3.5c0-3-1.5-5.5-4-7.5zM12 12v5M10 13.5h3a1 1 0 010 2h-2a1 1 0 000 2h3" /></span>
            <div className="kpi-body">
              <span className="kpi-label" data-figure-label>Por cobrar (préstamos)</span>
              <strong className="kpi-value" data-figure-value>{formatCop(cartera)}</strong>
              <small className="kpi-sub">Capital pendiente · {activeLoanRows.length} {activeLoanRows.length === 1 ? 'préstamo activo' : 'préstamos activos'}</small>
            </div>
          </div>

          <div className="loans-metrics" aria-label="Resumen de préstamos">
            <div className="loans-metric" data-figure-key="capital-prestado">
              <span className="metric-icon quick-blue" aria-hidden="true"><QuickIcon path="M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v5C4 12.9 7.6 14 12 14s8-1.1 8-2.5v-5M4 11.5v5C4 17.9 7.6 19 12 19s8-1.1 8-2.5v-5" /></span>
              <span className="metric-label" data-figure-label>Prestado en el año</span>
              <strong className="metric-value" data-figure-value>{formatCop(lentPrincipal)}</strong>
              <small className="metric-micro">Original de todos los préstamos desembolsados</small>
            </div>
            <div className="loans-metric" data-figure-key="intereses-cobrados-prestamos">
              <span className="metric-icon quick-violet" aria-hidden="true"><QuickIcon path="M5 20V10M12 20V4M19 20v-7" /></span>
              <span className="metric-label" data-figure-label>Intereses cobrados</span>
              <strong className="metric-value" data-figure-value>{formatCop(interestCollected)}</strong>
              <small className="metric-micro">Acumulado del ciclo</small>
            </div>
            <div className="loans-metric" data-figure-key="saldo-vencido">
              <span className="metric-icon quick-danger" aria-hidden="true"><QuickIcon path="M12 4l9 16H3zM12 10v4M12 17h.01" /></span>
              <span className="metric-label" data-figure-label>Saldo vencido</span>
              <strong className="metric-value" data-figure-value>{collectionsKnown ? formatCop(collections.overdueTotal) : 'No disponible'}</strong>
              <small className="metric-micro">{collectionsKnown ? 'Cuotas vencidas según cronograma' : `Falta cronograma: ${unscheduledNote}`}</small>
            </div>
          </div>

          <section className="attention-block" aria-labelledby="atencion-titulo">
            <div className="attention-head">
              <span className="attention-icon" aria-hidden="true"><QuickIcon path="M12 4l9 16H3zM12 10v4M12 17h.01" /></span>
              <div>
                <h3 id="atencion-titulo">Requieren atención</h3>
                <p>Cuotas atrasadas y pagos de hoy</p>
              </div>
            </div>
            <ul className="attention-list">
              <li>
                <button type="button" className="attention-row" onClick={() => setFilter('late')} aria-label={collectionsKnown ? `Cuotas atrasadas: ${collections.overdueLoans} ${collections.overdueLoans === 1 ? 'préstamo' : 'préstamos'} en mora. Ver vencidos` : `Cuotas atrasadas: monto no disponible, ${unscheduledNote}. ${collections.overdueLoans} en mora según los cronogramas existentes. Ver vencidos`}>
                  <span className="attention-count attention-count-late" aria-hidden="true">{collectionsKnown ? collections.overdueLoans : `${collections.overdueLoans}+`}</span>
                  <span className="row-main"><strong>Cuotas atrasadas</strong><span className="attention-amount">{collectionsKnown ? formatCop(collections.overdueTotal) : 'No disponible'}</span><span className="row-sub">{collectionsKnown ? `${collections.overdueLoans} ${collections.overdueLoans === 1 ? 'préstamo en mora' : 'préstamos en mora'}` : `${collections.overdueLoans} en mora según cronogramas · ${unscheduledNote}`}</span></span>
                  <span aria-hidden="true" className="attention-chevron">›</span>
                </button>
              </li>
              <li>
                <button type="button" className="attention-row" onClick={() => setFilter('today')} aria-label={collectionsKnown ? `Pagos de hoy: ${collections.todayLoans} ${collections.todayLoans === 1 ? 'préstamo programado' : 'préstamos programados'}. Ver pagos de hoy` : `Pagos de hoy: monto no disponible, ${unscheduledNote}. ${collections.todayLoans} programados según los cronogramas existentes. Ver pagos de hoy`}>
                  <span className="attention-count attention-count-today" aria-hidden="true">{collectionsKnown ? collections.todayLoans : `${collections.todayLoans}+`}</span>
                  <span className="row-main"><strong>Pagos de hoy</strong><span className="attention-amount">{collectionsKnown ? formatCop(collections.todayTotal) : 'No disponible'}</span><span className="row-sub">{collectionsKnown ? `${collections.todayLoans} ${collections.todayLoans === 1 ? 'préstamo programado' : 'préstamos programados'}` : `${collections.todayLoans} ${collections.todayLoans === 1 ? 'programado' : 'programados'} según cronogramas · ${unscheduledNote}`}</span></span>
                  <span aria-hidden="true" className="attention-chevron">›</span>
                </button>
              </li>
            </ul>
          </section>
        </>
      ) : null}

      {selectedRow && selectedInfo ? (
        <div className="loan-detail" ref={loanDetailRef} tabIndex={-1} role="region" aria-label={`Detalle de ${selectedRow.loan.legacy_id ?? selectedRow.borrower}`} data-loan-detail={selectedRow.loan.id}>
          <div className="hero-band loan-hero">
            <div className="loan-hero-top">
              <button type="button" className="icon-button" onClick={() => selectLoan('')} aria-label="Cerrar detalle">‹</button>
              <span>{[selectedRow.loan.legacy_id, methodLabels[selectedRow.loan.method]].filter(Boolean).join(' · ')}</span>
              <StatusChip tone={selectedInfo.tone}>{selectedInfo.label}</StatusChip>
            </div>
            <div className="loan-hero-main">
              <ProgressRing value={selectedRow.settledByAccount ? 100 : ringPct} label={selectedRow.settledByAccount ? '$ 0' : `${selectedRow.paidInstallments}/${selectedRow.totalInstallments || selectedRow.loan.term_months}`} sub={selectedRow.settledByAccount ? 'saldo' : 'cuotas'} />
              <div className="loan-hero-copy">
                <h3>{selectedRow.borrower}</h3>
                <span>Saldo pendiente</span>
                <strong>{formatCop(selectedRow.pendingPrincipal)}</strong>
              </div>
            </div>
            <div className="hero-chips">
              <span>{new Decimal(selectedRow.loan.rate_value).mul(100).toDecimalPlaces(2).toString().replace('.', ',')}% {selectedRow.loan.rate_unit === 'EA' ? 'EA' : 'mensual'}</span>
              {next ? <span>Paga el día {Number(next.due_date.slice(8, 10))}</span> : null}
              {referrer ? <span>Refirió {referrer}</span> : null}
              {selectedRow.loan.legacy_note ? <span>{selectedRow.loan.legacy_note}</span> : null}
            </div>
          </div>

          {selectedRow.loan.status === 'active' ? (
            <div className="next-payment">
              <span className="next-label">{next ? `Próximo pago · cuota ${next.installment_number} · ${formatDayMonth(next.due_date)}` : 'Registrar un pago'}</span>
              {next ? (
                <div className="next-amount">
                  <strong>{formatCop(scheduleRemaining(next).total)}</strong>
                  <span>Capital {formatCop(scheduleRemaining(next).capital)}<br />Interés {formatCop(scheduleRemaining(next).interest)}</span>
                </div>
              ) : null}
              <div className="next-actions">
                <Button type="button" disabled={pending || historicalCut} aria-describedby={historicalCut ? 'loan-history-payment-help' : undefined} onClick={() => openPayment(next ? 'cuota' : 'other')}>Registrar pago</Button>
                <button type="button" className="link-button" disabled={pending || historicalCut} aria-describedby={historicalCut ? 'loan-history-payment-help' : undefined} onClick={() => openPayment('total')}>Pagar todo</button>
              </div>
              {historicalCut ? <p id="loan-history-payment-help" className="field-hint">{historicalMessage}</p> : null}
            </div>
          ) : null}
          {selectedRow.loan.status === 'draft' ? (
            <div className="next-payment">
              <span className="next-label">Falta desembolsar</span>
              <p className="muted">Al desembolsar salen {formatCop(selectedRow.loan.principal)} de caja. Confirmarás la fecha antes de guardar.</p>
              {historicalCut ? <p className="field-hint">{historicalMessage}</p> : null}
              <Button type="button" onClick={() => openDisburse(selectedRow.loan)} disabled={pending || historicalCut}>Desembolsar</Button>
            </div>
          ) : null}

          <dl className="detail-grid">
            <div><dt>Principal</dt><dd>{formatCop(selectedRow.loan.principal)}</dd></div>
            <div><dt>Capital pendiente</dt><dd>{formatCop(selectedRow.pendingPrincipal)}</dd></div>
            <div><dt>{selectedRow.settledByAccount ? 'Capital pagado o compensado' : 'Capital abonado'}</dt><dd>{formatCop(selectedRow.paidCapital)}</dd></div>
            <div><dt>{selectedRow.settledByAccount ? 'Interés pagado o compensado' : 'Interés pagado'}</dt><dd>{formatCop(selectedRow.paidInterest)}</dd></div>
            {selectedRow.settledByAccount ? <div><dt>Compensado en cuenta final</dt><dd>{formatCop(selectedRow.settledCapital,2)} capital · {formatCop(selectedRow.settledInterest,2)} interés. Sin nuevo cobro de dinero.</dd></div> : null}
            <div><dt>Plazo</dt><dd>{selectedRow.loan.term_months} {selectedRow.loan.term_months === 1 ? 'mes' : 'meses'}</dd></div>
            <div><dt>Inicio</dt><dd>{formatShortDate(selectedRow.loan.start_date)}</dd></div>
            {selectedRow.loan.legacy_payment_state !== 'none' ? (
              <div><dt>Pagado al corte inicial</dt><dd>{formatCop(selectedRow.loan.legacy_paid_capital_amount)} capital · {formatCop(selectedRow.loan.legacy_paid_interest_amount)} interés</dd></div>
            ) : null}
          </dl>

          {selectedRow.schedules.length ? (
            <div className="schedule-card">
              <div className="card-head">
                <h4>Cronograma</h4>
                <span className="muted">{openSchedules.length} {openSchedules.length === 1 ? 'pendiente' : 'pendientes'}</span>
              </div>
              {paidSchedules.length ? (
                <button type="button" className="schedule-summary" onClick={() => setShowPaidInstallments((value) => !value)}>
                  <span className="schedule-check is-paid" aria-hidden="true">✓</span>
                  <span>{paidSchedules.length} cuotas pagadas</span>
                  <span className="muted">{showPaidInstallments ? 'Ocultar' : 'Ver'}</span>
                </button>
              ) : null}
              <ol className="schedule-list">
                {(showPaidInstallments ? selectedRow.schedules : [...openSchedules,...closedSchedules]).map((schedule) => {
                  const origin = scheduleOrigin(schedule);
                  const paid = origin !== 'open';
                  const isNext = next?.id === schedule.id;
                  return (
                    <li key={schedule.id} className={paid ? 'is-paid' : isNext ? 'is-next' : undefined}>
                      <span className={`schedule-check${paid ? ' is-paid' : ''}${isNext ? ' is-next' : ''}`} aria-hidden="true">{paid ? '✓' : ''}</span>
                      <span className="row-main">
                        <strong>Cuota {schedule.installment_number} · {formatDayMonth(schedule.due_date)}</strong>
                        <span className="row-sub">{schedule.closed_by_settlement ? 'Extinguida por cuenta final · no se cobran intereses futuros' : paid ? <>Pagada · Cap. {formatCop(schedule.principal_due)} · Int. {formatCop(schedule.interest_due)}</> : <>Capital pendiente {formatCop(scheduleRemaining(schedule).capital)} · Interés pendiente {formatCop(scheduleRemaining(schedule).interest)}{scheduleRemaining(schedule).total.lt(scheduleTotal(schedule)) ? <><br />Programado originalmente {formatCop(scheduleTotal(schedule))} · Capital aplicado {formatCop(schedule.principal_paid ?? 0)}</> : null}</>}</span>
                      </span>
                      <span className="row-amount">{schedule.closed_by_settlement ? 'Cerrada' : formatCop(paid ? scheduleTotal(schedule) : scheduleRemaining(schedule).total)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}


          <div className="schedule-card">
            <div className="card-head"><h4>Pagos registrados</h4></div>
            {selectedRow.allPayments.length ? (
              <ol className="history-list">
                {selectedRow.allPayments.map((payment) => (
                  <li key={payment.id} data-loan-payment-row={payment.id}>
                    <div>
                      <span className="history-name">{formatShortDate(payment.payment_date)} · {payment.kind === 'prepayment' ? 'Pago total' : 'Pago'}{payment.status === 'reversed' ? ' · Revertido' : ''}</span>
                      <span className="history-meta">Capital {formatCop(payment.capital_amount)} · Interés {formatCop(payment.interest_amount)}</span>
                      {payment.note ? <span className="history-meta">Nota: {payment.note}</span> : null}
                    </div>
                    <span className="history-amount">{formatCop(payment.amount)}</span>
                    {payment.status!=='reversed'&&!historicalCut?<UndoOperationButton operationId={payment.operation_id}/>:null}
                  </li>
                ))}
              </ol>
            ) : <p className="muted">{selectedRow.settledByAccount ? 'Deuda cancelada mediante compensación en la cuenta final.' : selectedRow.paidInstallments?'Las cuotas pagadas están incluidas en el cronograma.':'Este préstamo todavía no tiene pagos registrados.'}</p>}
          </div>
        </div>
      ) : null}

      <div className="loans-toolbar">
        <div className="filter-chips" role="group" aria-label="Filtrar préstamos">
          {filterOptions.map((option) => (
            <button key={option.id} type="button" className="filter-chip" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
              {option.label}<span className="filter-count">{described.filter((entry) => filterMatches(entry, option.id)).length}</span>
            </button>
          ))}
        </div>
        <label className="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <span className="sr-only">Buscar contrato</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por socio, código…" />
        </label>
      </div>

      <div className="loan-grid">
        {visibleLoans.map(({ row, info }, index) => {
          const nextRow = row.nextSchedule;
          const cuota = row.settledByAccount ? null : nextRow ? scheduleRemaining(nextRow).total : row.loan.scheduled_payment ? new Decimal(row.loan.scheduled_payment) : null;
          const progress = row.settledByAccount ? 100 : row.totalInstallments ? Math.round((row.paidInstallments / row.totalInstallments) * 100) : row.loan.status === 'paid' ? 100 : 0;
          return (
            <article key={row.loan.id} className={`loan-card${row.loan.id === selectedLoanId ? ' is-selected' : ''}`} data-loan-row={row.loan.id} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              <div className="loan-card-head">
                <Avatar name={row.borrower} />
                <div className="loan-card-title">
                  <strong>{row.borrower}</strong>
                  <span>{[row.loan.legacy_id, row.loan.legacy_note || methodLabels[row.loan.method]].filter(Boolean).join(' · ')}</span>
                  <span className={`loan-card-detail tone-${info.tone}`}>{info.detail}</span>
                </div>
                <div className="loan-card-end">
                  <span className="loan-card-amount">{cuota ? formatCop(cuota) : formatCop(row.pendingPrincipal)}</span>
                  <StatusChip tone={info.tone}>{info.label}</StatusChip>
                </div>
              </div>
              <dl className="loan-card-figures">
                <div><dt>Saldo</dt><dd>{formatCop(row.pendingPrincipal)}</dd></div>
                <div><dt>Cuota</dt><dd>{cuota ? formatCop(cuota) : '—'}</dd></div>
                <div><dt>Cuotas</dt><dd>{row.settledByAccount ? 'Cerradas' : `${row.paidInstallments}/${row.totalInstallments || row.loan.term_months}`}</dd></div>
              </dl>
              <ProgressBar value={progress} decorative />
              <div className="loan-card-foot">
                <span>{info.detail}</span>
                {row.loan.status === 'draft' ? <Button type="button" className="loan-card-action" onClick={() => openDisburse(row.loan)} disabled={pending || historicalCut}>Desembolsar</Button> : null}
                <button type="button" className="loan-card-open" aria-description={`${row.borrower} · ${row.loan.legacy_id ?? 'Préstamo'}`} onClick={(event) => selectLoan(row.loan.id, event.currentTarget)}>Ver detalle</button>
              </div>
            </article>
          );
        })}
      </div>
      {visibleLoans.length === 0 ? <p className="muted card-empty">No hay contratos que coincidan con el filtro.</p> : null}

      {newLoanOpen ? (
        <Sheet title="Nuevo préstamo" onClose={() => setNewLoanOpen(false)}>
          <form onSubmit={submitLoan} className="sheet-form">
            {loanError ? <InlineNotice tone="danger">{loanError}</InlineNotice> : null}
            <label>
              Socio deudor
              <select value={borrowerMemberId} onChange={(event) => setBorrowerMemberId(event.target.value)} disabled={pending}>
                <option value="">Deudor externo</option>
                {cycleMembers.map((item) => <option key={item.id} value={item.member_id}>{item.member?.display_name}</option>)}
              </select>
            </label>
            {!borrowerMemberId ? <label>Deudor externo<input value={externalName} onChange={(event) => setExternalName(event.target.value)} disabled={pending} placeholder="Nombre completo" /></label> : null}
            <label>
              Principal
              <CopInput className="input-amount" value={principal} onChange={(event) => setPrincipal(event.target.value)} inputMode="decimal" disabled={pending} placeholder="1.000.000" />
            </label>
            <div className="form-pair">
              <label>
                Método
                <select value={method} onChange={(event) => setMethod(event.target.value)} disabled={pending}>
                  <option value="amortized">Amortizado</option>
                  <option value="fixed_interest">Interés fijo</option>
                  <option value="interest_only">Solo interés</option>
                </select>
              </label>
              <label>
                Base tasa
                <select value={rateUnit} onChange={(event) => setRateUnit(event.target.value)} disabled={pending}>
                  <option value="MONTHLY_FIXED">Mensual fija</option>
                  <option value="EA">Efectiva anual</option>
                </select>
              </label>
            </div>
            <div className="form-pair">
              <label>Tasa %<input value={rateValue} onChange={(event) => setRateValue(event.target.value)} inputMode="decimal" disabled={pending} placeholder="2,25" /></label>
              <label>Plazo meses<input type="number" min="1" value={termMonths} onChange={(event) => setTermMonths(Number(event.target.value))} disabled={pending} /></label>
            </div>
            <div className="form-pair">
              <label>Fecha desembolso<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={pending} /></label>
              <label>
                Referido por
                <select value={referredByMemberId} onChange={(event) => setReferredByMemberId(event.target.value)} disabled={pending}>
                  <option value="">Sin referido</option>
                  {cycleMembers.map((item) => <option key={item.id} value={item.member_id}>{item.member?.display_name}</option>)}
                </select>
              </label>
            </div>
            <small className="field-hint">El préstamo queda como borrador. El dinero sale de caja cuando lo desembolsas.</small>
            <Button type="submit" disabled={pending}>{pending ? 'Guardando...' : 'Crear contrato'}</Button>
          </form>
        </Sheet>
      ) : null}

      {disburseTarget ? (
        <Sheet title="Desembolsar préstamo" onClose={() => setDisburseTarget(null)}>
          <div className="sheet-form">
            {(() => {
              const target = loanRows.find((row) => row.loan.id === disburseTarget.loanId);
              return target ? <p className="sheet-sub">{target.borrower} · salen {formatCop(target.loan.principal)} de caja</p> : null;
            })()}
            {loanError ? <InlineNotice tone="danger">{loanError}</InlineNotice> : null}
            <label>Fecha del desembolso<input type="date" value={disburseTarget.date} onChange={(event) => setDisburseTarget({ ...disburseTarget, date: event.target.value })} disabled={pending} required /></label>
            <small className="field-hint">Es el día en que el dinero salió de verdad. Desde ahí corre el cronograma.</small>
            <Button type="button" disabled={pending || !disburseTarget.date} onClick={() => void disburseLoan(disburseTarget.loanId, disburseTarget.date)}>{pending ? 'Guardando...' : 'Confirmar desembolso'}</Button>
          </div>
        </Sheet>
      ) : null}

      {paymentOpen && selectedRow ? (
        <Sheet title="Registrar Pago" variant="page" closeDisabled={pending} onClose={() => { setPaymentOpen(false); setPrepaymentQuote(null); }}>
          <div className="sheet-form pay-page">
            <fieldset disabled={pending || !!readPendingFinancialOperation(`loan:payment:${cycle.id}:${selectedLoanId}`) || !!readPendingFinancialOperation(`loan:prepayment:${cycle.id}:${selectedLoanId}`)}><legend>Dónde recibiste el dinero</legend><LocationPicker label="Destino del cobro" value={receiptTo} onChange={setReceiptTo} bankAccounts={bankAccounts} disabled={pending} /></fieldset>
            <div className="pay-identity">
              <Avatar name={selectedRow.borrower} />
              <span className="row-main">
                <strong>{selectedRow.borrower}</strong>
                <span className="row-sub">{[selectedRow.loan.legacy_id, selectedRow.loan.legacy_note || methodLabels[selectedRow.loan.method]].filter(Boolean).join(' · ')}{next ? ` · cuota ${next.installment_number} de ${selectedRow.totalInstallments}` : ''}</span>
              </span>
            </div>
            {loanError ? <InlineNotice tone="danger">{loanError}</InlineNotice> : null}

            <section className="pay-info" aria-labelledby="pay-info-title">
              <h3 id="pay-info-title">Información del préstamo</h3>
              <dl>
                <div><dt>Monto total</dt><dd>{formatCop(selectedRow.loan.principal)}</dd></div>
                <div><dt>Cuotas totales</dt><dd>{selectedRow.totalInstallments || selectedRow.loan.term_months}</dd></div>
                <div><dt>Cuotas pagadas</dt><dd>{selectedRow.paidInstallments}</dd></div>
                <div><dt>Cuotas pendientes</dt><dd>{openSchedules.length}</dd></div>
                <div><dt>Próxima cuota pendiente</dt><dd>{next ? formatCop(scheduleRemaining(next).total) : '—'}</dd></div>
                <div><dt>Saldo de capital</dt><dd>{formatCop(selectedRow.pendingPrincipal)}</dd></div>
              </dl>
              <small>El saldo es de capital: no incluye intereses por causar.</small>
            </section>

            {payMode === 'total' ? (
              <div className="pay-section">
                <span className="pay-section-title" id="pay-type-title">Tipo de pago</span>
                {payTypeChips}
              </div>
            ) : null}

            <label>Nota del pago (opcional)
              <input aria-label="Nota del pago" value={paymentNote} onChange={event => setPaymentNote(event.target.value)} maxLength={500} disabled={pending || !!readPendingFinancialOperation(`loan:payment:${cycle.id}:${selectedLoanId}`) || !!readPendingFinancialOperation(`loan:prepayment:${cycle.id}:${selectedLoanId}`)} aria-describedby="pay-note-help" placeholder="Ej.: abono extraordinario al capital" />
              <small id="pay-note-help" className="field-hint">Hasta 500 caracteres. Se conserva con el cobro y no se puede editar después de confirmar.</small>
            </label>

            {payMode === 'total' ? (
              <div className="quote-box" role="status">
                {prepaymentQuote ? (
                  <>
                    <strong className="quote-total">{formatCop(prepaymentQuote.total_due, 2)}</strong>
                    <span>Para cancelar en la fecha elegida: capital {formatCop(prepaymentQuote.principal_due, 2)} + interés {formatCop(prepaymentQuote.interest_due, 2)}</span>
                    {prepaymentQuote.interest_covered_until ? <small>Intereses cubiertos hasta el {formatShortDate(prepaymentQuote.interest_covered_until)}. El cálculo incluye los días pendientes.</small> : null}
                  </>
                ) : <span>{pending ? 'Calculando...' : 'Elige la fecha y calcula cuánto debe para cancelar.'}</span>}
                <label>Fecha del pago<input type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); setPrepaymentQuote(null); }} disabled={pending} /></label>
                {!prepaymentQuote ? <Button type="button" variant="quiet" onClick={() => void quotePrepayment()} disabled={pending}>Calcular</Button> : null}
                <Button type="button" className="pay-cta" disabled={pending || !prepaymentQuote || (receiptTo.location === 'bank' && !receiptTo.bankAccountId)} onClick={() => void submitQuotedPrepayment()}>Confirmar pago total</Button>
              </div>
            ) : (
              <form onSubmit={submitPayment} className="sheet-form pay-form">
                <div className="pay-section">
                  <span className="pay-section-title" aria-hidden="true">Monto del pago</span>
                  <label className="pay-amount">
                    <span className="sr-only">Pago</span>
                    <span className="pay-prefix" aria-hidden="true">$</span>
                    <CopInput aria-label="Pago" className="input-amount" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); setPayMode('other'); setPrepaymentQuote(null); }} inputMode="decimal" disabled={pending} placeholder="0" />
                  </label>
                  {payTypeChips}
                </div>
                <div className="pay-section">
                  <span className="pay-section-title">Fecha de pago</span>
                  <label>
                    <span className="sr-only">Fecha del pago</span>
                    <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} disabled={pending} />
                  </label>
                </div>
                <div className="form-pair">
                  <label>Capital<CopInput value={capitalAmount} onChange={(event) => { setCapitalAmount(event.target.value); setPayMode('other'); }} inputMode="decimal" disabled={pending} readOnly={automaticApplication} /></label>
                  <label>Interés<CopInput value={interestAmount} onChange={(event) => { setInterestAmount(event.target.value); setPayMode('other'); }} inputMode="decimal" disabled={pending} readOnly={automaticApplication} /></label>
                </div>
                {automaticApplication ? <small className="field-hint">Primero intereses exigibles y después capital, desde la cuota más antigua. Un pago parcial mantiene abierta la cuota.</small> : null}
                {payMode === 'other' && paymentSummary?.capital.gt(0) && paymentSummary.interest.isZero() ? <small className="field-hint">Abono al capital: no cubre una cuota de intereses.</small> : null}
                <p className={paymentSummary && !paymentSummary.matches ? 'pay-summary is-warning' : 'pay-summary'} aria-live="polite">
                  {paymentSummary
                    ? paymentSummary.matches
                      ? `Capital ${formatCop(paymentSummary.capital)} + interés ${formatCop(paymentSummary.interest)} = ${formatCop(paymentSummary.total)}`
                      : 'Capital más interés no suman el pago. Revisa el desglose.'
                    : 'Escribe el pago, el capital y el interés.'}
                </p>
                <div className="pay-cta-bar">
                  <Button type="submit" className="pay-cta" disabled={pending || !paymentSummary || !paymentSummary.matches || (receiptTo.location === 'bank' && !receiptTo.bankAccountId) || (automaticApplication && paymentPlanKey !== applicationKey)}>{pending ? 'Guardando...' : 'Registrar Pago'}</Button>
                </div>
              </form>
            )}
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

type PollaSheet = 'new' | 'contribution' | 'prize' | null;

// Aporte fijo de polla por participante y actividad (regla confirmada por el administrador).
const POLLA_QUOTA = new Decimal(10000);


function isPrizeUnverified(prize: PollaPrize) {
  return Boolean(prize.legacy_id) && prize.legacy_payment_status === 'historical_payment_unverified';
}

export function PollaPanel({
  cycle,
  cycleMembers,
  activities,
  contributions,
  prizes,
  ledgerEntries,
  bankAccounts = [],
  onSaved,
  onError
}: {
  bankAccounts?: BankAccount[];
  cycle: Cycle;
  cycleMembers: CycleMember[];
  activities: PollaActivity[];
  contributions: PollaContribution[];
  prizes: PollaPrize[];
  ledgerEntries: LedgerEntry[];
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const currentMonth = civilToday().month;
  const visibleActivities=activities.filter(item=>!item.cancelled_at);
  const activityMonths = Array.from(new Set(visibleActivities.map((activity) => activity.period_month))).sort((left, right) => left - right);
  const [selectedMonth, setSelectedMonth] = useState(() =>
    activityMonths.length === 0 || activityMonths.includes(currentMonth) ? currentMonth : activityMonths[activityMonths.length - 1]
  );
  const [selectedActivityId, setSelectedActivityId] = useState('');
  const [sheet, setSheet] = useState<PollaSheet>(null);
  const [activityName, setActivityName] = useState('');
  const [activityMonth, setActivityMonth] = useState(currentMonth);
  const [activityId, setActivityId] = useState('');
  const [cycleMemberId, setCycleMemberId] = useState('');
  const [winnerId, setWinnerId] = useState('');
  const [pollaAmount, setPollaAmount] = useState('');
  const [pollaPaidDate, setPollaPaidDate] = useState(todayCivilDate());
  const [prizeGross, setPrizeGross] = useState('');
  const [prizeAwardedAt, setPrizeAwardedAt] = useState(todayCivilDate());
  const [prizePaidDate, setPrizePaidDate] = useState(todayCivilDate());
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const [deliverPrize, setDeliverPrize] = useState<PollaPrize | null>(null);
  const [deliverFrom, setDeliverFrom] = useState<MoneySheetLocation>({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: bankAccounts[0]?.id ?? '' });
  const [deliverDate, setDeliverDate] = useState(todayCivilDate());

  const chipMonths = Array.from(new Set([...activityMonths, selectedMonth])).sort((left, right) => left - right);
  const monthActivities = visibleActivities.filter((activity) => activity.period_month === selectedMonth);
  const activity = monthActivities.find((item) => item.id === selectedActivityId) ?? monthActivities[0];
  const membersById = new Map(cycleMembers.map((item) => [item.id, item]));
  const activitiesById = new Map(activities.map((item) => [item.id, item]));
  const activityContributions = activity ? contributions.filter((item) => item.activity_id === activity.id && item.status === 'posted') : [];
  const collected = activityContributions.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const hasCollectiveReceipts=activityContributions.some(item=>item.legacy_collective);
  const paidByMember = new Map<string, Decimal>();
  for (const item of activityContributions) {
    if (item.cycle_member_id) {
      paidByMember.set(item.cycle_member_id, (paidByMember.get(item.cycle_member_id) ?? new Decimal(0)).plus(item.amount));
    }
  }
  // Participan: marcados para polla, o quienes ya pagaron polla en el ciclo aunque se hayan retirado.
  // FIN-05: derechos por actividad. Activos marcados para polla, más quien ya pagó ESTA actividad (incluye retirados con meses prepagados).
  const roster = cycleMembers.filter((item) => (item.participates_in_polla && item.savings_status === 'active') || paidByMember.has(item.id));
  const contributionMembers = cycle.settlement_rules_version === 'fin03-2026'
    ? cycleMembers.filter((item) => item.economic_mode !== 'fixed_yield')
    : cycleMembers;
  const paidCount = roster.filter((item) => (paidByMember.get(item.id) ?? new Decimal(0)).gte(POLLA_QUOTA)).length;
  const pct = roster.length ? Math.round((paidCount / roster.length) * 100) : 0;
  const pollaPool = new Decimal(0).minus(ledgerEntries.filter((entry) => entry.account === 'polla_pool').reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0)));
  const pendingPrizes = prizes.filter((prize) => prize.status === 'pending_payment'&&!isPrizeUnverified(prize));
  const cutPrizes=prizes.filter(prize=>prize.status==='pending_payment'&&isPrizeUnverified(prize));
  const paidPrizes = prizes.filter((prize) => prize.status === 'paid' || prize.status === 'settled');

  function openContribution(memberId = '') {
    setFormError('');
    setActivityId(activity?.id ?? '');
    setCycleMemberId(memberId);
    setPollaAmount(formatCopInput(POLLA_QUOTA));
    setSheet('contribution');
  }

  function openPrize() {
    setFormError('');
    setActivityId(activity?.id ?? '');
    setWinnerId('');
    setPrizeGross('');
    setSheet('prize');
  }

  async function submitActivity(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    try {
      await createPollaActivity({ cycleId: cycle.id, year: cycle.year, month: activityMonth, name: activityName });
      setSelectedMonth(activityMonth);
      setSelectedActivityId('');
      setActivityName('');
      setSheet(null);
      await onSaved();
    } catch (error) {
      setFormError(userSafeError(error));
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function submitContribution(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    let amount: string;
    try {
      amount = toDatabaseMoney(parseCop(pollaAmount, 'aporte polla'));
    } catch (error) {
      setFormError(userSafeError(error));
      return;
    }
    const payload = { activityId, cycleMemberId, amount, paidDate: pollaPaidDate };
    await runPendingFinancialAction({
      scope: `polla:contribution:${cycle.id}:${activityId}:${cycleMemberId}`,
      payload,
      setPending,
      onSaved: async () => {
        setSheet(null);
        await onSaved();
      },
      onError: (error) => {
        setFormError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => registerPollaContribution({ activityId, cycleMemberId, amount, paidDate: pollaPaidDate, idempotencyKey })
    });
  }

  async function submitPrize(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    let grossAmount: string;
    try {
      grossAmount = toDatabaseMoney(parseCop(prizeGross, 'premio bruto'));
    } catch (error) {
      setFormError(userSafeError(error));
      return;
    }
    const payload = { activityId, winnerCycleMemberId: winnerId, grossAmount, awardedAt: prizeAwardedAt };
    await runPendingFinancialAction({
      scope: `polla:prize:${cycle.id}:${activityId}:${winnerId}`,
      payload,
      setPending,
      onSaved: async () => {
        setSheet(null);
        await onSaved();
      },
      onError: (error) => {
        setFormError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => awardPollaPrizeToCapital({ activityId, winnerCycleMemberId: winnerId, grossAmount, awardedAt: prizeAwardedAt, idempotencyKey })
    });
  }


  async function creditPrize(prize: PollaPrize) {
    const creditedDate = prize.awarded_at && prize.awarded_at > prizePaidDate ? prize.awarded_at : prizePaidDate;
    await runPendingFinancialAction({
      scope: `polla:credit-prize:${cycle.id}:${prize.id}`,
      payload: { prizeId: prize.id, creditedDate },
      setPending,
      onSaved,
      onError,
      action: (idempotencyKey) => creditPollaPrizeToCapital(prize.id, creditedDate, idempotencyKey)
    });
  }

  function renderPrize(prize: PollaPrize) {
    const winner = membersById.get(prize.winner_cycle_member_id)?.member?.display_name ?? 'Ganador';
    const prizeActivity = activitiesById.get(prize.activity_id);
    return (
      <li key={prize.id} className="prize-row" data-prize-row={prize.id}>
        <Avatar name={winner} />
        <div className="row-main">
          <strong>{winner}</strong>
          <span className="row-sub">{prizeActivity ? `${pollaDisplayName(prizeActivity.name, prizeActivity.period_month)} · ${months[prizeActivity.period_month - 1]}` : 'Polla'} · bruto {formatCop(prize.gross_amount)} · comisión {formatCop(prize.admin_commission)}</span>
        </div>
        {prize.status !== 'pending_payment'
          ? <StatusChip tone={prize.status === 'paid' ? 'paid' : 'ok'}>{prize.status === 'paid' ? 'Pagado' : prize.status === 'reversed' ? 'Revertido' : `Acreditado ${formatCop(prize.net_amount)}`}</StatusChip>
          : isPrizeUnverified(prize)
            ? <StatusChip tone="ok">Registrado al corte</StatusChip>
            : membersById.get(prize.winner_cycle_member_id)?.savings_status !== 'active'
              ? <Button type="button" onClick={() => { setFormError(''); setDeliverDate(todayCivilDate()); setDeliverPrize(prize); }} disabled={pending}>Entregar {formatCop(prize.net_amount)}</Button>
              : <Button type="button" onClick={() => void creditPrize(prize)} disabled={pending}>Acreditar {formatCop(prize.net_amount)} al capital</Button>}
        {prize.status!=='reversed'?<UndoPollaButton target={{kind:'prize',id:prize.id,label:`${winner} · ${formatCop(prize.net_amount)}`,date:prize.awarded_at??undefined}}/>:null}
      </li>
    );
  }

  return (
    <section className="polla-page" aria-labelledby="polla-titulo">
      <div className="hero-band hero-band-indigo">
        <div className="hero-band-top">
          <div>
            <p className="hero-eyebrow">Bolsa total {formatCop(pollaPool)}</p>
            <h2 id="polla-titulo">Polla</h2>
          </div>
          <button type="button" className="hero-button" onClick={() => { setFormError(''); setActivityMonth(selectedMonth); setSheet('new'); }}>Nueva polla</button>
        </div>
        <div className="month-chips" role="group" aria-label="Mes de la polla">
          {chipMonths.map((month) => (
            <button key={month} type="button" className="month-chip" aria-pressed={month === selectedMonth} onClick={() => { setSelectedMonth(month); setSelectedActivityId(''); }}>{months[month - 1]}</button>
          ))}
        </div>
        {monthActivities.length ? (
          <div className="segmented segmented-dark" role="group" aria-label="Polla del mes">
            {monthActivities.map((item) => (
              <button key={item.id} type="button" aria-pressed={item.id === activity?.id} onClick={() => setSelectedActivityId(item.id)}>{pollaDisplayName(item.name, item.period_month)}</button>
            ))}
          </div>
        ) : null}
        {activity ? (
          <>
            <div className="hero-figure-row">
              <div className="hero-figure"><span>Recaudado</span><strong>{formatCop(collected)}</strong></div>
              <span className="hero-pill">{hasCollectiveReceipts?'Recaudo registrado':`${paidCount} de ${roster.length} aportaron`}</span>
            </div>
            {!hasCollectiveReceipts?<div className="progress progress-on-dark"><span style={{ width: `${pct}%` }} /></div>:null}
          </>
        ) : <p className="hero-empty">Aún no hay pollas en {months[selectedMonth - 1].toLowerCase()}. Usa "Nueva polla" para crearla.</p>}
      </div>

      {activity ? (
        <div className="polla-block">
          <div className="section-head">
            <h3>{hasCollectiveReceipts?'Recaudo de la polla':'Participantes'}</h3>
            <div className="section-head-actions">
              <button type="button" className="link-button" onClick={() => openContribution()}>Registrar aporte</button>
              <button type="button" className="link-button" onClick={openPrize}>Asignar ganador</button>
              <UndoPollaButton target={{kind:'activity',id:activity.id,label:pollaDisplayName(activity.name,activity.period_month)}}/>
            </div>
          </div>
          {!hasCollectiveReceipts&&roster.length === 0 ? (
            <InlineNotice tone="warning">Ningún socio está marcado para participar en la polla. Márcalo en Ahorros → Editar socio → "Participa en polla".</InlineNotice>
          ) : null}
          {!hasCollectiveReceipts?<div className="people-grid">
            {roster.map((item) => {
              const paid = paidByMember.get(item.id);
              const complete = Boolean(paid && paid.gte(POLLA_QUOTA));
              const name = item.member?.display_name ?? 'Socio';
              const retired = item.savings_status !== 'active';
              return (
                <button key={item.id} type="button" className={`person-chip${complete ? ' is-paid' : paid ? ' is-partial' : ''}`} aria-pressed={complete} onClick={complete ? undefined : () => openContribution(item.id)}>
                  <span className="person-mark" aria-hidden="true">{complete ? '✓' : initials(name)}</span>
                  <span className="person-name">{name}{retired ? ' · retirado' : ''}</span>
                  {paid ? <span className="person-amount">{complete ? formatCop(paid) : `${formatCop(paid)} de ${formatCop(POLLA_QUOTA)}`}</span> : null}
                </button>
              );
            })}
          </div>:<p className="muted">Aportes registrados: {formatCop(collected)}.</p>}
          {activityContributions.length?<details className="polla-contribution-history" open={hasCollectiveReceipts||undefined}><summary>Aportes registrados ({activityContributions.length})</summary><ol className="history-list">{activityContributions.map(item=><li key={item.id}><span className="row-main"><strong>{membersById.get(item.cycle_member_id??'')?.member?.display_name??'Recaudo de la polla'}</strong><span>{formatShortDate(item.paid_date)} · {formatCop(item.amount)}</span></span><UndoOperationButton operationId={item.operation_id}/></li>)}</ol></details>:null}
        </div>
      ) : null}

      <div className="polla-block">
        <div className="section-head">
          <h3>Premios por acreditar</h3>
          <label className="inline-date">Fecha del abono<input type="date" value={prizePaidDate} onChange={(event) => setPrizePaidDate(event.target.value)} disabled={pending} /></label>
        </div>
        {pendingPrizes.length ? (
          <>
            {pendingPrizes.some((prize) => prize.activity_id === activity?.id) ? <ol className="prize-list">{pendingPrizes.filter((prize) => prize.activity_id === activity?.id).map(renderPrize)}</ol> : null}
            {pendingPrizes.some((prize) => prize.activity_id !== activity?.id) ? (
              <>
                <h4 className="group-title">De otros meses</h4>
                <ol className="prize-list">{pendingPrizes.filter((prize) => prize.activity_id !== activity?.id).map(renderPrize)}</ol>
              </>
            ) : null}
          </>
        ) : <p className="muted card-empty">No hay premios pendientes. Al asignar un ganador, el premio neto se suma a su capital.</p>}
      </div>
      {paidPrizes.length ? (
        <div className="polla-block">
          <div className="section-head"><h3>Premios acreditados</h3></div>
          <ol className="prize-list">{paidPrizes.map(renderPrize)}</ol>
        </div>
      ) : null}

      {deliverPrize ? (
        <Sheet title="Entregar premio" onClose={() => setDeliverPrize(null)}>
          <div className="sheet-form">
            <p className="sheet-sub">{membersById.get(deliverPrize.winner_cycle_member_id)?.member?.display_name ?? 'Ganador'} ya liquidó su ahorro: el premio neto se le entrega en dinero.</p>
            <div className="total-row"><span>A entregar</span><strong>{formatCop(deliverPrize.net_amount)}</strong></div>
            {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
            <LocationPicker value={deliverFrom} onChange={setDeliverFrom} bankAccounts={bankAccounts} disabled={pending} />
            <label>Fecha de entrega<input type="date" value={deliverDate} min={deliverPrize.awarded_at ?? undefined} onChange={(event) => setDeliverDate(event.target.value)} disabled={pending} /></label>
            <Button type="button" disabled={pending || (deliverFrom.location === 'bank' && !deliverFrom.bankAccountId)} onClick={() => {
              const target = deliverPrize;
              void runPendingFinancialAction({
                scope: `polla:deliver:${target.id}`,
                payload: { prizeId: target.id, deliverDate, location: deliverFrom.location, bank: deliverFrom.bankAccountId },
                setPending,
                onSaved: async () => { setDeliverPrize(null); await onSaved(); },
                onError: (error) => { setFormError(userSafeError(error)); onError(error); },
                action: (idempotencyKey) => payPollaPrize(target.id, deliverDate, idempotencyKey, deliverFrom.location, deliverFrom.location === 'bank' ? deliverFrom.bankAccountId : null)
              });
            }}>{pending ? 'Guardando...' : 'Registrar entrega'}</Button>
          </div>
        </Sheet>
      ) : null}

      {cutPrizes.length?<div className="polla-block"><h3>Premios registrados al corte</h3><ol className="prize-list">{cutPrizes.map(renderPrize)}</ol></div>:null}

      {sheet === 'new' ? (
        <Sheet title="Nueva polla" onClose={() => setSheet(null)}>
          <form onSubmit={submitActivity} className="sheet-form">
            {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
            <label><span>Nombre actividad</span><input value={activityName} onChange={(event) => setActivityName(event.target.value)} disabled={pending} placeholder="Premier League" required /></label>
            <MonthSelect label="Mes" value={activityMonth} onChange={setActivityMonth} disabled={pending} />
            <Button type="submit" disabled={pending}>{pending ? 'Creando...' : 'Crear actividad'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'contribution' ? (
        <Sheet title="Aporte de polla" onClose={() => setSheet(null)}>
          <form onSubmit={submitContribution} className="sheet-form">
            <p className="sheet-sub">{activity ? `${pollaDisplayName(activity.name, activity.period_month)} · ${months[activity.period_month - 1]}` : ''}</p>
            {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
            <label>
              Participante
              <select value={cycleMemberId} onChange={(event) => setCycleMemberId(event.target.value)} disabled={pending} required>
                <option value="">Seleccionar</option>
                {contributionMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
              </select>
            </label>
            <div className="form-pair">
              <label><span>Aporte polla</span><CopInput className="input-amount" value={pollaAmount} onChange={(event) => setPollaAmount(event.target.value)} inputMode="decimal" disabled={pending} placeholder="10.000" /></label>
              <label><span>Fecha aporte</span><input type="date" value={pollaPaidDate} onChange={(event) => setPollaPaidDate(event.target.value)} disabled={pending} /></label>
            </div>
            <Button type="submit" disabled={pending || !activityId || !cycleMemberId}>{pending ? 'Guardando...' : 'Guardar aporte'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'prize' ? (
        <Sheet title="Asignar ganador" onClose={() => setSheet(null)}>
          <form onSubmit={submitPrize} className="sheet-form">
            <p className="sheet-sub">{activity ? `${pollaDisplayName(activity.name, activity.period_month)} · recaudado ${formatCop(collected)}` : ''}</p>
            {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
            <label>
              Ganador
              <select value={winnerId} onChange={(event) => setWinnerId(event.target.value)} disabled={pending} required>
                <option value="">Seleccionar</option>
                {cycleMembers.map((item) => <option key={item.id} value={item.id}>{item.member?.display_name}</option>)}
              </select>
            </label>
            <div className="form-pair">
              <label><span>Premio bruto</span><CopInput className="input-amount" value={prizeGross} onChange={(event) => setPrizeGross(event.target.value)} inputMode="decimal" disabled={pending} /></label>
              <label><span>Fecha premio</span><input type="date" value={prizeAwardedAt} onChange={(event) => setPrizeAwardedAt(event.target.value)} disabled={pending} /></label>
            </div>
            <small className="field-hint">Se descuentan $5.000 de comisión para el administrador y el neto se suma al capital del ganador. No sale dinero de la cuenta.</small>
            <Button type="submit" disabled={pending || !activityId || !winnerId}>{pending ? 'Guardando...' : 'Asignar premio'}</Button>
          </form>
        </Sheet>
      ) : null}
    </section>
  );
}

type MoneySheetLocation = { location: LiquidityLocation; bankAccountId: string };

function LocationPicker({ value, onChange, bankAccounts, disabled, label = 'Dónde sale el dinero' }: { value: MoneySheetLocation; onChange: (value: MoneySheetLocation) => void; bankAccounts: BankAccount[]; disabled?: boolean; label?: string }) {
  return (
    <div className="sheet-form">
      <div className="segmented" role="group" aria-label={label}>
        <button type="button" aria-pressed={value.location === 'bank'} disabled={disabled || bankAccounts.length === 0} onClick={() => onChange({ location: 'bank', bankAccountId: value.bankAccountId || bankAccounts[0]?.id || '' })}>Banco</button>
        <button type="button" aria-pressed={value.location === 'cash'} disabled={disabled} onClick={() => onChange({ location: 'cash', bankAccountId: '' })}>Efectivo</button>
      </div>
      {value.location === 'bank' ? (
        <label>
          Cuenta
          <select value={value.bankAccountId} onChange={(event) => onChange({ location: 'bank', bankAccountId: event.target.value })} disabled={disabled}>
            <option value="">Seleccionar</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function HeroBack({ label = 'Más', onClick }: { label?: string; onClick?: () => void }) {
  return onClick ? <button type="button" className="hero-back" onClick={onClick}>‹ {label}</button> : null;
}

function StepList({ steps }: { steps: { label: string; detail: string; state: 'done' | 'current' | 'todo'; content?: React.ReactNode }[] }) {
  return (
    <ol className="step-list">
      {steps.map((step, index) => (
        <li key={step.label} className={`step step-${step.state}`}>
          <span className="step-dot" aria-hidden="true">{step.state === 'done' ? '✓' : index + 1}</span>
          <div className="step-body">
            <strong>{step.label}</strong>
            <span className="step-detail">{step.detail}</span>
            {step.content ? <div className="step-content">{step.content}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

type BankSheet = 'account' | 'opening' | 'financing' | 'interest' | 'fee' | 'transfer' | 'reconcile' | 'locate' | null;

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
  const { cutDate } = useFinancialCut();
  const [sheet, setSheet] = useState<BankSheet>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [maskedIdentifier, setMaskedIdentifier] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilDate());
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [interestWithholding, setInterestWithholding] = useState('0');
  const [interestFee, setInterestFee] = useState('0');
  const [externalBalance, setExternalBalance] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(cycle.starts_on);
  const [direction, setDirection] = useState<'bank-to-cash' | 'cash-to-bank'>('bank-to-cash');
  const [locateTo, setLocateTo] = useState<MoneySheetLocation>({ location: 'bank', bankAccountId: '' });
  const [sheetError, setSheetError] = useState('');
  const [pending, setPending] = useState(false);
  const selectedBank = bankAccountId || bankAccounts[0]?.id || '';
  const selectedAccount = bankAccounts.find((account) => account.id === selectedBank);

  const balancesAt = (cut: string) => {
    const position = reconstructMoney(operations, ledgerEntries, cut);
    return { byBank: position.banks, physicalCash: position.physicalCash, unknownCash: position.unknown };
  };
  const balances = useMemo(() => balancesAt(cutDate), [ledgerEntries, operations, cutDate]);
  const bankTotal = Array.from(balances.byBank.values()).reduce((sum, value) => sum.plus(value), new Decimal(0));
  const accountReconciliations = reconciliations
    .filter((item) => item.bank_account_id === selectedBank)
    .sort((left, right) => right.as_of_date.localeCompare(left.as_of_date));
  const lastReconciliation = accountReconciliations[0];
  const sheetBalance = selectedBank ? (balancesAt(effectiveDate).byBank.get(selectedBank) ?? new Decimal(0)) : new Decimal(0);
  const reconcileDiff = (() => {
    try {
      return externalBalance ? parseCop(externalBalance, 'saldo del extracto').minus(sheetBalance) : null;
    } catch {
      return null;
    }
  })();

  function open(next: BankSheet) {
    setSheetError('');
    setEffectiveDate(todayCivilDate());
    setAmount('');
    setReference('');
    setInterestWithholding('0');
    setInterestFee('0');
    setExternalBalance('');
    if (next === 'reconcile') {
      setOpeningBalance(lastReconciliation ? formatCopInput(new Decimal(lastReconciliation.opening_verified_balance)) : '');
      setOpeningDate(lastReconciliation?.opening_date ?? cycle.starts_on);
    }
    if (next === 'locate') {
      setAmount(formatCopInput(balances.unknownCash));
      setLocateTo({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: selectedBank });
    }
    setSheet(next);
  }

  const close = () => setSheet(null);
  const fail = (error: unknown) => {
    setSheetError(userSafeError(error));
    onError(error);
  };
  const money = (value: string, label: string) => toDatabaseMoney(parseCop(value || '0', label));

  async function runSimple(action: () => Promise<unknown>) {
    setSheetError('');
    setPending(true);
    try {
      await action();
      setSheet(null);
      await onSaved();
    } catch (error) {
      fail(error);
    } finally {
      setPending(false);
    }
  }

  async function runFinancial(actionName: string, buildPayload: () => Record<string, unknown>, action: (idempotencyKey: string, payload: Record<string, unknown>) => Promise<unknown>) {
    setSheetError('');
    let payload: Record<string, unknown>;
    try {
      payload = buildPayload();
    } catch (error) {
      setSheetError(userSafeError(error));
      return;
    }
    await runPendingFinancialAction({
      scope: `bank:${actionName}:${cycle.id}:${selectedBank}`,
      payload,
      setPending,
      onSaved: async () => {
        setSheet(null);
        await onSaved();
      },
      onError: fail,
      action: (idempotencyKey) => action(idempotencyKey, payload)
    });
  }

  const actions: { id: BankSheet; label: string; icon: string; tone: string }[] = [
    { id: 'reconcile', label: 'Conciliar', icon: 'M5 12l4 4L19 6', tone: 'quick-green' },
    { id: 'interest', label: 'Intereses', icon: 'M19 5L5 19M7 7h.01M17 17h.01', tone: 'quick-blue' },
    { id: 'fee', label: 'Comisión', icon: 'M5 12h14', tone: 'quick-amber' },
    { id: 'transfer', label: 'Mover entre banco y efectivo', icon: 'M5 9h13l-3-3M19 15H6l3 3', tone: 'quick-violet' }
  ];

  const dateField = <label>Fecha<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} disabled={pending} required /></label>;
  const referenceField = <label>Referencia<input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} placeholder="Opcional" /></label>;
  const amountField = (label = 'Monto') => <label>{label}<CopInput className="input-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" disabled={pending} placeholder="0" required /></label>;

  return (
    <section className="bank-page more-page" aria-labelledby="banco-titulo">
      <div className="hero-band">
        <div className="hero-band-top">
          <div>
            <p className="hero-eyebrow">{selectedAccount ? [selectedAccount.institution_name, selectedAccount.masked_identifier].filter(Boolean).join(' · ') || 'Cuenta bancaria' : 'Más'}</p>
            <h2 id="banco-titulo">Banco y caja</h2>
          </div>
          {bankAccounts.length ? <button type="button" className="hero-button" onClick={() => open('account')}>Nueva cuenta</button> : null}
        </div>
        <div className="hero-figure">
          <span>Saldo registrado</span>
          <strong>{formatCop(bankTotal.plus(balances.physicalCash).plus(balances.unknownCash), 2)}</strong>
        </div>
        <div className="hero-chips">
          <span>Bancos {formatCop(bankTotal, 2)}</span>
          <span>Efectivo {formatCop(balances.physicalCash, 2)}</span>
          {!balances.unknownCash.isZero() ? <span>Sin asignar a banco o efectivo {formatCop(balances.unknownCash, 2)}</span> : null}
          {bankAccounts.length ? <span>{lastReconciliation ? (lastReconciliation.status === 'matched' ? `Cuadró el ${formatDayMonth(lastReconciliation.as_of_date)}` : `Diferencia el ${formatDayMonth(lastReconciliation.as_of_date)}`) : 'Sin conciliar'}</span> : null}
        </div>
        <p className="hero-balance-note">Saldo en banco, efectivo y ubicaciones pendientes; incluye fondos de los socios.</p>
      </div>

      {bankAccounts.length === 0 ? (
        <div className="float-card">
          <span className="quick-icon quick-blue"><QuickIcon path="M4 10l8-5 8 5M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18" /></span>
          <strong className="float-card-title">Todavía no hay cuenta bancaria</strong>
          <p className="muted">Créala para registrar intereses y comisiones, y para conciliar con el extracto.</p>
          <Button type="button" onClick={() => open('account')}>Crear cuenta</Button>
        </div>
      ) : (
        <div className="quick-grid">
          {actions.map((action) => (
            <button key={action.label} type="button" className="quick-action" onClick={() => open(action.id)}>
              <span className={`quick-icon ${action.tone}`}><QuickIcon path={action.icon} /></span>
              {action.label}
            </button>
          ))}
        </div>
      )}

      <FinancialCutPicker />
      <StatementCheck cycle={cycle} accounts={bankAccounts} onSaved={onSaved} />
      <details className="list-card bank-calculation"><summary>Ver cálculo del dinero</summary>
        <BankPositionCard accounts={bankAccounts} operations={operations} entries={ledgerEntries} cutDate={cutDate} />
        <MoneyReconstruction operations={operations} entries={ledgerEntries} cutDate={cutDate} />
      </details>
      <PersonalFunds cycle={cycle} accounts={bankAccounts} operations={operations} today={todayCivilDate()} onSaved={onSaved} undo={id => <UndoOperationButton operationId={id} />} />
      <CashLocationCorrections accounts={bankAccounts} operations={operations} entries={ledgerEntries} onSaved={onSaved} />
      {!balances.unknownCash.isZero() ? (
        <div className="alert-card alert-card-static">
          <span className="quick-icon quick-amber"><QuickIcon path="M12 8v5M12 16h.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></span>
          <span className="row-main">
            <strong>{formatCop(balances.unknownCash)} sin asignar a banco o efectivo</strong>
            <span className="row-sub">Indica si este saldo está en el banco o en efectivo para que la caja cuadre.</span>
          </span>
          <button type="button" className="pill-button" onClick={() => open('locate')}>Ubicar dinero</button>
        </div>
      ) : null}

      {bankAccounts.length > 1 ? (
        <div className="filter-chips" role="group" aria-label="Cuenta bancaria">
          {bankAccounts.map((account) => (
            <button key={account.id} type="button" className="filter-chip" aria-pressed={account.id === selectedBank} onClick={() => setBankAccountId(account.id)}>{account.display_name}</button>
          ))}
        </div>
      ) : null}

      <details className="list-card bank-locations"><summary>Ver cuentas y ubicaciones</summary>
        {bankAccounts.map((account) => (
          <div key={account.id} className="value-row">
            <span className="row-main"><strong>{account.display_name}</strong><span className="row-sub">En banco según la app</span></span>
            <span className="row-amount">{formatCop(balances.byBank.get(account.id) ?? 0, 2)}</span>
          </div>
        ))}
        <div className="value-row">
          <span className="row-main"><strong>Efectivo</strong><span className="row-sub">En mano del administrador</span></span>
          <span className="row-amount">{formatCop(balances.physicalCash, 2)}</span>
        </div>
        <div className="value-row">
          <span className="row-main"><strong>Sin asignar a banco o efectivo</strong><span className="row-sub">Saldo sin banco ni efectivo asignados</span></span>
          <span className={balances.unknownCash.isZero() ? 'row-amount' : 'row-amount tone-soon'}>{formatCop(balances.unknownCash, 2)}</span>
        </div>
      </details>

      {bankAccounts.length ? (
        <div className="polla-block">
          <div className="section-head">
            <h3>Conciliaciones</h3>
            <div className="section-head-actions">
              <button type="button" className="link-button" onClick={() => open('opening')}>Saldo inicial</button>
              <button type="button" className="link-button" onClick={() => open('financing')}>Financiación externa</button>
            </div>
          </div>
          {accountReconciliations.length ? (
            <ol className="list-card">
              {accountReconciliations.slice(0, 6).map((item) => (
                <li key={item.id} className="value-row" data-reconciliation-row={item.id}>
                  <span className={`movement-icon ${item.status === 'matched' ? 'movement-ahorro' : 'movement-banco'}`} aria-hidden="true">{item.status === 'matched' ? '✓' : '!'}</span>
                  <span className="row-main">
                    <strong>{formatShortDate(item.as_of_date)} · {item.status === 'matched' ? 'Cuadró' : 'Con diferencia'}</strong>
                    <span className="row-sub">Según la app {formatCop(item.reconstructed_balance)} · extracto {formatCop(item.external_balance)}</span>
                  </span>
                  <span className={new Decimal(item.difference_amount).isZero() ? 'row-amount tone-in' : 'row-amount tone-late'}>Diferencia {formatCop(item.difference_amount)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="muted card-empty">Aún no hay conciliaciones. Usa "Conciliar" con el saldo del extracto.</p>}
        </div>
      ) : null}

      {sheet === 'account' ? (
        <Sheet title="Nueva cuenta bancaria" onClose={close}>
          <form className="sheet-form" onSubmit={(event) => { event.preventDefault(); void runSimple(() => createBankAccount({ cycleId: cycle.id, displayName, institutionName, maskedIdentifier })); }}>
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}
            <label>Nombre de la cuenta<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={pending} placeholder="Pibank natillera" required /></label>
            <label>Entidad<input value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} disabled={pending} placeholder="Pibank" /></label>
            <label>Identificador<input value={maskedIdentifier} onChange={(event) => setMaskedIdentifier(event.target.value)} disabled={pending} placeholder="****1234" /></label>
            <Button type="submit" disabled={pending || !displayName.trim()}>{pending ? 'Guardando...' : 'Guardar cuenta'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'opening' || sheet === 'financing' || sheet === 'fee' ? (
        <Sheet title={sheet === 'opening' ? 'Saldo inicial de la cuenta' : sheet === 'financing' ? 'Financiación externa' : 'Comisión bancaria'} onClose={close}>
          <form
            className="sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              const kind = sheet;
              void runFinancial(kind, () => ({ effectiveDate, amount: money(amount, 'monto'), reference }), (idempotencyKey, payload) => {
                const input = { cycleId: cycle.id, bankAccountId: selectedBank, idempotencyKey, effectiveDate, amount: payload.amount as string, reference };
                return kind === 'opening' ? recordBankOpening(input) : kind === 'financing' ? recordBankExternalFinancing(input) : recordBankFee(input);
              });
            }}
          >
            <p className="sheet-sub">{selectedAccount?.display_name}</p>
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}
            {amountField()}
            {dateField}
            {referenceField}
            <Button type="submit" disabled={pending || !amount}>{pending ? 'Guardando...' : sheet === 'opening' ? 'Registrar saldo inicial' : sheet === 'financing' ? 'Registrar financiación' : 'Registrar comisión'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'interest' ? (
        <Sheet title="Intereses del banco" onClose={close}>
          <form
            className="sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runFinancial('interest', () => ({ effectiveDate, grossAmount: money(amount, 'interes'), withholdingAmount: money(interestWithholding, 'retencion'), feeAmount: money(interestFee, 'comision'), reference }), (idempotencyKey, payload) =>
                recordBankInterest({ cycleId: cycle.id, bankAccountId: selectedBank, idempotencyKey, effectiveDate, grossAmount: payload.grossAmount as string, withholdingAmount: payload.withholdingAmount as string, feeAmount: payload.feeAmount as string, reference }));
            }}
          >
            <p className="sheet-sub">{selectedAccount?.display_name}</p>
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}
            {amountField('Interés bruto')}
            <small className="field-hint">Usa la fecha en que Pibank abonó el rendimiento, no la de hoy: de esa fecha depende quién participa en el reparto.</small>
            <div className="form-pair">
              <label>Retención en la fuente<CopInput value={interestWithholding} onChange={(event) => setInterestWithholding(event.target.value)} inputMode="decimal" disabled={pending} /></label>
              <label>Comisión sobre intereses<CopInput value={interestFee} onChange={(event) => setInterestFee(event.target.value)} inputMode="decimal" disabled={pending} /></label>
            </div>
            {dateField}
            {referenceField}
            <Button type="submit" disabled={pending || !amount}>{pending ? 'Guardando...' : 'Registrar intereses'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'transfer' ? (
        <Sheet title="Mover entre banco y efectivo" onClose={close}>
          <form
            className="sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              const fromBank = direction === 'bank-to-cash';
              void runFinancial('transfer', () => ({ effectiveDate, direction, amount: money(amount, 'traslado'), reference }), (idempotencyKey, payload) => recordLiquidityTransfer({
                cycleId: cycle.id,
                idempotencyKey,
                effectiveDate,
                fromLocation: fromBank ? 'bank' : 'cash',
                fromBankAccountId: fromBank ? selectedBank : null,
                toLocation: fromBank ? 'cash' : 'bank',
                toBankAccountId: fromBank ? null : selectedBank,
                amount: payload.amount as string,
                reference
              }));
            }}
          >
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}
            <div className="segmented" role="group" aria-label="Dirección del traslado">
              <button type="button" aria-pressed={direction === 'bank-to-cash'} onClick={() => setDirection('bank-to-cash')} disabled={pending}>Banco → efectivo</button>
              <button type="button" aria-pressed={direction === 'cash-to-bank'} onClick={() => setDirection('cash-to-bank')} disabled={pending}>Efectivo → banco</button>
            </div>
            {amountField()}
            {dateField}
            {referenceField}
            <Button type="submit" disabled={pending || !amount}>{pending ? 'Guardando...' : 'Registrar traslado'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'reconcile' ? (
        <Sheet title="Conciliar con el extracto" onClose={close}>
          <form
            className="sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              let payload: Parameters<typeof createBankReconciliation>[0];
              try {
                payload = { cycleId: cycle.id, bankAccountId: selectedBank, openingVerifiedBalance: money(openingBalance, 'saldo inicial'), openingDate, externalBalance: money(externalBalance, 'saldo del extracto'), asOfDate: effectiveDate, reference };
              } catch (error) {
                setSheetError(userSafeError(error));
                return;
              }
              void runSimple(() => createBankReconciliation(payload));
            }}
          >
            <p className="sheet-sub">{selectedAccount?.display_name}</p>
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}
            <label>Fecha del corte<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} disabled={pending} required /></label>
            <div className="value-row value-row-soft"><span>Según la app</span><strong>{formatCop(sheetBalance)}</strong></div>
            <label>Saldo del extracto<CopInput className="input-amount" value={externalBalance} onChange={(event) => setExternalBalance(event.target.value)} inputMode="decimal" disabled={pending} required /></label>
            {reconcileDiff ? (
              <div className={reconcileDiff.isZero() ? 'value-row value-row-ok' : 'value-row value-row-bad'} aria-live="polite">
                <span>{reconcileDiff.isZero() ? 'Cuadra' : 'Diferencia'}</span><strong>{formatCop(reconcileDiff)}</strong>
              </div>
            ) : null}
            <div className="form-pair">
              <label>Saldo inicial verificado<CopInput value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" disabled={pending} placeholder="Según el primer extracto" required /></label>
              <label>Fecha del saldo inicial<input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} disabled={pending} required /></label>
            </div>
            {referenceField}
            <Button type="submit" disabled={pending || !externalBalance || !openingBalance || !openingDate}>{pending ? 'Guardando...' : 'Guardar conciliación'}</Button>
          </form>
        </Sheet>
      ) : null}

      {sheet === 'locate' ? (
        <Sheet title="Ubicar dinero sin asignar a banco o efectivo" onClose={close}>
          <form
            className="sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runFinancial('locate', () => ({ effectiveDate, toLocation: locateTo.location, toBankAccountId: locateTo.location === 'bank' ? locateTo.bankAccountId : null, amount: money(amount, 'monto'), reference }), (idempotencyKey, payload) => locateUnknownLiquidity({
                cycleId: cycle.id,
                idempotencyKey,
                effectiveDate,
                toLocation: locateTo.location,
                toBankAccountId: locateTo.location === 'bank' ? locateTo.bankAccountId : null,
                amount: payload.amount as string,
                reference
              }));
            }}
          >
            <p className="sheet-sub">Hay {formatCop(balances.unknownCash)} sin ubicación asignada.</p>
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}
            <LocationPicker value={locateTo} onChange={setLocateTo} bankAccounts={bankAccounts} disabled={pending} />
            {amountField()}
            {dateField}
            {referenceField}
            <small className="field-hint">No es un movimiento de dinero nuevo: solo indica dónde está lo que ya existe.</small>
            <Button type="submit" disabled={pending || !amount || (locateTo.location === 'bank' && !locateTo.bankAccountId)}>{pending ? 'Guardando...' : 'Registrar ubicación'}</Button>
          </form>
        </Sheet>
      ) : null}
    </section>
  );
}

function MemberCapitalDetail({item}:{cycle:Cycle;item:CycleMember;contributions:SavingsContribution[];credits:MemberCapitalCredit[]}) {return <MemberSavingsInsight item={item}/>}

function BankYieldPanel({
  cycle,
  cycleMembers,
  distributions,
  credits,
  accounts, operations, entries, onMovements,
  onBack,
  onSaved,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  distributions: BankYieldDistribution[];
  credits: MemberCapitalCredit[];
  accounts: BankAccount[]; operations: FinancialOperation[]; entries: LedgerEntry[]; onMovements: () => void;
  onBack?: () => void;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [cutDate, setCutDate] = useState(cycle.closes_on);
  const [preview, setPreview] = useState<BankYieldPreview | null>(null);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const confirmed = distributions.find((item) => item.status === 'confirmed');
  const names = new Map(cycleMembers.map((item) => [item.id, item.member?.display_name ?? 'Socio']));
  const allocations = confirmed ? credits.filter((credit) => credit.distribution_id === confirmed.id) : [];
  const eligible = cycleMembers.filter((item) => item.savings_status === 'active' && item.participates_in_polla).length;
  const serverToday = useServerCivilToday();
  const beforeClose = serverToday < cycle.closes_on;
  const rulesActive = cycle.settlement_rules_version === 'fin03-2026';

  async function calculate() {
    setFormError('');
    setPending(true);
    try {
      setPreview(await previewBankYieldDistribution(cycle.id, cutDate));
    } catch (error) {
      setFormError(userSafeError(error));
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    await runPendingFinancialAction({
      scope: `bank-yield:confirm:${cycle.id}`,
      payload: { cycleId: cycle.id, cutDate, previewHash: preview.preview_hash },
      setPending,
      onSaved: async () => {
        setPreview(null);
        await onSaved();
      },
      onError: (error) => {
        setFormError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => confirmBankYieldDistribution({ cycleId: cycle.id, cutDate, idempotencyKey, previewHash: preview.preview_hash })
    });
  }

  const figure = confirmed ? confirmed.pool_amount : preview ? preview.pool : null;
  return (
    <section className="yield-page more-page" aria-labelledby="rendimientos-titulo">
      <div className="hero-band">
        <div className="hero-band-top">
          <div>
            <HeroBack onClick={onBack} />
            <p className="hero-eyebrow">Ciclo {formatCycleRange(cycle)}</p>
            <h2 id="rendimientos-titulo">Rendimientos bancarios</h2>
          </div>
        </div>
        <div className="hero-figure">
          <span>{confirmed ? 'Repartido a socios' : preview ? 'Para repartir' : 'Se reparte al cerrar el ciclo'}</span>
          <strong>{figure !== null ? formatCop(figure, 2) : '—'}</strong>
        </div>
        <div className="hero-chips">
          <span>{eligible} socios activos juegan polla</span>
          {confirmed ? <span>Desde {formatCop(confirmed.per_member_amount, 2)} c/u</span> : null}
        </div>
      </div>

      <BankInterestHistory accounts={accounts} operations={operations} entries={entries} cutDate={cutDate} onMovements={onMovements} />
      {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}

      {!confirmed ? (
        <div className="list-card step-card">
          <div className="sheet-form">
            <details><summary>Cómo se reparten los abonos</summary><p>Se conservan los derechos de cada socio de polla en la fecha del abono. Se descuentan importes ya reconocidos en cuentas finales. El administrador y quienes solo ahorran al 12 % EA no participan. Los centavos se asignan por orden de nombre.</p></details>
            {!rulesActive ? <InlineNotice tone="warning">La política de reparto automático no está activada en este ciclo.</InlineNotice> : null}
            {beforeClose ? <InlineNotice tone="neutral">El ciclo cierra el {formatShortDate(cycle.closes_on)}. Puedes simular antes, pero el reparto solo se confirma ese día, con corte en esa fecha.</InlineNotice> : null}
            <FinancialCutField value={cutDate} onChange={(value) => { setCutDate(value); setPreview(null); }} disabled={pending} />
            <Button type="button" variant="quiet" onClick={() => void calculate()} disabled={pending}>{pending ? 'Calculando...' : 'Calcular reparto'}</Button>
            {preview ? (
              <>
                <div className="breakdown">
                  <div className="value-row"><span>Neto recibido del banco</span><strong>{formatCop(preview.net_received, 2)}</strong></div>
                  {preview.recognized_in_withdrawals ? <div className="value-row"><span>Ya entregado en retiros anticipados</span><strong>−{formatCop(preview.recognized_in_withdrawals, 2)}</strong></div> : null}
                  {preview.unassigned ? <div className="value-row"><span>Sin beneficiario (abonos sin socios elegibles)</span><strong>{formatCop(preview.unassigned, 2)}</strong></div> : null}
                  <div className="value-row"><span>Para repartir</span><strong>{formatCop(preview.pool, 2)}</strong></div>
                  {!preview.unresolved_receipts ? <div className="value-row"><span>Por socio ({preview.beneficiary_count})</span><strong className="tone-in">{preview.per_member === preview.per_member_max ? formatCop(preview.per_member, 2) : `${formatCop(preview.per_member, 2)} a ${formatCop(preview.per_member_max ?? preview.per_member, 2)}`}</strong></div> : null}
                </div>
                {preview.unresolved_receipts ? <InlineNotice tone="warning">Hay {preview.unresolved_receipts} abono(s) sin distribución individual. El remanente conserva lo ya liquidado; se necesita la asignación para repartirlo correctamente.</InlineNotice> : null}
                {!preview.unresolved_receipts && preview.rights_mismatch ? <InlineNotice tone="danger">Los derechos individuales no coinciden con el remanente. Revisa la conciliación antes de repartir.</InlineNotice> : null}
                {preview.unresolved_members ? <InlineNotice tone="warning">Hay {preview.unresolved_members} socio(s) de polla retirados sin cuenta final registrada. Liquídalos antes de confirmar para saber qué parte les toca.</InlineNotice> : null}
                <Button type="button" onClick={() => void confirm()} disabled={pending || !preview.confirmation_allowed || beforeClose || !rulesActive || cutDate !== cycle.closes_on}>Confirmar reparto</Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmed ? (
        <div className="polla-block">
          <div className="section-head"><h3>Reparto por socio</h3><span className="muted">Corte {formatShortDate(confirmed.cut_date)}</span></div>
          <ul className="list-card">
            {allocations.map((credit) => (
              <li key={credit.id} className="value-row">
                <Avatar name={names.get(credit.cycle_member_id) ?? 'Socio'} />
                <span className="row-main"><strong>{names.get(credit.cycle_member_id) ?? 'Socio'}</strong><span className="row-sub">Fondo de rendimientos del socio</span></span>
                <span className="row-amount tone-in">+{formatCop(credit.amount, 2)}</span>
              </li>
            ))}
          </ul>
          <p className="muted">Neto recibido de Pibank {formatCop(confirmed.net_received, 2)}</p>
          <Button type="button" variant="quiet" disabled={pending} onClick={() => {
            const reason = window.prompt('Motivo de la corrección (por ejemplo: rendimiento mal registrado):');
            if (!reason) return;
            setPending(true);
            setFormError('');
            void reverseBankYieldDistribution(confirmed.id, makeIdempotencyKey(), reason)
              .then(onSaved)
              .catch((error) => { setFormError(userSafeError(error)); onError(error); })
              .finally(() => setPending(false));
          }}>Deshacer reparto para corregir</Button>
        </div>
      ) : null}
    </section>
  );
}

function AdminFundPanel({
  cycle,
  bankAccounts,
  operations,
  ledgerEntries,
  onBack,
  onSaved,
  onError
}: {
  cycle: Cycle;
  bankAccounts: BankAccount[];
  operations: FinancialOperation[];
  ledgerEntries: LedgerEntry[];
  onBack?: () => void;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayCivilDate());
  const [description, setDescription] = useState('');
  const [withdrawFrom, setWithdrawFrom] = useState<MoneySheetLocation>({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: bankAccounts[0]?.id ?? '' });
  const [withdrawPreview, setWithdrawPreview] = useState<AdminWithdrawalPreview | null>(null);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const { cutDate } = useFinancialCut();
  const { totals, rows, earned, balance } = adminPosition(operations, ledgerEntries, cutDate);
  const labels: Record<string, string> = { polla: 'Comisión de polla', loans: 'Participación en intereses de préstamos', fines: 'Multas del administrador', annual: 'Administración anual reconocida', coverage: 'Cobertura del 12 % anual prometido', residual: 'Sobrante del reparto bancario', other: 'Otros derechos', withdrawals: 'Retiro' };
  useEffect(() => {
    let cancelled = false;
    setWithdrawPreview(null);
    void previewAdminWithdrawal(cycle.id, open ? effectiveDate : cutDate).then((value) => {
      if (!cancelled) setWithdrawPreview(value);
    }).catch((error) => { if (!cancelled) setFormError(userSafeError(error)); });
    return () => { cancelled = true; };
  }, [cycle.id, effectiveDate, cutDate, open, operations.length]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    let value: string;
    try {
      value = toDatabaseMoney(parseCop(amount, 'retiro'));
    } catch (error) {
      setFormError(userSafeError(error));
      return;
    }
    await runPendingFinancialAction({
      scope: `admin:withdraw:${cycle.id}`,
      payload: { amount: value, effectiveDate, description, liquidityLocation: withdrawFrom.location, bankAccountId: withdrawFrom.location === 'bank' ? withdrawFrom.bankAccountId : null },
      setPending,
      onSaved: async () => {
        setOpen(false);
        await onSaved();
      },
      onError: (error) => {
        setFormError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => withdrawAdminFund({ cycleId: cycle.id, idempotencyKey, effectiveDate, amount: value, description, liquidityLocation: withdrawFrom.location, bankAccountId: withdrawFrom.location === 'bank' ? withdrawFrom.bankAccountId : null })
    });
  }

  return (
    <section className="admin-page more-page" aria-labelledby="admin-titulo">
      <div className="hero-band">
        <div className="hero-band-top">
          <div>
            <HeroBack onClick={onBack} />
            <p className="hero-eyebrow">Sigue invertido en la cuenta común</p>
            <h2 id="admin-titulo">Mi ganancia como administrador</h2>
          </div>
          <button type="button" className="hero-button" onClick={() => { setFormError(''); setAmount(''); setDescription(''); setOpen(true); }} disabled={!withdrawPreview || withdrawPreview.available <= 0}>Registrar retiro</button>
        </div>
        <div className="hero-figure"><span>Saldo registrado</span><strong>{formatCop(balance, 2)}</strong></div>
      </div>
      <FinancialCutPicker />
      {withdrawPreview ? <div className="list-card">
        <div className="value-row"><span>Apartado para el 12 % anual prometido hasta el cierre</span><strong>{formatCop(withdrawPreview.ea_reserve, 2)}</strong></div>
        <div className="value-row"><span>Disponible para retirar</span><strong>{formatCop(withdrawPreview.available, 2)}</strong></div>
        {withdrawPreview.needs_review ? <InlineNotice tone="warning">Hay obligaciones pendientes de conciliación. El retiro queda bloqueado.</InlineNotice> : null}
      </div> : <p className="muted">{formError || 'Calculando saldo disponible...'}</p>}
      <div className="list-card">
        <div className="value-row"><span>Ganado reconocido al corte, neto de anulaciones</span><strong>{formatCop(earned, 2)}</strong></div>
        <div className="value-row"><span>Multas del administrador</span><strong>{formatCop(totals.fines, 2)}</strong></div>
        <div className="value-row"><span>Administración anual reconocida</span><strong>{formatCop(totals.annual, 2)}</strong></div>
        <div className="value-row"><span>Cobertura del 12 % anual prometido</span><strong>{formatCop(totals.coverage, 2)}</strong></div>
        <div className="value-row"><span>Comisiones de polla</span><strong>{formatCop(totals.polla, 2)}</strong></div>
        <div className="value-row"><span>Participación en intereses de préstamos</span><strong>{formatCop(totals.loans, 2)}</strong></div>
        <div className="value-row"><span>Sobrante del reparto bancario</span><strong>{formatCop(totals.residual, 2)}</strong></div>
        {!totals.other.isZero() ? <div className="value-row"><span>Otros ingresos</span><strong>{formatCop(totals.other, 2)}</strong></div> : null}
        <div className="value-row"><span>Retiros realizados</span><strong className="tone-late">{formatCop(totals.withdrawals, 2)}</strong></div>
      </div>
      <AdminProjection reserve={withdrawPreview} />
      <details className="list-card admin-history"><summary>Ver movimientos del administrador</summary>
        {rows.length ? (
          <ol className="list-card">
            {rows.slice(0, 40).map(({ entry, operation, kind, value }) => (
              <li key={entry.id} className="value-row">
                <span className="row-main"><strong>{labels[kind]}</strong><span className="row-sub">{operation ? formatShortDate(operation.effective_date) : ''}</span></span>
                <span className={value.lt(0) ? 'row-amount tone-late' : 'row-amount tone-in'}>{signedCop(value)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="muted card-empty">Aún no hay ingresos del administrador.</p>}
      </details>

      {open ? (
        <Sheet title="Retiro del fondo del administrador" onClose={() => setOpen(false)}>
          <form className="sheet-form" onSubmit={submit}>
            <p className="sheet-sub">Disponible {formatCop(withdrawPreview?.available ?? 0)} después de reservar el 12 % EA hasta el cierre.</p>
            {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
            <LocationPicker value={withdrawFrom} onChange={setWithdrawFrom} bankAccounts={bankAccounts} disabled={pending} />
            <label>Monto<CopInput className="input-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" disabled={pending} required /></label>
            <label>Fecha<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} disabled={pending} required /></label>
            <label>Comprobante o detalle<input value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending} placeholder="Número de transferencia" required /></label>
            <Button type="submit" disabled={pending || !amount || !description.trim() || !withdrawPreview || (withdrawFrom.location === 'bank' && !withdrawFrom.bankAccountId)}>{pending ? 'Guardando...' : 'Registrar retiro'}</Button>
          </form>
        </Sheet>
      ) : null}
    </section>
  );
}

function SettlementPanel({
  cycle,
  cycleMembers,
  bankAccounts,
  settlements,
  loans,
  prizes,
  activities,
  credits,
  onBack,
  onSaved,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  bankAccounts: BankAccount[];
  settlements: MemberSettlement[];
  loans: LoanContract[];
  prizes: PollaPrize[];
  activities: PollaActivity[];
  credits: MemberCapitalCredit[];
  onBack?: () => void;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [cutDate, setCutDate] = useState(cycle.closes_on <= todayCivilDate() ? cycle.closes_on : todayCivilDate());
  const [annualFee, setAnnualFee] = useState('0');
  const [penalty, setPenalty] = useState('0');
  const [otherDiscounts, setOtherDiscounts] = useState('0');
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [paidDate, setPaidDate] = useState(todayCivilDate());
  const [payFrom, setPayFrom] = useState<MoneySheetLocation>({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: bankAccounts[0]?.id ?? '' });
  const [reference, setReference] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [calculationPending, setCalculationPending] = useState(false);
  const [operationPending, setOperationPending] = useState(false);
  const [completionPending, setCompletionPending] = useState(false);
  const previewRequest = useRef(0);
  const serverToday = useServerCivilToday();
  const pending = calculationPending || operationPending || completionPending;
  const automaticFees = cycle.settlement_rules_version === 'fin03-2026';
  const dateError = !/^\d{4}-\d{2}-\d{2}$/.test(cutDate) ? 'Indica una fecha de corte válida.'
    : cutDate < cycle.starts_on || cutDate > cycle.closes_on ? 'La fecha de corte debe estar dentro de este ciclo.' : '';
  const moneyError = (() => {
    try { parseCop(otherDiscounts || '0', 'otros descuentos'); if (!automaticFees) { parseCop(annualFee || '0', 'cuota de administración'); parseCop(penalty || '0', 'multa'); } return ''; }
    catch { return 'Los descuentos deben ser importes válidos, positivos o cero, con máximo dos decimales.'; }
  })();

  useEffect(() => () => { previewRequest.current += 1; }, []);
  const latestByMember = new Map<string, MemberSettlement>();
  for (const item of settlements) {
    if (item.status === 'reversed') continue;
    const current = latestByMember.get(item.cycle_member_id);
    if (!current || (current.status !== 'paid' && item.status === 'paid') || item.cut_date > current.cut_date) latestByMember.set(item.cycle_member_id, item);
  }
  const rows = cycleMembers.map((item) => ({ item, settlement: latestByMember.get(item.id) }));
  const paidRows = rows.filter((row) => row.settlement?.status === 'paid');
  const confirmedRows = rows.filter((row) => row.settlement?.status === 'confirmed');
  const paidTotal = paidRows.reduce((sum, row) => sum.plus(row.settlement?.transfer_amount ?? 0), new Decimal(0));
  const pendingTotal = confirmedRows.reduce((sum, row) => sum.plus(row.settlement?.transfer_amount ?? 0), new Decimal(0));
  const selected = rows.find((row) => row.item.id === selectedId);
  const snapshot = selected?.settlement?.snapshot as unknown as SettlementPreview | undefined;
  const displayed = snapshot ?? preview;
  const step = selected?.settlement?.status === 'paid' ? 3 : selected?.settlement?.status === 'confirmed' ? 2 : preview ? 1 : 0;
  const statusInfo = (settlement?: MemberSettlement) => settlement?.status === 'paid'
    ? { tone: 'paid', label: 'Pagada' }
    : settlement?.status === 'confirmed' ? { tone: 'soon', label: 'Confirmada' } : { tone: 'draft', label: 'Sin liquidar' };

  function inputs() {
    return {
      cycleMemberId: selectedId,
      cutDate,
      annualAdminFee: toDatabaseMoney(parseCop(annualFee || '0', 'cuota anual')),
      penaltyAmount: toDatabaseMoney(parseCop(penalty || '0', 'multa')),
      otherDiscounts: toDatabaseMoney(parseCop(otherDiscounts || '0', 'otros descuentos'))
    };
  }

  function invalidatePreview() {
    previewRequest.current += 1;
    setPreview(null);
    setCalculationPending(false);
    setSheetError('');
  }

  function closeMember() { invalidatePreview(); setSelectedId(''); }

  function openMember(id: string) {
    invalidatePreview();
    setSelectedId(id);
    setAnnualFee('0'); setPenalty('0'); setOtherDiscounts('0');
    setCutDate(cycle.closes_on <= serverToday ? cycle.closes_on : serverToday);
    setReference('');
    setPaidDate(todayCivilDate());
  }

  async function calculate() {
    if (dateError || moneyError) return;
    setSheetError('');
    setPreview(null);
    const request = ++previewRequest.current;
    setCalculationPending(true);
    try {
      const value = await previewMemberSettlement(inputs());
      if (request === previewRequest.current) setPreview(value);
    } catch (error) {
      if (request !== previewRequest.current) return;
      setSheetError(userSafeError(error));
      onError(error);
    } finally {
      if (request === previewRequest.current) setCalculationPending(false);
    }
  }

  async function confirm() {
    if (!preview || pending || dateError || moneyError || new Decimal(preview.net).isNegative() || cutDate > serverToday || preview.cut_date !== cutDate || preview.cycle_member_id !== selectedId) return;
    let payload: ReturnType<typeof inputs> & { previewHash: string };
    try {
      payload = { ...inputs(), previewHash: preview.preview_hash };
    } catch (error) {
      setSheetError(userSafeError(error));
      return;
    }
    await runPendingFinancialAction({
      scope: `settlement:confirm:${selectedId}`,
      payload,
      setPending: setOperationPending,
      onSaved,
      onError: (error) => {
        if (!isAmbiguousOperationError(error)) { previewRequest.current += 1; setPreview(null); }
        setSheetError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => confirmMemberSettlement({ ...payload, idempotencyKey })
    });
  }

  async function pay() {
    const settlement = selected?.settlement;
    if (!settlement || pending || new Decimal(settlement.transfer_amount).lte(0) || paymentInvalid) return;
    const payload = { settlementId: settlement.id, paidDate, liquidityLocation: payFrom.location, bankAccountId: payFrom.location === 'bank' ? payFrom.bankAccountId : null, reference };
    await runPendingFinancialAction({
      scope: `settlement:pay:${settlement.id}`,
      payload,
      setPending: setOperationPending,
      onSaved: async () => {
        setSelectedId('');
        await onSaved();
      },
      onError: (error) => {
        setSheetError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => payMemberSettlement({ ...payload, idempotencyKey })
    });
  }

  const negativeNet = preview ? new Decimal(preview.net).isNegative() : false;
  const futureCut = cutDate > serverToday;
  const paymentInvalid = !paidDate || paidDate > serverToday || !!selected?.settlement && paidDate < selected.settlement.cut_date || !reference.trim() || payFrom.location === 'bank' && !payFrom.bankAccountId;

  return (
    <section className="settlement-page more-page" aria-labelledby="liquidaciones-titulo">
      <div className="hero-band">
        <div className="hero-band-top">
          <div>
            <HeroBack onClick={onBack} />
            <p className="hero-eyebrow">Ciclo {formatCycleRange(cycle)}</p>
            <h2 id="liquidaciones-titulo">Cuentas finales de socios</h2>
          </div>
        </div>
        <div className="hero-figure">
          <span>Entregado a socios</span>
          <strong>{formatCop(paidTotal,2)}</strong>
        </div>
        <div className="hero-figure-row">
          <span className="hero-pill">{paidRows.length} de {rows.length} pagadas</span>
          {confirmedRows.length ? <span className="hero-pill">{confirmedRows.length} por pagar · {formatCop(pendingTotal,2)}</span> : null}
        </div>
        <div className="progress progress-on-dark"><span style={{ width: `${rows.length ? Math.round((paidRows.length / rows.length) * 100) : 0}%` }} /></div>
      </div>

      <div className="polla-block">
        <div className="section-head"><h3>Socios</h3><span className="muted">Toca uno para liquidarlo</span></div>
        <ul className="list-card">
          {rows.map(({ item, settlement }) => {
            const info = statusInfo(settlement);
            const name = item.member?.display_name ?? 'Socio';
            return (
              <li key={item.id}>
                <button type="button" className="row-button" onClick={() => openMember(item.id)} data-settlement-member={item.id}>
                  <Avatar name={name} />
                  <span className="row-main">
                    <strong>{name}</strong>
                    <span className="row-sub">{settlement ? `Corte ${formatShortDate(settlement.cut_date)}` : `Cuota ${formatCop(item.monthly_quota)} al mes`}</span>
                  </span>
                  <span className="row-end">
                    {settlement ? <span className="row-amount">{formatCop(settlement.transfer_amount,2)}</span> : null}
                    <StatusChip tone={info.tone}>{info.label}</StatusChip>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected ? (
        <Sheet title={`Cuenta final de ${selected.item.member?.display_name ?? 'socio'}`} onClose={closeMember} closeDisabled={operationPending || completionPending}>
          <div className="sheet-form">
            <div className="step-bars" aria-label={`Paso ${Math.min(step + 1, 3)} de 3`}>
              {['Calcular', 'Confirmar', 'Pagar'].map((label, index) => (
                <div key={label} className={index < step || step === 3 ? 'step-bar is-done' : index === step ? 'step-bar is-current' : 'step-bar'}><span /><small>{label}</small></div>
              ))}
            </div>
            {sheetError ? <InlineNotice tone="danger">{sheetError}</InlineNotice> : null}

            {step <= 1 ? (
              <>
                <div className="form-pair">
                  <FinancialCutField value={cutDate} min={cycle.starts_on} max={cycle.closes_on} invalid={!!dateError} onChange={(value) => { invalidatePreview(); setCutDate(value); }} disabled={operationPending || completionPending} />
                  <label>Otros descuentos<CopInput value={otherDiscounts} onChange={(event) => { invalidatePreview(); setOtherDiscounts(event.target.value); }} inputMode="decimal" disabled={operationPending || completionPending} /></label>
                </div>
                {!automaticFees ? <>
                  <div className="form-pair">
                    <label>Cuota de administración<CopInput value={annualFee} onChange={event => { invalidatePreview(); setAnnualFee(event.target.value); }} inputMode="decimal" disabled={operationPending} /></label>
                    <label>Multa por retiro<CopInput value={penalty} onChange={event => { invalidatePreview(); setPenalty(event.target.value); }} inputMode="decimal" disabled={operationPending} /></label>
                  </div>
                  <small className="field-hint">Este ciclo usa descuentos manuales. Registra los importes acordados; no se aplican cobros automáticos.</small>
                </> : <small className="field-hint">El servidor calcula administración y multa según la política de este ciclo. Los importes descontados aparecen en el desglose.</small>}
                {dateError || moneyError ? <InlineNotice tone="danger">{dateError || moneyError}</InlineNotice> : null}
                {!preview ? <Button type="button" variant="quiet" onClick={() => void calculate()} disabled={pending || !!dateError || !!moneyError}>{calculationPending ? 'Calculando...' : 'Calcular'}</Button> : null}
              </>
            ) : null}

            {displayed ? <>
              <p className="settlement-cut-label">{snapshot ? 'Cálculo confirmado' : 'Cálculo al corte'} · {formatShortDate(displayed.cut_date ?? cutDate)}</p>
              <SettlementDetails snapshot={displayed} loans={loans} prizes={prizes} activities={activities} credits={credits} memberId={selectedId} cutDate={displayed.cut_date ?? cutDate} />
            </> : null}

            {preview && step <= 1 ? (
              <>
                <div className="total-row"><span>Neto a entregar</span><strong>{formatCop(preview.net, 2)}</strong></div>
                {negativeNet ? <><InlineNotice tone="danger">Esta cuenta final no puede confirmarse mientras tenga un faltante.</InlineNotice><CompletionReceipt key={selectedId + ':' + cutDate + ':' + preview.preview_hash} preview={preview} inputs={inputs()} accounts={bankAccounts} today={serverToday} onBusy={setCompletionPending} onSaved={async () => { await onSaved(); await calculate(); }} /></> : <p className="muted">{new Decimal(preview.completion_received ?? 0).gt(0) ? 'Saldo a favor del socio' : 'Transferencia redondeada'}: {formatCop(preview.transfer_amount, 2)}</p>}
                {futureCut ? <InlineNotice tone="warning">Simulación de una fecha futura. Solo puedes confirmar un corte hasta hoy.</InlineNotice> : null}
                {preview.loan_profit_frozen ? <InlineNotice tone="neutral">Ganancia de préstamos de los socios hasta este corte: {formatCop(preview.loan_profit_frozen)}. Queda congelada y se paga en el reparto del cierre.</InlineNotice> : null}
                <Button type="button" onClick={() => void confirm()} disabled={pending || negativeNet || futureCut || !!dateError || !!moneyError}>{operationPending ? 'Guardando...' : 'Confirmar cuenta final'}</Button>
              </>
            ) : null}

            {step === 2 && selected.settlement ? (
              <>
                <div className="total-row"><span>A entregar</span><strong>{formatCop(selected.settlement.transfer_amount, 2)}</strong></div>
                {new Decimal(selected.settlement.transfer_amount).isZero() ? <InlineNotice tone="neutral">La cuenta final quedó confirmada sin transferencia de dinero. No se registra un pago de $0.</InlineNotice> : <>
                <LocationPicker value={payFrom} onChange={setPayFrom} bankAccounts={bankAccounts} disabled={pending} />
                <label>Fecha del pago<input type="date" value={paidDate} min={selected.settlement.cut_date} max={serverToday} onChange={(event) => setPaidDate(event.target.value)} disabled={pending} /></label>
                <label>Referencia<input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} placeholder="Número de transferencia" /></label>
                {paidDate > serverToday || paidDate < selected.settlement.cut_date ? <InlineNotice tone="danger">La fecha del pago debe estar entre el corte y hoy.</InlineNotice> : null}
                <Button type="button" onClick={() => void pay()} disabled={pending || paymentInvalid}>{operationPending ? 'Guardando...' : `Pagar ${formatCop(selected.settlement.transfer_amount, 2)}`}</Button>
                </>}
              </>
            ) : null}

            {step === 3 && selected.settlement ? (
              <InlineNotice tone="success">Pagada: {formatCop(selected.settlement.transfer_amount,2)}{selected.settlement.paid_at ? ` el ${formatShortDate(selected.settlement.paid_at)}` : ''}.</InlineNotice>
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

// La fecha que decide el cierre la da el servidor (en TEST puede venir del reloj controlado).
function useServerCivilToday() {
  const [today, setToday] = useState(todayCivilDate());
  useEffect(() => {
    void getServerCivilToday().then(setToday).catch(() => undefined);
  }, []);
  return today;
}

function LoanProfitPeriodsPanel({ cycle, bankAccounts, onSaved, onError }: { cycle: Cycle; bankAccounts: BankAccount[]; onSaved: () => Promise<void>; onError: (error: unknown) => void }) {
  const [preview, setPreview] = useState<LoanProfitPeriodsPreview | null>(null);
  const [distributions, setDistributions] = useState<LoanProfitPeriodDistribution[]>([]);
  const [allocations, setAllocations] = useState<LoanProfitPeriodAllocation[]>([]);
  const [payFrom, setPayFrom] = useState<MoneySheetLocation>({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: bankAccounts[0]?.id ?? '' });
  const [paidDate, setPaidDate] = useState(todayCivilDate());
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const serverToday = useServerCivilToday();
  const beforeClose = serverToday < cycle.closes_on;
  const current = distributions.find((item) => item.status !== 'reversed');
  const shown = current?.snapshot ?? preview;

  const reload = async () => {
    const list = await listLoanProfitPeriodDistributions(cycle.id);
    setDistributions(list);
    const active = list.find((item) => item.status !== 'reversed');
    setAllocations(active ? await listLoanProfitPeriodAllocations(active.id) : []);
  };
  useEffect(() => {
    void reload().catch(() => undefined);
  }, [cycle.id]);

  async function run(action: () => Promise<unknown>) {
    setFormError('');
    setPending(true);
    try {
      await action();
    } catch (error) {
      setFormError(userSafeError(error));
      onError(error);
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    await runPendingFinancialAction({
      scope: `loan-profit-periods:confirm:${cycle.id}`,
      payload: { cycleId: cycle.id, cutDate: cycle.closes_on, previewHash: preview.preview_hash },
      setPending,
      onSaved: async () => { setPreview(null); await reload(); await onSaved(); },
      onError: (error) => { setFormError(userSafeError(error)); onError(error); },
      action: (idempotencyKey) => confirmLoanProfitPeriods({ cycleId: cycle.id, cutDate: cycle.closes_on, idempotencyKey, previewHash: preview.preview_hash })
    });
  }

  async function payOne(allocation: LoanProfitPeriodAllocation) {
    const payload = { allocationId: allocation.id, paidDate, liquidityLocation: payFrom.location, bankAccountId: payFrom.location === 'bank' ? payFrom.bankAccountId : null, reference };
    await runPendingFinancialAction({
      scope: `loan-profit-periods:pay-one:${allocation.id}`,
      payload,
      setPending,
      onSaved: async () => { await reload(); await onSaved(); },
      onError: (error) => { setFormError(userSafeError(error)); onError(error); },
      action: (idempotencyKey) => payLoanProfitAllocation({ ...payload, idempotencyKey })
    });
  }

  async function pay() {
    if (!current) return;
    const payload = { distributionId: current.id, paidDate, liquidityLocation: payFrom.location, bankAccountId: payFrom.location === 'bank' ? payFrom.bankAccountId : null, reference };
    await runPendingFinancialAction({
      scope: `loan-profit-periods:pay:${current.id}`,
      payload,
      setPending,
      onSaved: async () => { await reload(); await onSaved(); },
      onError: (error) => { setFormError(userSafeError(error)); onError(error); },
      action: (idempotencyKey) => payLoanProfitPeriods({ ...payload, idempotencyKey })
    });
  }

  return (
    <div className="polla-block">
      <div className="section-head"><h3>Reparto por periodos</h3>{current ? <StatusChip tone={current.status === 'paid' ? 'paid' : 'soon'}>{current.status === 'paid' ? 'Pagado' : 'Por pagar'}</StatusChip> : null}</div>
      <div className="list-card step-card">
        <div className="sheet-form">
          <p className="muted">De cada interés cobrado, el 10 % ya es del administrador. Del 90 % restante se cubre primero el 12 % EA de quienes solo ahorran y lo que queda se divide igual entre los socios de polla que estaban ese día. Quien se retiró conserva lo que le tocó hasta su retiro y se le paga ahora.</p>
          {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
          {!current ? <Button type="button" variant="quiet" disabled={pending} onClick={() => void run(async () => setPreview(await previewLoanProfitPeriods(cycle.id, cycle.closes_on)))}>{pending ? 'Calculando...' : `Calcular al ${formatShortDate(cycle.closes_on)}`}</Button> : null}
          {shown ? (
            <>
              <div className="breakdown">
                <div className="value-row"><span>Fondo de socios (90 % de intereses cobrados)</span><strong>{formatCop(shown.fund_total)}</strong></div>
                <div className="value-row"><span>12 % EA de quienes solo ahorran</span><strong className="tone-late">−{formatCop(shown.ea_obligation)}</strong></div>
                {shown.no_beneficiary ? <div className="value-row"><span>Sin beneficiario</span><strong>{formatCop(shown.no_beneficiary)}</strong></div> : null}
                <div className="value-row"><span>Para socios de polla</span><strong className="tone-in">{formatCop(shown.collective_total)}</strong></div>
                {shown.frozen_total ? <div className="value-row"><span>De ese total, a retirados (congelado al retiro)</span><strong>{formatCop(shown.frozen_total)}</strong></div> : null}
              </div>
              {shown.admin_cover ? <div className="value-row value-row-soft"><span>Faltante del 12 % EA cubierto por el fondo del administrador</span><strong>{formatCop(shown.admin_cover)}</strong></div> : null}
              {shown.remaining_shortfall ? <InlineNotice tone="danger">Faltan {formatCop(shown.remaining_shortfall)} para el 12 % EA aun usando todo el fondo del administrador ({formatCop(shown.admin_available ?? 0)}). No se puede confirmar.</InlineNotice> : null}
              {shown.unverified_fund_sources ? <InlineNotice tone="warning">{formatCop(shown.unverified_fund_sources)} entraron al fondo de socios sin un cobro de préstamo verificable. Concílialos antes de confirmar.</InlineNotice> : null}
              {shown.no_beneficiary ? <InlineNotice tone="neutral">{formatCop(shown.no_beneficiary)} se cobraron cuando no había socios elegibles: quedan en el fondo sin repartir.</InlineNotice> : null}
              {shown.unresolved_settlements ? <InlineNotice tone="warning">{shown.unresolved_settlements} cuenta final(es) anteriores no guardaron la utilidad congelada. Concílialas antes de confirmar.</InlineNotice> : null}
              {shown.previous_distributions ? <InlineNotice tone="warning">Este ciclo ya tiene un reparto con las reglas anteriores.</InlineNotice> : null}
              <ul className="list-card">
                {shown.beneficiaries.map((row) => (
                  <li key={row.cycle_member_id} className="value-row">
                    <Avatar name={row.display_name} />
                    <span className="row-main"><strong>{row.display_name}</strong><span className="row-sub">{row.frozen_at_withdrawal ? 'Retirado · derecho congelado' : 'Activo al cierre'}</span></span>
                    <span className="row-end">
                      <span className="row-amount">{formatCop(row.amount)}</span>
                      {(() => {
                        const allocation = allocations.find((item) => item.cycle_member_id === row.cycle_member_id);
                        if (!allocation || new Decimal(allocation.amount).lte(0)) return null;
                        return allocation.paid_operation_id
                          ? <StatusChip tone="paid">{`Pagado ${allocation.paid_date ? formatDayMonth(allocation.paid_date) : ''}`}</StatusChip>
                          : <button type="button" className="pill-button" disabled={pending || (payFrom.location === 'bank' && !payFrom.bankAccountId)} onClick={() => void payOne(allocation)}>Pagar</button>;
                      })()}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {!current && preview ? (
            <>
              {beforeClose ? <InlineNotice tone="neutral">Se confirma el {formatShortDate(cycle.closes_on)}.</InlineNotice> : null}
              <Button type="button" disabled={pending || beforeClose || !preview.confirmation_allowed} onClick={() => void confirm()}>Confirmar reparto</Button>
            </>
          ) : null}
          {current?.status === 'confirmed' && !allocations.some((item) => item.paid_operation_id) ? (
            <Button type="button" variant="quiet" disabled={pending} onClick={() => {
              const reason = window.prompt('Motivo de la corrección (por ejemplo: interés mal registrado):');
              if (!reason) return;
              void run(async () => { await reverseLoanProfitPeriods(current.id, makeIdempotencyKey(), reason); await reload(); await onSaved(); });
            }}>Deshacer reparto para corregir</Button>
          ) : null}
          {current?.status === 'confirmed' ? (
            <>
              <LocationPicker value={payFrom} onChange={setPayFrom} bankAccounts={bankAccounts} disabled={pending} />
              <label>Fecha del pago<input type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} disabled={pending} /></label>
              <label>Referencia<input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} /></label>
              <Button type="button" disabled={pending || (payFrom.location === 'bank' && !payFrom.bankAccountId)} onClick={() => void pay()}>Pagar a todos los pendientes</Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProfitDistributionPanel({
  cycle,
  cycleMembers,
  bankAccounts,
  ledgerEntries,
  distributions,
  payments,
  policies,
  allocations,
  onBack,
  onSaved,
  onError
}: {
  cycle: Cycle;
  cycleMembers: CycleMember[];
  bankAccounts: BankAccount[];
  ledgerEntries: LedgerEntry[];
  distributions: LoanProfitDistribution[];
  payments: LoanProfitDistributionPayment[];
  policies: LoanProfitDistributionPolicy[];
  allocations: LoanProfitDistributionAllocation[];
  onBack?: () => void;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [cutDate, setCutDate] = useState(todayCivilDate());
  const [policyVersion, setPolicyVersion] = useState(() => policies.find((item) => item.approved)?.policy_version ?? `reparto-${cycle.year}`);
  const [policyDescription, setPolicyDescription] = useState('Partes iguales entre socios que participan en la ganancia de préstamos de los socios');
  const [costs, setCosts] = useState('0');
  const [committedYield, setCommittedYield] = useState('0');
  const [reserve, setReserve] = useState('0');
  const [preview, setPreview] = useState<ProfitDistributionPreview | null>(null);
  const [payTarget, setPayTarget] = useState<LoanProfitDistribution | null>(null);
  const [paidDate, setPaidDate] = useState(todayCivilDate());
  const [payFrom, setPayFrom] = useState<MoneySheetLocation>({ location: bankAccounts.length ? 'bank' : 'cash', bankAccountId: bankAccounts[0]?.id ?? '' });
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);

  const fund = new Decimal(0).minus(ledgerEntries.filter((entry) => entry.account === 'member_loan_profit_fund').reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0)));
  const approved = policies.some((item) => item.policy_version === policyVersion && item.approved);
  const active = distributions.filter((item) => item.status !== 'reversed').sort((left, right) => right.cut_date.localeCompare(left.cut_date));
  const latest = active[0];
  const unpaid = active.filter((item) => item.status === 'confirmed');
  const latestAllocations = latest ? allocations.filter((item) => item.distribution_id === latest.id) : [];
  const membersById = new Map(cycleMembers.map((item) => [item.id, item]));
  const eligibleCount = cycleMembers.filter((item) => item.participates_in_loan_profit).length;
  const stepState = (index: number): 'done' | 'current' | 'todo' => {
    const done = [approved, Boolean(preview) || Boolean(latest), Boolean(latest), Boolean(latest) && unpaid.length === 0 && latest.status === 'paid'];
    if (done[index]) return 'done';
    return done.slice(0, index).every(Boolean) ? 'current' : 'todo';
  };
  const money = (value: string, label: string) => toDatabaseMoney(parseCop(value || '0', label));

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setFormError('');
    setPending(true);
    try {
      await action();
      after?.();
    } catch (error) {
      setFormError(userSafeError(error));
      onError(error);
    } finally {
      setPending(false);
    }
  }

  function amounts() {
    return { costsAmount: money(costs, 'costos'), committedYieldAmount: money(committedYield, 'rendimiento ya prometido'), reserveAmount: money(reserve, 'reserva') };
  }

  async function confirmDistribution() {
    if (!preview) return;
    let payload: Record<string, string>;
    try {
      payload = { cycleId: cycle.id, cutDate, policyVersion, ...amounts(), previewHash: preview.preview_hash };
    } catch (error) {
      setFormError(userSafeError(error));
      return;
    }
    await runPendingFinancialAction({
      scope: `profit:confirm:${cycle.id}:${policyVersion}`,
      payload,
      setPending,
      onSaved: async () => {
        setPreview(null);
        await onSaved();
      },
      onError: (error) => {
        setFormError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => confirmLoanProfitDistribution({ cycleId: cycle.id, cutDate, policyVersion, costsAmount: payload.costsAmount, committedYieldAmount: payload.committedYieldAmount, reserveAmount: payload.reserveAmount, previewHash: payload.previewHash, idempotencyKey })
    });
  }

  async function payDistribution() {
    if (!payTarget) return;
    const payload = { distributionId: payTarget.id, paidDate, liquidityLocation: payFrom.location, bankAccountId: payFrom.location === 'bank' ? payFrom.bankAccountId : null, reference };
    await runPendingFinancialAction({
      scope: `profit:pay:${payTarget.id}`,
      payload,
      setPending,
      onSaved: async () => {
        setPayTarget(null);
        await onSaved();
      },
      onError: (error) => {
        setFormError(userSafeError(error));
        onError(error);
      },
      action: (idempotencyKey) => payLoanProfitDistribution({ ...payload, idempotencyKey })
    });
  }

  const allocationTone = (status: string) => status === 'paid' ? { tone: 'paid', label: 'Pagado' } : status === 'reversed' ? { tone: 'cancelled', label: 'Revertido' } : { tone: 'soon', label: 'Por pagar' };

  return (
    <section className="profit-page more-page" aria-labelledby="utilidad-titulo">
      <div className="hero-band">
        <div className="hero-band-top">
          <div>
            <HeroBack onClick={onBack} />
            <p className="hero-eyebrow">Ganancia de préstamos de los socios</p>
            <h2 id="utilidad-titulo">Ganancia de préstamos de los socios</h2>
          </div>
        </div>
        <div className="hero-figure">
          <span>{preview ? `Para repartir entre ${preview.eligible_count} socios` : latest ? 'Último reparto' : 'Ganancia de préstamos acumulada'}</span>
          <strong>{formatCop(preview ? preview.distributable : latest ? latest.distributable_amount : fund)}</strong>
        </div>
        <div className="hero-chips">
          <span>Fondo {formatCop(fund)}</span>
          <span>{eligibleCount} socios participan</span>
          {preview ? <span>{formatCop(preview.per_member)} c/u</span> : null}
        </div>
      </div>

      {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}

      {cycle.settlement_rules_version === 'fin03-2026' ? <LoanProfitPeriodsPanel cycle={cycle} bankAccounts={bankAccounts} onSaved={onSaved} onError={onError} /> : null}

      {cycle.settlement_rules_version !== 'fin03-2026' ? <div className="list-card step-card">
        <StepList steps={[
          {
            label: 'Reglas del reparto',
            detail: approved ? `Aprobadas: ${policyVersion}` : 'Define qué sale del fondo antes de repartir.',
            state: stepState(0),
            content: (
              <div className="sheet-form">
                <label>Nombre de las reglas<input value={policyVersion} onChange={(event) => { setPolicyVersion(event.target.value); setPreview(null); }} disabled={pending} /></label>
                {!approved ? <label>Descripción<input value={policyDescription} onChange={(event) => setPolicyDescription(event.target.value)} disabled={pending} /></label> : null}
                <div className="form-pair">
                  <label>Costos<CopInput value={costs} onChange={(event) => { setCosts(event.target.value); setPreview(null); }} inputMode="decimal" disabled={pending} /></label>
                  <label>Reserva<CopInput value={reserve} onChange={(event) => { setReserve(event.target.value); setPreview(null); }} inputMode="decimal" disabled={pending} /></label>
                </div>
                <label>Rendimiento ya prometido<CopInput value={committedYield} onChange={(event) => { setCommittedYield(event.target.value); setPreview(null); }} inputMode="decimal" disabled={pending} /></label>
                <small className="field-hint">Costos: gastos de la natillera. Reserva: lo que se guarda para el próximo año. Rendimiento ya prometido: parte del fondo comprometida antes del reparto.</small>
                {!approved ? <Button type="button" variant="quiet" disabled={pending || !policyVersion.trim() || !policyDescription.trim()} onClick={() => void run(async () => { await createLoanProfitDistributionPolicy({ cycleId: cycle.id, policyVersion, description: policyDescription }); await onSaved(); })}>Aprobar reglas</Button> : null}
              </div>
            )
          },
          {
            label: 'Calcular reparto',
            detail: 'Partes iguales entre quienes participan en la ganancia.',
            state: stepState(1),
            content: (
              <div className="sheet-form">
                <FinancialCutField value={cutDate} onChange={(value) => { setCutDate(value); setPreview(null); }} disabled={pending} />
                <Button type="button" variant="quiet" disabled={pending || !policyVersion.trim()} onClick={() => void run(async () => setPreview(await previewLoanProfitDistribution({ cycleId: cycle.id, cutDate, policyVersion, ...amounts() })))}>{pending ? 'Calculando...' : 'Calcular reparto'}</Button>
                {preview ? (
                  <div className="breakdown">
                    <div className="value-row"><span>Fondo reconocido</span><strong>{formatCop(preview.recognized_fund)}</strong></div>
                    <div className="value-row"><span>Para repartir</span><strong>{formatCop(preview.distributable)}</strong></div>
                    <div className="value-row"><span>Socios que participan</span><strong>{preview.eligible_count}</strong></div>
                    <div className="value-row"><span>Por socio</span><strong>{formatCop(preview.per_member)}</strong></div>
                    {preview.rounding_residual ? <div className="value-row"><span>Residuo de redondeo</span><strong>{formatCop(preview.rounding_residual)}</strong></div> : null}
                    <div className="value-row"><span>Liquidez disponible</span><strong>{formatCop(preview.liquidity_available)}</strong></div>
                    {preview.liquidity_deficit ? <div className="value-row"><span>Falta liquidez</span><strong className="tone-late">{formatCop(preview.liquidity_deficit)}</strong></div> : null}
                  </div>
                ) : null}
              </div>
            )
          },
          {
            label: 'Confirmar',
            detail: 'Queda fijo y ya no cambia.',
            state: stepState(2),
            content: preview ? (
              <div className="sheet-form">
                {!preview.policy_approved ? <InlineNotice tone="warning">Primero aprueba las reglas del reparto.</InlineNotice> : null}
                {preview.policy_approved && !preview.confirmation_allowed ? <InlineNotice tone="warning">No se puede confirmar con estos valores. Revisa la liquidez y los montos.</InlineNotice> : null}
                <Button type="button" disabled={pending || !preview.confirmation_allowed} onClick={() => void confirmDistribution()}>Confirmar reparto</Button>
              </div>
            ) : undefined
          },
          {
            label: 'Pagar',
            detail: unpaid.length ? `${unpaid.length} ${unpaid.length === 1 ? 'reparto' : 'repartos'} por pagar` : 'Se registra la salida de caja.',
            state: stepState(3),
            content: unpaid.length ? (
              <div className="sheet-form">
                {unpaid.map((item) => (
                  <Button key={item.id} type="button" onClick={() => { setFormError(''); setReference(''); setPaidDate(todayCivilDate()); setPayTarget(item); }}>Pagar {formatCop(item.payment_amount)} · {item.policy_version}</Button>
                ))}
              </div>
            ) : undefined
          }
        ]} />
      </div> : null}

      {latest ? (
        <div className="polla-block">
          <div className="section-head"><h3>Reparto por socio</h3><span className="muted">Corte {formatShortDate(latest.cut_date)}</span></div>
          <ul className="list-card">
            {latestAllocations.map((allocation) => {
              const name = membersById.get(allocation.cycle_member_id)?.member?.display_name ?? 'Socio';
              const info = allocationTone(allocation.status);
              return (
                <li key={allocation.id} className="value-row">
                  <Avatar name={name} />
                  <span className="row-main"><strong>{name}</strong></span>
                  <span className="row-end"><span className="row-amount">{formatCop(allocation.amount)}</span><StatusChip tone={info.tone}>{info.label}</StatusChip></span>
                </li>
              );
            })}
          </ul>
          {payments.length ? <p className="muted">Último pago: {formatCop(payments[0].amount)} el {formatShortDate(payments[0].paid_date)}{payments[0].reference ? ` · ${payments[0].reference}` : ''}</p> : null}
        </div>
      ) : null}

      {payTarget ? (
        <Sheet title="Pagar reparto de ganancias" onClose={() => setPayTarget(null)}>
          <div className="sheet-form">
            <div className="total-row"><span>Total a pagar</span><strong>{formatCop(payTarget.payment_amount)}</strong></div>
            {formError ? <InlineNotice tone="danger">{formError}</InlineNotice> : null}
            <LocationPicker value={payFrom} onChange={setPayFrom} bankAccounts={bankAccounts} disabled={pending} />
            <label>Fecha del pago<input type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} disabled={pending} /></label>
            <label>Referencia<input value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} /></label>
            <Button type="button" onClick={() => void payDistribution()} disabled={pending || (payFrom.location === 'bank' && !payFrom.bankAccountId)}>{pending ? 'Guardando...' : 'Registrar pago'}</Button>
          </div>
        </Sheet>
      ) : null}
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

const LAST_BACKUP_KEY='natillera:last-backup-at';
type DownloadState='idle'|'preparing'|'success'|'error';
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
  onBack
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
  onBack?: () => void;
}) {
  const [jsonState, setJsonState] = useState<DownloadState>('idle');
  const [csvState, setCsvState] = useState<DownloadState>('idle');
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

  async function runDownload(kind: 'json' | 'csv') {
    const setState = kind === 'json' ? setJsonState : setCsvState;
    setState('preparing');
    setError('');
    try {
      if (kind === 'json') {
        const backup = await exportNatilleraBackup(workspace.id);
        triggerDownload({
          contents: JSON.stringify(backup, null, 2),
          mimeType: 'application/json;charset=utf-8',
          fileName: `natillera-${cycle.year}-${fileTimestamp()}-respaldo-abcd.json`
        });
        window.localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
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
      }
      setState('success');
    } catch (caught) {
      setError(userSafeError(caught));
      setState('error');
    }
  }

  const lastBackup = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_BACKUP_KEY) : null;
  const tiles = [
    { label: 'Socios', value: cycleMembers.length, tone: 'quick-green', icon: 'M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6' },
    { label: 'Aportes', value: contributions.length, tone: 'quick-green', icon: 'M12 5v14M5 12h14' },
    { label: 'Préstamos', value: loans.length, tone: 'quick-blue', icon: 'M5 9h13l-3-3M19 15H6l3 3' },
    { label: 'Pollas', value: pollaActivities.length, tone: 'quick-violet', icon: 'M12 4a8 8 0 100 16 8 8 0 000-16z' },
    { label: 'Premios', value: pollaPrizes.length, tone: 'quick-amber', icon: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z' },
    { label: 'Movimientos', value: operations.length, tone: 'quick-gray', icon: 'M4 6h16M4 12h16M4 18h10' }
  ].filter((tile) => tile.value > 0);
  void counts;

  return (
    <section className="exports-page more-page" aria-labelledby="respaldos-titulo">
      <div className="page-heading">
        <div className="page-heading-copy">
          {onBack ? <button type="button" className="link-button" onClick={onBack}>‹ Más</button> : null}
          <h2 id="respaldos-titulo">Respaldos</h2>
        </div>
      </div>
      <div className="hero-band backup-card">
        <div className="backup-head">
          <span className="quick-icon hero-icon"><QuickIcon path="M12 4v11M7 10l5 5 5-5M5 20h14" /></span>
          <div>
            <h3>Respaldo de la natillera</h3>
            <p className="hero-eyebrow">{lastBackup ? `Último respaldo: ${formatShortDate(todayCivilDate(new Date(lastBackup)))}` : 'Nunca has descargado un respaldo'}</p>
          </div>
        </div>
        <p className="backup-copy">Guarda los datos de todos los ciclos de esta natillera en un archivo. Para recuperar también los accesos y los archivos adjuntos necesitas el respaldo integral protegido del administrador.</p>
        <button type="button" className="hero-solid-button" onClick={() => void runDownload('json')} disabled={jsonState === 'preparing'}>{jsonState === 'preparing' ? 'Preparando...' : 'Descargar respaldo'}</button>
      </div>
      <div className="list-card value-row csv-card">
        <span className="quick-icon quick-blue csv-badge">CSV</span>
        <span className="row-main"><strong>Reporte para Excel</strong><span className="row-sub">Para revisar o compartir. No sirve para restaurar.</span></span>
        <Button type="button" variant="quiet" onClick={() => void runDownload('csv')} disabled={csvState === 'preparing'}>{csvState === 'preparing' ? 'Preparando...' : 'Descargar reporte CSV'}</Button>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      <details className="list-card backup-inventory"><summary>Qué incluye el respaldo</summary>
      <div className="count-grid">
        {tiles.map((tile) => (
          <div key={tile.label} className="count-tile">
            <span className={`quick-icon ${tile.tone} count-icon`}><QuickIcon path={tile.icon} /></span>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>
      </details>
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
