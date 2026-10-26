import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import Decimal from 'decimal.js';
import type {Cycle,CycleMember,FinancialOperation,LedgerEntry,LoanContract,LoanPayment,LoanSchedule,MemberCapitalCredit,MemberSettlement,SavingsContribution} from '../lib/types';
import {previewMemberSettlement,type SettlementPreview,type AdminWithdrawalPreview} from '../data/blockC';
import {formatCop} from '../domain/money';
import {adminPosition} from '../domain/adminPosition';
import {loanLedgerPrincipalAtCut} from '../domain/loanPosition';
import {userSafeError} from '../lib/userMessages';
import {memberInsight,futureLoanScenario,potentialAnnualFees,projectionTarget,closingAdminEstimate} from './insightModels';
import {useFinancialCut,FinancialCutPicker} from './FinancialCut';
import {displayDate} from './displayDate';
interface InsightData {cycle:Cycle;members:CycleMember[];contributions:SavingsContribution[];credits:MemberCapitalCredit[];settlements:MemberSettlement[];operations:FinancialOperation[];entries:LedgerEntry[];loans:LoanContract[];payments:LoanPayment[];schedules:LoanSchedule[];onLoans:()=>void;onSavings:(memberId:string)=>void;onMembers:()=>void;onMovements:()=>void}
const Context=createContext<InsightData|null>(null);
export function FinancialInsights({data,children}:{data:InsightData;children:ReactNode}){return <Context.Provider value={data}>{children}</Context.Provider>}
function Value({label,value,help,estimated=false}:{label:string;value:Decimal.Value|null;help?:string;estimated?:boolean}){return <div className={'insight-value'+(estimated?' insight-estimate':'')}><span>{label}</span><strong>{value===null?'No verificable':formatCop(new Decimal(value).isZero()?0:new Decimal(value),2)}</strong>{help?<small>{help}</small>:null}</div>}

export function MemberSavingsInsight({item}:{item:CycleMember}){
 const data=useContext(Context)!;const {cutDate}=useFinancialCut();const [preview,setPreview]=useState<{cut:SettlementPreview;close:SettlementPreview}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const model=memberInsight(data.cycle,item,data.contributions,data.credits,data.settlements,data.operations,data.entries,cutDate),target=projectionTarget(data.cycle);
 useEffect(()=>{let cancelled=false;setPreview(null);setError('');
  if(model.uncertain)return;
  const read=(cutDate:string)=>previewMemberSettlement({cycleMemberId:item.id,cutDate,annualAdminFee:'0',penaltyAmount:'0',otherDiscounts:'0'});
  const request=model.settlement?Promise.resolve({cut:model.settlement.snapshot as unknown as SettlementPreview,close:model.settlement.snapshot as unknown as SettlementPreview}):Promise.all([read(model.effectiveCut),read(target)]).then(([cut,close])=>({cut,close}));
  void request.then(v=>{if(!cancelled)setPreview(v)}).catch(e=>{if(!cancelled)setError(userSafeError(e))});return()=>{cancelled=true};
 },[item.id,model.effectiveCut,model.settlement?.id,model.uncertain,target,retry,data.operations,data.contributions]);
 const laterActivity=data.operations.some(o=>o.effective_date>cutDate);
 const debt=data.loans.filter(l=>l.borrower_member_id===item.member_id).reduce((sum,loan)=>sum.plus(loanLedgerPrincipalAtCut(loan,data.operations,data.entries,cutDate)),new Decimal(0));
 return <div className="sheet-form member-insight">
  <div><h3>Ahorro y beneficios del socio</h3><p className="insight-tags"><span className="tag">{model.collective?'A · Polla y rendimientos':'B · Solo ahorro'}</span><span className="tag">{model.settlement?'Retiro verificado':model.uncertain?'Retiro sin fecha verificable':item.savings_status==='active'?'Estado actual: activo':'Estado actual: inactivo'}</span></p></div>
  <FinancialCutPicker/>
  <p className="summary-note">Consulta al {displayDate(cutDate)}{model.settlement?` · Derechos detenidos al ${displayDate(model.effectiveCut)}`:''}.</p>
  <div className="insight-grid">
   <Value label="Ahorro total a su favor" value={model.recognized} help="Obligaciones registradas pendientes, después de compensaciones y pagos. No es una cotización de retiro."/>
   <Value label="Aportes ordinarios recibidos" value={model.ordinary} help="Ahorrado hasta el corte; excluye premios."/>
   <Value label="Premios netos acreditados" value={model.prizes}/><Value label="Pibank acreditado" value={model.bank} help={model.collective?'Crédito individual ya registrado.':'Sin nuevos repartos Pibank en modalidad B.'}/>
  </div>
  <details className="insight-details"><summary>Conciliar ahorro y créditos reconocidos</summary><p>Aportes + premios + Pibank acreditado: <strong>{formatCop(model.credited,2)}</strong>. Es el acumulado recibido; los pagos, compensaciones y obligaciones de liquidación explican su diferencia frente al saldo pendiente.</p><p>El total pendiente suma únicamente partidas individuales de ahorro, Pibank, cuentas finales y utilidades por pagar. No incluye estimaciones ni repartos sin confirmar.</p><div className="insight-grid"><Value label="Otras utilidades reconocidas pendientes" value={model.recognizedByAccount.utility_distribution_payable}/><Value label="Premios por entregar, aún no acreditados" value={preview?.cut.pending_net_prizes??null}/></div>{model.settlement?<p>Cuenta final confirmada: {formatCop(model.settlement.net_amount,2)}. Estado actual: {model.settlement.status==='paid'?'pagada':'pendiente de pago'}. Utilidad congelada: {model.settlement.snapshot.loan_profit_frozen==null?'No verificable':formatCop(String(model.settlement.snapshot.loan_profit_frozen),2)}; su pago se revisa en Ganancias de préstamos.</p>:null}</details>
  <h4>Cuotas y meta de aportes</h4><p className="summary-note">Cuota mensual {formatCop(item.monthly_quota,2)} · participación registrada {item.participation_start_month}–{item.participation_end_month} de {data.cycle.year}. Referencia de cuota vigente; no existe historial versionado.</p>
  {model.uncertain?<p role="status" className="inline-notice inline-notice-warning">Falta fecha efectiva de retiro. Se conservan aportes y créditos comprobados; metas y proyección quedan no verificables. No se usa el último aporte como fecha de retiro.</p>:null}
  <div className="insight-grid"><Value label="Meta del año" value={model.goal}/><Value label="Debería llevar al corte" value={model.due}/><Value label="Faltan por ahorrar" value={model.missing}/><Value label="Aportes adicionales si completa la meta" value={model.uncertain?null:model.additional} estimated help={`Estimado al ${displayDate(target)}, sin registrar cobros ni suponer fechas de aportes futuros.`}/></div>
  <h4>Beneficios y posible cierre</h4><p>{model.collective?'Participa en polla y rendimientos según su periodo efectivo. No recibe 12 % EA. Solo se reconocen utilidades de préstamos cobrados durante su participación.':'Recibe 12 % EA proporcional según aportes y fechas. No participa en utilidades colectivas ni nuevos repartos Pibank.'}</p>
  {model.uncertain?<p className="muted">Beneficios históricos: requieren liquidación verificable.</p>:error?<div role="alert"><p>{error}</p><button type="button" className="button button-secondary" onClick={()=>setRetry(v=>v+1)}>Reintentar beneficios</button></div>:!preview?<p role="status">Consultando beneficios…</p>:<div className="insight-grid">
   <Value label={model.settlement?'Rendimiento consolidado en cuenta final':model.collective?'Pibank calculado al corte, sin nuevo abono':'12 % EA devengado al corte, sin nuevo abono'} value={preview.cut.recognized_yield} help="Previsualización canónica; reconocimiento y pago son eventos distintos."/>
   <Value label={model.settlement?'Utilidad congelada al retiro':'Utilidad de préstamos al corte, pendiente de reparto'} value={preview.cut.loan_profit_frozen??null} help="No se suma otra vez al ahorro acreditado."/>
   <Value label={model.collective?'Rendimientos calculables al cierre':'12 % EA estimado al cierre'} value={laterActivity&&!model.settlement?null:preview.close.recognized_yield} estimated help="Solo sobre aportes ya registrados. Sin Pibank futuro; sin nuevas cuotas supuestas."/>
   <Value label="Posición neta de cuenta final estimada" value={laterActivity&&!model.settlement?null:preview.close.net} estimated help="Simulación con deudas y descuentos canónicos, no saldo pagado. Utilidad congelada de préstamos se entrega aparte."/>
  </div>}
  {laterActivity&&!model.settlement?<p role="status" className="summary-note">Proyección histórica no verificable: hay movimientos posteriores al corte. La simulación de cierre usa fuentes actuales sin versionado histórico.</p>:null}
  {debt.gt(0)?<div className="value-row"><span>Capital de préstamos propios pendiente</span><strong>{formatCop(debt,2)}</strong></div>:null}
  <div className="insight-actions"><button type="button" className="button button-secondary" onClick={()=>{if(location.hash==='#/savings'){document.querySelector<HTMLDetailsElement>('.member-insight .insight-history')!.open=true;document.querySelector('.member-insight .insight-history')?.scrollIntoView({block:'start'});}else data.onSavings(item.id)}}>Ver ahorro e historial</button><button type="button" className="button button-quiet" onClick={data.onLoans}>Ver préstamos</button></div>
  <details className="insight-details insight-history"><summary>Historial de aportes por mes</summary><ul className="insight-months">{model.byMonth.filter(m=>m.eligible||m.paid.gt(0)).map(m=><li key={m.month}><span>Mes {m.month}</span><strong>{formatCop(m.paid,2)}</strong><small>{m.paid.gte(item.monthly_quota)?'Cuota completa':m.paid.gt(0)?'Parcial':'Sin aporte'}</small></li>)}</ul>
   {model.own.length?<ol className="history-list">{[...model.own].sort((a,b)=>b.effective_date.localeCompare(a.effective_date)).map(c=><li key={c.id}><div><strong>{formatCop(c.amount,2)}</strong><span className="history-meta">Fecha registrada {displayDate(c.effective_date)} · aplicado {c.applied_month}/{c.applied_year} · vigente</span><small>Referencia: {c.idempotency_key}</small><small>{c.source.startsWith('legacy')?'Origen histórico; fecha bancaria individual no acreditada.':'Aporte registrado en el sistema.'}</small></div></li>)}</ol>:<p>Sin aportes ordinarios hasta el corte.</p>}
   {model.ownCredits.length?<ul className="history-list">{model.ownCredits.map(c=><li key={c.id}><div><strong>{c.source_type==='polla_prize'?'Premio acreditado':'Pibank acreditado'} · {formatCop(c.amount,2)}</strong><span className="history-meta">{displayDate(c.effective_date)} · referencia {c.prize_id??c.distribution_id??c.operation_id}</span></div></li>)}</ul>:null}
  </details>
 </div>
}

export function AdminProjection({reserve}:{reserve:AdminWithdrawalPreview|null}){
 const data=useContext(Context)!;const {cutDate}=useFinancialCut();const target=projectionTarget(data.cycle),real=adminPosition(data.operations,data.entries,cutDate);
 const scenario=futureLoanScenario(data.loans,data.payments,data.schedules,data.operations,data.entries,cutDate,target);
 const fees=potentialAnnualFees(data.members,data.settlements,data.operations,data.entries,cutDate,target);
 const [includeFees,setIncludeFees]=useState(true),[includeLoans,setIncludeLoans]=useState(true);
 const feePolicy=data.cycle.settlement_rules_version==='fin03-2026';
 const extra=(includeLoans?scenario.admin:new Decimal(0)).plus(includeFees&&feePolicy?fees.amount:0);
 const uncertain=!reserve||reserve.needs_review||reserve.reserve_through!==target||data.operations.some(o=>o.effective_date>cutDate);
 const {coverage,net,retained}=closingAdminEstimate({earned:real.earned,bookedCoverage:real.totals.coverage,withdrawals:real.totals.withdrawals,additional:extra,futureFund:includeLoans?scenario.fund:new Decimal(0),reserve:reserve?new Decimal(reserve.ea_reserve):null,uncertain});

 return <section className="list-card admin-projection" aria-labelledby="admin-projection-title">
  <div className="card-head"><h3 id="admin-projection-title">Mi ganancia estimada al 5 de diciembre</h3><span className="tag">Estimado</span></div>
  <p className="summary-note">Corte {displayDate(cutDate)} · objetivo {displayDate(target)} · último cálculo {new Date().toLocaleString('es-CO',{timeZone:'America/Bogota'})}. No equivale a saldo retirable.</p>

  <fieldset className="projection-options"><legend>Escenario condicionado</legend><label><input type="checkbox" checked={includeLoans} onChange={e=>setIncludeLoans(e.target.checked)}/> Si se cobran las cuotas futuras verificables</label><label><input type="checkbox" checked={includeFees} onChange={e=>setIncludeFees(e.target.checked)}/> Si se reconoce administración al cierre</label></fieldset>
  <div className="insight-grid"><Value label="Podrías ganar adicionalmente" value={extra} estimated/><Value label="Posible cobertura adicional del 12 % EA" value={coverage} estimated help="El 90 % de cobros futuros cubre primero a B; solo el faltante queda a cargo del administrador."/><Value label="Ganancia neta acumulada estimada al cierre" value={net} estimated/><Value label="Estimado restante después de retiros" value={retained} estimated/></div>
  {scenario.excluded.length?<p role="status" className="summary-note">Escenario parcial: {scenario.excluded.length} contratos no proyectables; consulta las causas en el desglose.</p>:null}
  {uncertain?<p role="status" className="inline-notice inline-notice-warning">Total neto no verificable: falta reserva válida al objetivo, hay conciliación pendiente o movimientos posteriores al corte. El escenario parcial no reconstruye derechos históricos.</p>:null}
  <details className="insight-details"><summary>Supuestos y desglose por origen</summary>
   <div className="value-row"><span>Intereses futuros del cronograma, si se cobran</span><strong>{formatCop(scenario.interest,2)}</strong></div><div className="value-row"><span>10 % administrativo adicional</span><strong>{formatCop(scenario.admin,2)}</strong></div><div className="value-row"><span>90 % para B y utilidad de socios</span><strong>{formatCop(scenario.fund,2)}</strong></div><div className="value-row"><span>Administración potencial: {feePolicy?fees.count:0} socios × $20.000</span><strong>{formatCop(feePolicy?fees.amount:0,2)}</strong></div><div className="value-row"><span>Interés vencido incierto, excluido del escenario base</span><strong>{formatCop(scenario.overdue,2)}</strong></div>
   <p>Sin multas futuras, retiros anticipados supuestos, premios futuros ni Pibank como ingreso administrativo. Comisiones y multas ya causadas permanecen en el panel real. No se registra ninguna reserva, cuota ni derecho al consultar.</p><p>El escenario conserva las aplicaciones y métodos del cronograma vigente; no calcula interés sobre principal original. No incorpora nuevos aportes B sin fechas, nuevos préstamos ni cobros vencidos. La cobertura puede cambiar si llegan nuevos ahorros.</p>
   {!feePolicy?<p role="status">Administración potencial no proyectada: la política automática FIN-03 no está activada.</p>:null}
   {fees.ambiguous?<p role="status">Administración no proyectable: hay reconocimientos sin socio identificable; se evita duplicarlos.</p>:null}
   {scenario.included.length?<ul className="projection-schedules">{scenario.included.map(r=><li key={r.schedule.id}><strong>{r.loan.borrower?.display_name??r.loan.external_borrower_name??r.loan.legacy_id??'Préstamo'}</strong><span>{displayDate(r.schedule.due_date)} · {r.loan.method} · interés pendiente {formatCop(r.interest,2)} · administración {formatCop(r.admin,2)}</span></li>)}</ul>:<p>No hay cuotas futuras verificables en el intervalo.</p>}
   {scenario.excluded.length?<><h4>No proyectable con los datos actuales</h4><ul>{scenario.excluded.map(r=><li key={r.loan.id}>{r.loan.legacy_id??r.loan.external_borrower_name??'Préstamo'}: {r.reason}.</li>)}</ul></>:null}
   <div className="insight-actions"><button type="button" className="button button-secondary" onClick={data.onLoans}>Ver préstamos</button><button type="button" className="button button-quiet" onClick={data.onMembers}>Ver socios</button><button type="button" className="button button-quiet" onClick={data.onMovements}>Ver movimientos</button></div>
  </details>
 </section>
}
