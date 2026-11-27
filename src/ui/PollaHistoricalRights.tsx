import {formatCop} from '../domain/money';
import './PollaHistoricalRights.css';
import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import type {CycleMember,PollaActivity,PollaContribution} from '../lib/types';

export type HistoricalRight={activity_id:string;cycle_member_id:string;amount:number|string;evidence:string;eligible_on:string;confirmed_by:string;confirmed_at:string};
type Row={cycle_member_id:string;contribution_id:string;amount:number;eligible_on:string;evidence:string};
type Matrix={cycle_ledger_pool:number;unassigned_or_other_year_pool:number;activities:{activity_id:string;month:number;name:string;cancelled:boolean;collected:number;gross_prizes:number;ledger_pool:number;individual_members:number;verified_rights:number}[]};
const knownRejections=new Set(['Sin permiso de conciliación.','La actividad ya tiene premio o está cancelada/cerrada.','Indique atribuciones respaldadas.','Derecho duplicado.','Socio sin participación verificable en Polla.','Recaudo colectivo original no disponible.','El recaudo colectivo no concilia con su operación contable.','Importe inválido o derecho ya reconocido.','Período efectivo sin soporte o posterior al retiro.','Falta respaldo individual de verificación.','Las atribuciones superan el recaudo colectivo disponible.','Clave de confirmación inválida.','Clave usada con otro contenido.','La previsualización cambió; revise nuevamente.']);
export function PollaHistoricalRights({activity,members,contributions,onRights,onSaved}:{activity?:PollaActivity;members:CycleMember[];contributions:PollaContribution[];onRights:(r:HistoricalRight[])=>void;onSaved:()=>Promise<void>}){
 const [rows,setRows]=useState<Row[]>([]),[preview,setPreview]=useState<{preview_hash:string;total:number}|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[key,setKey]=useState('');
 const sources=contributions.filter(c=>c.activity_id===activity?.id&&c.status==='posted'&&c.legacy_collective&&!c.cycle_member_id);
 const [matrix,setMatrix]=useState<Matrix|null>(null);
 const [confirmed,setConfirmed]=useState<HistoricalRight[]>([]);
 async function load(){if(!activity)return;const r=await supabase.from('polla_historical_rights').select('activity_id,cycle_member_id,amount,evidence,eligible_on,confirmed_by,confirmed_at').eq('activity_id',activity.id);if(r.error){setReady(false);throw Error('No se pudieron consultar las atribuciones.');}setConfirmed(r.data??[]);onRights(r.data??[]);setReady(true);}
 useEffect(()=>{let live=true;setConfirmed([]);setMatrix(null);onRights([]);setRows([]);setPreview(null);setReady(false);setError('');if(activity){void supabase.from('polla_historical_rights').select('activity_id,cycle_member_id,amount,evidence,eligible_on,confirmed_by,confirmed_at').eq('activity_id',activity.id).then(r=>{if(!live)return;if(r.error){setError('Conciliación histórica no disponible: migración pendiente o lectura sin permiso.');return;}setConfirmed(r.data??[]);onRights(r.data??[]);setReady(true);});}return()=>{live=false};},[activity?.id,onRights]);
 const change=(next:Row[])=>{setRows(next);setPreview(null);setAccepted(false);setError('');};
 async function run(confirm:boolean){
  if(!activity)return;setBusy(true);setError('');let saved=false,rejected=false,reason='';
  try{
   const result=await supabase.rpc(confirm?'confirm_polla_historical_rights':'preview_polla_historical_rights',{p_activity_id:activity.id,p_rows:rows,...(confirm?{p_preview_hash:preview?.preview_hash,p_key:key}:{})});
   if(result.error){rejected=result.error.code==='P0001';reason=rejected&&knownRejections.has(result.error.message)?result.error.message:'';throw Error('RPC no confirmada');}
   if(confirm){saved=true;setMatrix(null);await load();await onSaved();change([]);}
   else{setPreview(result.data);setKey(crypto.randomUUID());setAccepted(false);}
  }catch{
   setError(saved?'La confirmación se guardó, pero no se pudo actualizar la vista. Recarga para consultar los registros confirmados.':rejected?(reason||'Este intento fue rechazado. Revisa soporte individual, período, duplicados y disponibilidad; vuelve a previsualizar si cambió el estado.'):'No se pudo verificar el resultado. Revisa las atribuciones confirmadas o reintenta el mismo intento sin cambiar el respaldo; no registres otro aporte.');
  }finally{setBusy(false);}
 }
 if(!activity||!sources.length)return null;
 return <details className="list-card polla-history-panel"><summary>Conciliar derechos históricos sin registrar dinero</summary>
  <p>Selecciona únicamente personas cuyo aporte de este mes tenga respaldo. El estado actual de retiro no elimina derechos anteriores. No se modifican caja, bolsa, premios ni liquidaciones.</p>
  <button type="button" disabled={!ready||busy} onClick={()=>{void supabase.rpc('polla_reconciliation_matrix',{p_cycle_id:activity.cycle_id}).then(r=>{if(r.error)setError('No se pudo consultar la matriz contable.');else setMatrix(r.data);});}}>Ver matriz contable del ciclo</button>
  {matrix&&<div><p>Bolsa según ledger: {formatCop(matrix.cycle_ledger_pool)}. Sin vínculo u otro año: {formatCop(matrix.unassigned_or_other_year_pool)}.</p><div style={{overflowX:'auto'}}><table><thead><tr><th>Mes / actividad</th><th>Recaudado</th><th>Premios brutos</th><th>Saldo ledger</th><th>Identificados / derechos</th></tr></thead><tbody>{matrix.activities.map(a=><tr key={a.activity_id}><td>{a.month} · {a.name}{a.cancelled?' · Cancelada':''}</td><td>{formatCop(a.collected)}</td><td>{formatCop(a.gross_prizes)}</td><td>{formatCop(a.ledger_pool)}</td><td>{a.individual_members} / {a.verified_rights}</td></tr>)}</tbody></table></div><p>Un mes ausente no demuestra recaudo. No se completan diciembre ni cuotas faltantes automáticamente.</p></div>}
  {confirmed.length>0&&<details><summary>Ver atribuciones confirmadas ({confirmed.length})</summary><ul>{confirmed.map(r=><li key={r.cycle_member_id}>{members.find(m=>m.id===r.cycle_member_id)?.member?.display_name} · {formatCop(r.amount)} · participación {r.eligible_on} · {r.evidence} · confirmado por {r.confirmed_by} el {new Date(r.confirmed_at).toLocaleString('es-CO',{timeZone:'America/Bogota'})}</li>)}</ul></details>}
  {error&&<p role="alert">{error}</p>}
  {ready&&activity.status==='open'&&!activity.cancelled_at&&<fieldset disabled={busy}>
   <legend>Respaldo individual de participación</legend>
   {members.map(m=>{const row=rows.find(r=>r.cycle_member_id===m.id);return <div key={m.id} className="list-card">
    <label><input type="checkbox" checked={!!row} disabled={!m.participates_in_polla||m.economic_mode==='fixed_yield'||confirmed.some(r=>r.cycle_member_id===m.id)} onChange={e=>change(e.target.checked?[...rows,{cycle_member_id:m.id,contribution_id:sources[0].id,amount:10000,eligible_on:'',evidence:''}]:rows.filter(r=>r.cycle_member_id!==m.id))}/>{m.member?.display_name}{!m.participates_in_polla||m.economic_mode==='fixed_yield'?' · no participa en Polla':' · derecho $10.000'}</label>
    {row&&<><label>Recaudo original<select value={row.contribution_id} onChange={e=>change(rows.map(r=>r===row?{...r,contribution_id:e.target.value}:r))}>{sources.map(s=><option key={s.id} value={s.id}>{s.paid_date} · {formatCop(s.amount)} · {s.id}</option>)}</select></label>
    <label>Fecha de participación respaldada<input type="date" value={row.eligible_on} onChange={e=>change(rows.map(r=>r===row?{...r,eligible_on:e.target.value}:r))}/></label>
    <label>Referencia de verificación individual<input maxLength={1000} value={row.evidence} onChange={e=>change(rows.map(r=>r===row?{...r,evidence:e.target.value}:r))}/></label></>}
   </div>})}
   <button type="button" disabled={!rows.length||rows.some(r=>!r.eligible_on||r.evidence.trim().length<10)} onClick={()=>void run(false)}>Previsualizar atribuciones</button>
   {preview&&<div role="status"><p>{rows.length} derechos · total reconocido {formatCop(preview.total)}. Nuevos asientos: 0.</p><ul>{rows.map(r=><li key={r.cycle_member_id}>{members.find(m=>m.id===r.cycle_member_id)?.member?.display_name} · {formatCop(r.amount)} · {r.eligible_on} · {r.evidence}</li>)}</ul><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>Verifiqué el respaldo de cada persona y período</label><button type="button" disabled={!accepted} onClick={()=>void run(true)}>Confirmar atribuciones verificadas</button></div>}
  </fieldset>}
 </details>;
}
