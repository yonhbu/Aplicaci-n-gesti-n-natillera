import Decimal from 'decimal.js';
import type {SettlementPreview} from '../data/blockC';
import type {LoanContract,MemberCapitalCredit,PollaActivity,PollaPrize} from '../lib/types';
import {formatCop} from '../domain/money';
import {pollaLabel} from './pollaLabel';

const dateLabel=(value:string)=>new Intl.DateTimeFormat('es-CO',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));

/** Amounts in the calculation always come from the server snapshot; metadata only explains them. */
export function SettlementDetails({snapshot,loans,prizes,activities,credits,memberId,cutDate}:{
  snapshot:SettlementPreview;loans:LoanContract[];prizes:PollaPrize[];activities:PollaActivity[];
  credits:MemberCapitalCredit[];memberId:string;cutDate:string;
}){
  const debts=snapshot.debt_items??[];
  const rows=[
    ['Aportes',formatCop(new Decimal(snapshot.capital).minus(snapshot.capital_credits??0),2),''],
    ['Premios y rendimiento bancario acreditados','+'+formatCop(snapshot.capital_credits??0,2),'tone-in'],
    [snapshot.yield_policy==='bank_yield_equal_share'?'Rendimiento Pibank hasta el corte':'Rendimiento 12 % EA','+'+formatCop(snapshot.recognized_yield,2),'tone-in'],
    ['Premios pendientes por acreditar','+'+formatCop(snapshot.pending_net_prizes,2),'tone-in'],
    ['Préstamos pendientes','−'+formatCop(snapshot.debts,2),'tone-late'],
    ['Cuota de administración','−'+formatCop(snapshot.annual_admin_fee,2),'tone-late'],
    ['Multa por retiro','−'+formatCop(snapshot.penalty,2),'tone-late'],
    ['Otros descuentos','−'+formatCop(snapshot.other_discounts,2),'tone-late'],
    ...(new Decimal(snapshot.completion_received??0).gt(0)?[['Consignaciones para completar la cuenta final','+'+formatCop(snapshot.completion_received??0,2),'tone-in']]:[]),
  ];
  const prizeHistory=prizes.filter(p=>p.winner_cycle_member_id===memberId);
  return <>
    <div className="breakdown" aria-label="Desglose de la cuenta final">
      {rows.map(([label,value,tone])=><div key={label} className="value-row"><span>{label}</span><strong className={tone}>{value}</strong></div>)}
    </div>
    {debts.length>0?<section className="settlement-detail-list" aria-label="Préstamos incluidos en la cuenta final">
      <h3>Préstamos incluidos</h3>
      {debts.map(item=>{const loan=loans.find(l=>l.id===item.loan_id);return <div className="settlement-detail-item" key={item.loan_id}>
        <strong>{loan?.legacy_id??`Préstamo ${item.loan_id.slice(0,8)}`}</strong>
        {loan?.legacy_note?<span className="muted">{loan.legacy_note}</span>:null}
        <div className="value-row"><span>Capital pendiente</span><strong>{formatCop(item.principal_amount,2)}</strong></div>
        <div className="value-row"><span>Interés acordado{loan?.settlement_agreement_code==='P013_FIRST_MONTH'?' · primer mes P013':''}</span><strong>{formatCop(item.interest_amount,2)}</strong></div>
        <div className="value-row"><span>Total de este préstamo</span><strong>{formatCop(new Decimal(item.principal_amount).plus(item.interest_amount),2)}</strong></div>
      </div>;})}
    </section>:null}
    {prizeHistory.length>0?<section className="settlement-detail-list" aria-label="Premios y fecha de corte">
      <h3>Premios y fecha de corte</h3>
      <p className="muted">El corte incluye derechos con fecha efectiva hasta {dateLabel(cutDate)}. Los premios posteriores se muestran para explicar la diferencia y no se suman al neto.</p>
      {prizeHistory.map(prize=>{
        const credit=credits.find(c=>c.prize_id===prize.id);
        const includedCredit=credit&&snapshot.credit_items?.some(c=>c.credit_id===credit.id);
        const includedPending=snapshot.prize_items?.some(p=>p.prize_id===prize.id);
        const effective=credit?.effective_date??prize.awarded_at;
        const status=includedCredit?'Incluido como capital':includedPending?'Incluido como premio pendiente':prize.status==='reversed'?'Revertido':credit?.reversed_at?'Acreditación revertida':effective&&effective>cutDate?'Después del corte · no incluido':prize.legacy_payment_status==='historical_payment_unverified'?'Registrado al corte inicial':prize.status==='paid'?'Ya pagado · no se entrega de nuevo':prize.status==='settled'?'Compensado en cuenta final': 'No incluido en este corte';
        return <div className="settlement-detail-item" key={prize.id}>
          <strong>{(()=>{const activity=activities.find(a=>a.id===prize.activity_id);return activity?pollaLabel(activity.name,activity.period_month):`Premio ${prize.id.slice(0,8)}`;})()}</strong>
          <div className="value-row"><span>Neto del premio</span><strong>{formatCop(prize.net_amount,2)}</strong></div>
          <span>{effective?`Fecha efectiva: ${dateLabel(effective)}`:'Fecha efectiva sin verificar'}</span>
          <span className="settlement-item-status">{status}</span>
        </div>;
      })}
    </section>:null}
  </>;
}
