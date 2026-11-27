import {test,expect,type Page} from './test-fixtures';
import seed from '../scripts/seed-polla-audit.mjs';
import {auditSql} from '../scripts/lib/audit-test-runtime.mjs';
import {startAuditTrace,finishAuditTrace,expectAuditHttpFailure} from './audit-safe-trace';
import Decimal from 'decimal.js';

test('derechos colectivos: respuesta perdida y confirmación UI no crean dinero; ganador verificado recibe un premio',async({page},info)=>{
 await login(page);await activity(page,'colectiva','Marzo');const before=snapshot();
 await expect(page.getByText('Versión 10',{exact:true})).toBeVisible();
 const keys:string[]=[];await page.route('**/rest/v1/rpc/confirm_polla_historical_rights',async route=>{keys.push(route.request().postDataJSON().p_key);const response=await route.fetch();if(keys.length===1){await response.body();await route.abort('failed');}else await route.fulfill({response});});
 await page.getByText('Conciliar derechos históricos sin registrar dinero',{exact:true}).click();
 for(let i=0;i<10;i++){
  const name=f.names[i]+' · derecho $10.000';const box=page.getByRole('checkbox',{name,exact:true});await box.check();
  const row=page.locator('div.list-card').filter({has:box});await row.getByLabel('Fecha de participación respaldada',{exact:true}).fill('2026-03-10');await row.getByLabel('Referencia de verificación individual',{exact:true}).fill('Soporte sintético individual '+i);
 }
 await page.getByRole('button',{name:'Previsualizar atribuciones',exact:true}).click();await expect(page.getByRole('status')).toContainText('Nuevos asientos: 0');
 await page.getByRole('checkbox',{name:'Verifiqué el respaldo de cada persona y período',exact:true}).check();await page.getByRole('button',{name:'Confirmar atribuciones verificadas',exact:true}).click();await expect(page.getByRole('alert')).toContainText('No se pudo verificar el resultado');await page.getByRole('button',{name:'Confirmar atribuciones verificadas',exact:true}).click();await expect(page.getByRole('button',{name:'Confirmar atribuciones verificadas',exact:true})).toHaveCount(0);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);await expect(page.getByText('Ver atribuciones confirmadas (10)',{exact:true})).toBeVisible();
 const attributed=snapshot();for(const table of ['ledger_entries','financial_operations','polla_contributions','polla_prizes','member_settlements'])expect(attributed[table]).toEqual(before[table]);
 const form=await award(page,0);await form.getByRole('button',{name:'Asignar premio',exact:true}).click();await expect(form).toHaveCount(0);const after=snapshot();expect(after.polla_prizes.find((p:any)=>p.activity_id===f.activities.colectiva)).toMatchObject({admin_commission:5000,net_amount:95000});await evidence(info,'derechos-sin-nuevo-recaudo',before,after);
});

test('derechos colectivos: confirmaciones concurrentes y reintento no duplican atribución ni ledger',async({page},info)=>{
 await login(page);const before=snapshot(),source=before.polla_contributions.find((c:any)=>c.activity_id===f.activities.colectiva);
 const rows=f.ids.slice(0,10).map((id:string)=>({cycle_member_id:id,contribution_id:source.id,amount:10000,eligible_on:'2026-03-10',evidence:'Verificación sintética individual'}));
 const args={p_activity_id:f.activities.colectiva,p_rows:rows};const preview=await rpc(page,'preview_polla_historical_rights',args);expect(preview.error).toBeNull();
 expectAuditHttpFailure(page,'/rest/v1/rpc/confirm_polla_historical_rights',400);
 const calls=['rights-concurrent-a','rights-concurrent-b'];const results=await Promise.all(calls.map(p_key=>rpc(page,'confirm_polla_historical_rights',{...args,p_key,p_preview_hash:preview.data.preview_hash})));
 expect(results.filter(r=>!r.error)).toHaveLength(1);const key=calls[results.findIndex(r=>!r.error)];expect((await rpc(page,'confirm_polla_historical_rights',{...args,p_key:key,p_preview_hash:preview.data.preview_hash})).error).toBeNull();
 const after=snapshot();for(const table of ['ledger_entries','financial_operations','polla_contributions','polla_prizes','member_settlements'])expect(after[table]).toEqual(before[table]);await evidence(info,'concurrencia-derechos',before,after);
});
let f:any;
const api='http://127.0.0.1:55421';
test.beforeEach(async()=>{f=await seed();});
test.afterEach(async({page},info)=>{
 if(page.url().startsWith('http://127.0.0.1:5198'))await page.screenshot({path:info.outputPath('estado.png'),fullPage:true});
 await finishAuditTrace(page,info);
});
async function login(page:Page,email=f.email){
 await page.goto('/');await page.getByLabel('Correo autorizado').fill(email);
 await page.getByRole('button',{name:'Enviar codigo',exact:true}).click();await page.getByLabel('Codigo recibido').waitFor();
 const inbox=await(await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
 const mail=inbox.messages.find((m:any)=>m.To?.some((to:any)=>to.Address===email));expect(mail).toBeTruthy();
 const body=await(await page.request.get('http://127.0.0.1:55424/api/v1/message/'+mail.ID)).json();
 const otp=(String(body.Text??'')+String(body.HTML??'')).match(/\b\d{6}\b/)?.[0];expect(otp).toBeTruthy();
 await page.getByLabel('Codigo recibido').fill(otp!);await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 if(email===f.email)await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
 const target=await page.evaluate(async()=>{const p='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */p);return supabase.supabaseUrl;});expect(target).toBe(api);
 await startAuditTrace(page);
}
async function rpc(page:Page,name:string,args:object){
 return page.evaluate(async({name,args})=>{const p='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */p);const r=await supabase.rpc(name,args);return {status:r.status,error:r.error?{code:r.error.code,message:r.error.message}:null,data:r.data};},{name,args});
}
async function rejectedRpc(page:Page,name:string,args:object){expectAuditHttpFailure(page,'/rest/v1/rpc/'+name,400);return rpc(page,name,args);}
function snapshot(){
 const tables=['polla_activities','polla_participants','polla_contributions','polla_prizes','polla_prize_payments','member_capital_credits','member_settlements','financial_operations','ledger_entries'];
 const pairs=tables.map(t=>`'${t}',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.${t} x where x.cycle_id='${f.cycleId}'),'[]'::jsonb)`);
 return JSON.parse(auditSql(`select jsonb_build_object(${pairs.join(',')});`));
}
function balances(s:any){const result:Record<string,string>={};for(const e of s.ledger_entries)result[e.account]=new Decimal(result[e.account]??0).plus(e.amount).toFixed(2);return result;}
function delta(a:any,b:any,key:string){return new Decimal(balances(b)[key]??0).minus(balances(a)[key]??0).toFixed(2);}
function balanced(s:any){for(const op of s.financial_operations)expect(s.ledger_entries.filter((x:any)=>x.operation_id===op.id).reduce((n:Decimal,x:any)=>n.plus(x.amount),new Decimal(0)).toFixed(2),op.id).toBe('0.00');}
async function evidence(info:any,label:string,before:any,after:any,extra={}){balanced(after);await info.attach(label,{body:Buffer.from(JSON.stringify({before,after,beforeBalances:balances(before),afterBalances:balances(after),...extra},null,2)),contentType:'application/json'});}
async function activity(page:Page,key:string,month:string){
 await page.goto('/#/polla');await expect(page.getByRole('heading',{name:'Polla',exact:true})).toBeVisible();
 await page.getByRole('group',{name:'Mes de la polla',exact:true}).getByRole('button',{name:month,exact:true}).click();
 const name=key==='marzoA'?'Marzo A':key==='marzoB'?'Marzo B':key==='parcial'?'Marzo pendiente':key==='colectiva'?'Marzo colectivo':key==='mayo'?'Mayo':key==='octubre'?'Octubre':'Noviembre';
 const choice=page.getByRole('group',{name:'Polla del mes',exact:true}).getByRole('button',{name,exact:true});if(await choice.count())await choice.click();
}
async function award(page:Page,index=0,amount='100000',date='2026-11-20'){
 await page.getByRole('button',{name:'Asignar ganador',exact:true}).click();const sheet=page.getByRole('dialog');
 await sheet.getByRole('combobox',{name:'Ganador',exact:true}).selectOption(f.ids[index]);
 await sheet.getByLabel('Premio bruto',{exact:true}).fill(amount);await sheet.getByLabel('Fecha premio',{exact:true}).fill(date);return sheet;
}
function contributionArgs(index:number,key='noviembre',idempotency='test-contrib',amount=10000){return {p_activity_id:f.activities[key],p_cycle_member_id:f.ids[index],p_idempotency_key:idempotency,p_amount:amount,p_paid_date:'2026-11-20'};}

test('POLLA-01: ganador histórico pagado incluye retirados, excluye ajenos y aportes insuficientes',async({page})=>{
 await login(page);await activity(page,'marzoA','Marzo');await page.getByRole('button',{name:'Asignar ganador',exact:true}).click();
 const options=page.getByRole('combobox',{name:'Ganador'}).locator('option');const values=await options.evaluateAll(xs=>xs.map(x=>(x as HTMLOptionElement).value));
 expect(values.filter(Boolean).sort()).toEqual(f.ids.slice(0,10).sort());expect(values).toContain(f.ids[1]);expect(values).toContain(f.ids[2]);expect(values).not.toContain(f.ids[13]);
});
test('POLLA-02: diez aportes efectivos respaldan 100.000; la cuota duplicada se rechaza sin asientos',async({page},info)=>{
 await login(page);await activity(page,'octubre','Octubre');const before=snapshot();const rows=before.polla_contributions.filter((x:any)=>x.activity_id===f.activities.octubre&&x.status==='posted');
 expect(rows).toHaveLength(10);expect(new Set(rows.map((x:any)=>x.operation_id)).size).toBe(10);expect(rows.reduce((n:number,x:any)=>n+Number(x.amount),0)).toBe(100000);
 await expect(page.getByText('10 de 10 aportaron',{exact:false})).toBeVisible();
 const result=await rejectedRpc(page,'register_polla_contribution',{...contributionArgs(0,'octubre'),p_paid_date:'2026-10-20'});expect(result.error?.code).toBe('P0001');expect(result.error?.message).toContain('10.000');expect(snapshot()).toEqual(before);
 await page.getByRole('button',{name:'Registrar aporte',exact:true}).click();await page.getByRole('combobox',{name:'Participante'}).selectOption(f.ids[0]);await page.getByLabel('Aporte polla',{exact:true}).fill('10000');await page.getByLabel('Fecha aporte',{exact:true}).fill('2026-10-20');await page.getByRole('button',{name:'Guardar aporte',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('El aporte de polla no puede superar $10.000 por actividad');expect(snapshot()).toEqual(before);
 await evidence(info,'duplicado-sin-movimientos',before,snapshot(),{result});
});
test('POLLA-03 válido: premio 100.000, comisión 5.000, capital 95.000, caja sin salida y persistencia',async({page},info)=>{
 await login(page);await activity(page,'mayo','Mayo');const before=snapshot();const sheet=await award(page);const response=page.waitForResponse(r=>r.url().endsWith('/rpc/award_polla_prize_to_capital'));
 await sheet.getByRole('button',{name:'Asignar premio',exact:true}).click();expect((await response).status()).toBe(200);await expect(sheet).toHaveCount(0);
 const after=snapshot(),prizes=after.polla_prizes.filter((x:any)=>x.activity_id===f.activities.mayo);expect(prizes).toHaveLength(1);expect(prizes[0]).toMatchObject({gross_amount:100000,admin_commission:5000,net_amount:95000,status:'settled'});
 expect(delta(before,after,'cash')).toBe('0.00');expect(delta(before,after,'polla_pool')).toBe('100000.00');expect(delta(before,after,'admin_payable')).toBe('-5000.00');expect(delta(before,after,'savings_liability')).toBe('-95000.00');expect(delta(before,after,'prizes_payable')).toBe('0.00');
 await page.reload();await expect(page.locator('[data-prize-row]').filter({hasText:f.names[0]})).toContainText('95.000');
 await page.goto('/#/more/movements');const awardedRow=page.locator('.movement-row').filter({hasText:'Premio asignado'});await expect(awardedRow).toContainText('100.000');await expect(awardedRow).toContainText('no mueve caja');await expect(page.locator('.movement-row').filter({hasText:'Premio acreditado al capital'})).toContainText('95.000');
 await page.goto('/#/more/admin');await expect(page.locator('.value-row').filter({has:page.getByText('Comisiones de polla',{exact:true})}).locator('strong')).toContainText('5.000');
 await page.goto('/#/more/stats');const recent=page.locator('.stats-card').filter({has:page.getByRole('heading',{name:'Actividad reciente',exact:true})});await expect(recent.locator('li').filter({hasText:'Premio asignado'})).toContainText('100.000');await expect(recent.locator('li').filter({hasText:'Premio acreditado al capital'})).toContainText('95.000');
 await page.goto('/#/members');await page.getByRole('row').filter({hasText:f.names[0]}).getByRole('button',{name:'Detalle',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('95.000');
 await evidence(info,'premio-y-capital',before,after);
});
test('POLLA-03 rechazo concurrente explica la causa SQL y no presenta un éxito aparente',async({page},info)=>{
 await login(page);await activity(page,'marzoA','Marzo');const sheet=await award(page);
 const old=snapshot().polla_contributions.find((x:any)=>x.activity_id===f.activities.marzoA&&x.cycle_member_id===f.ids[0]);
 const reversed=await rpc(page,'reverse_financial_operation',{p_operation_id:old.operation_id,p_idempotency_key:'race-reverse-contribution',p_effective_date:'2026-11-19',p_reason:'Corrección sintética concurrente'});expect(reversed.error).toBeNull();
 const before=snapshot(),response=page.waitForResponse(r=>r.url().endsWith('/rpc/award_polla_prize_to_capital'));
 expectAuditHttpFailure(page,'/rest/v1/rpc/award_polla_prize_to_capital',400);
 await sheet.getByRole('button',{name:'Asignar premio',exact:true}).click();const result=await response;expect(result.status()).toBe(400);const error=await result.json();expect(error.code).toBe('P0001');
 await expect(sheet).toContainText('El ganador no tiene pagada completa la polla de esta actividad');expect(snapshot()).toEqual(before);await evidence(info,'rechazo-autoritativo',before,snapshot(),{response:{status:result.status(),code:error.code,message:error.message}});
});
test('POLLA-04: dos bolsas de marzo independientes se juegan en noviembre, sin nuevos aportes',async({page},info)=>{
 await login(page);const before=snapshot();
 for(const [key,winner]of [['marzoA',0],['marzoB',3]] as const){await activity(page,key,'Marzo');const sheet=await award(page,winner);await sheet.getByRole('button',{name:'Asignar premio',exact:true}).click();await expect(sheet).toHaveCount(0);await page.reload();}
 const after=snapshot();expect(after.polla_contributions).toEqual(before.polla_contributions);
 for(const key of ['marzoA','marzoB']){const p=after.polla_prizes.filter((x:any)=>x.activity_id===f.activities[key]);expect(p).toHaveLength(1);expect(p[0].awarded_at).toBe('2026-11-20');expect(after.polla_activities.find((x:any)=>x.id===f.activities[key]).period_month).toBe(3);}
 expect(delta(before,after,'admin_payable')).toBe('-10000.00');expect(delta(before,after,'savings_liability')).toBe('-190000.00');expect(delta(before,after,'cash')).toBe('0.00');await evidence(info,'dos-marzos',before,after);
});
test('POLLA-01/04: retirada con liquidación pagada gana su derecho histórico sin reabrir capital y recibe pago posterior',async({page},info)=>{
 await login(page);await activity(page,'marzoA','Marzo');const before=snapshot();const sheet=await award(page,1);await sheet.getByRole('button',{name:'Asignar premio',exact:true}).click();await expect(sheet).toHaveCount(0);
 const assigned=snapshot();const prize=assigned.polla_prizes.find((x:any)=>x.activity_id===f.activities.marzoA);expect(prize.status).toBe('pending_payment');expect(assigned.member_settlements).toEqual(before.member_settlements);expect(delta(before,assigned,'savings_liability')).toBe('0.00');expect(delta(before,assigned,'prizes_payable')).toBe('-95000.00');expect(delta(before,assigned,'cash')).toBe('0.00');
 await page.getByRole('button',{name:/Entregar.*95.000/}).click();const deliver=page.getByRole('dialog');await deliver.getByLabel('Fecha de entrega').fill('2026-11-21');await deliver.getByRole('button',{name:'Registrar entrega',exact:true}).click();await expect(deliver).toHaveCount(0);
 const after=snapshot();expect(after.member_capital_credits.filter((x:any)=>x.prize_id===prize.id)).toHaveLength(0);expect(delta(assigned,after,'cash')).toBe('-95000.00');expect(delta(assigned,after,'prizes_payable')).toBe('95000.00');await page.reload();await expect(page.locator('[data-prize-row]').filter({hasText:f.names[1]})).toContainText('Pagado');await evidence(info,'retiro-y-pago',before,after);
});
test('POLLA-01: fecha de retiro a mitad de mes conserva aportes previos y bloquea nuevos posteriores',async({page},info)=>{
 await login(page);await activity(page,'mayo','Mayo');const before=snapshot();expect(before.member_settlements.find((s:any)=>s.cycle_member_id===f.ids[2]).cut_date).toBe('2026-05-15');
 await page.getByRole('button',{name:'Asignar ganador',exact:true}).click();await expect(page.getByRole('combobox',{name:'Ganador'}).locator(`option[value="${f.ids[2]}"]`)).toBeEnabled();await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 const blocked=await rejectedRpc(page,'register_polla_contribution',contributionArgs(2));expect(blocked.error?.message).toContain('retiro');expect(snapshot()).toEqual(before);
 await activity(page,'noviembre','Noviembre');await page.getByRole('button',{name:'Registrar aporte',exact:true}).click();await expect(page.getByRole('combobox',{name:'Participante'}).locator(`option[value="${f.ids[2]}"]`)).toHaveJSProperty('disabled',true);await evidence(info,'retiro-mitad-mes',before,snapshot(),{blocked});
});
test('POLLA-01: parcial anterior al retiro no se convierte en derecho completo ni crea obligación nueva',async({page})=>{
 await login(page);await activity(page,'parcial','Marzo');await page.getByRole('button',{name:'Asignar ganador',exact:true}).click();await expect(page.getByRole('combobox',{name:'Ganador'}).locator(`option[value="${f.ids[12]}"]`)).toHaveCount(0);
 const before=snapshot(),r=await rejectedRpc(page,'award_polla_prize_to_capital',{p_activity_id:f.activities.parcial,p_winner_cycle_member_id:f.ids[12],p_idempotency_key:'partial-winner-invalid',p_gross_amount:10000,p_awarded_at:'2026-11-20'});expect(r.error?.code).toBe('P0001');expect(snapshot()).toEqual(before);
});
test('concurrencia HTTP: solo un aporte y un premio entre dos solicitudes; ledger equilibrado',async({page},info)=>{
 await login(page);const before=snapshot();expectAuditHttpFailure(page,'/rest/v1/rpc/register_polla_contribution',400);expectAuditHttpFailure(page,'/rest/v1/rpc/award_polla_prize_to_capital',400);const contributed=await Promise.all(['a','b'].map(k=>rpc(page,'register_polla_contribution',contributionArgs(0,'noviembre','concurrent-'+k))));expect(contributed.filter(x=>!x.error)).toHaveLength(1);
 const results=await Promise.all([0,3].map(i=>rpc(page,'award_polla_prize_to_capital',{p_activity_id:f.activities.mayo,p_winner_cycle_member_id:f.ids[i],p_idempotency_key:'concurrent-prize-'+i,p_gross_amount:100000,p_awarded_at:'2026-11-20'})));expect(results.filter(x=>!x.error)).toHaveLength(1);
 const after=snapshot();expect(after.polla_prizes.filter((x:any)=>x.activity_id===f.activities.mayo)).toHaveLength(1);expect(delta(before,after,'admin_payable')).toBe('-5000.00');await evidence(info,'concurrencia-real',before,after,{contributed,results});
});
test('doble clic, respuesta perdida y reintento conservan una sola premiación',async({page},info)=>{
 await login(page);await activity(page,'mayo','Mayo');const before=snapshot(),keys:string[]=[];
 await page.route('**/rest/v1/rpc/award_polla_prize_to_capital',async route=>{keys.push(route.request().postDataJSON().p_idempotency_key);const result=await route.fetch();if(keys.length===1){await result.body();await route.abort('failed');}else await route.fulfill({response:result});});
 const sheet=await award(page);await sheet.getByRole('button',{name:'Asignar premio',exact:true}).dblclick();await expect(sheet).toContainText('No se pudo conectar');await expect(sheet.getByRole('button',{name:'Asignar premio',exact:true})).toBeEnabled();await sheet.getByRole('button',{name:'Asignar premio',exact:true}).click();await expect(sheet).toHaveCount(0);
 expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);const after=snapshot();expect(after.polla_prizes.filter((x:any)=>x.activity_id===f.activities.mayo)).toHaveLength(1);expect(delta(before,after,'admin_payable')).toBe('-5000.00');await evidence(info,'reintento-sin-duplicar',before,after);
});
test('reverso UI restaura bolsa y crédito; cancelación conserva historia sin borrar aportes',async({page},info)=>{
 await login(page);await activity(page,'mayo','Mayo');const before=snapshot();const sheet=await award(page);await sheet.getByRole('button',{name:'Asignar premio',exact:true}).click();await expect(sheet).toHaveCount(0);
 await page.locator('[data-prize-row]').filter({hasText:f.names[0]}).getByRole('button',{name:'Anular premio',exact:true}).click();const undo=page.getByRole('dialog');await undo.getByLabel(/Motivo/).fill('Anulación sintética de premio');await undo.getByRole('button',{name:/Confirmar anulación/}).click();await expect(undo).toHaveCount(0);
 const reversed=snapshot();for(const key of new Set([...Object.keys(balances(before)),...Object.keys(balances(reversed))]))expect(delta(before,reversed,key)).toBe('0.00');expect(reversed.polla_prizes[0].status).toBe('reversed');balanced(reversed);
 await activity(page,'noviembre','Noviembre');await page.getByRole('button',{name:'Cancelar polla',exact:true}).click();await page.getByRole('dialog').getByLabel(/Motivo/).fill('Cancelación sintética sin recaudo');await page.getByRole('dialog').getByRole('button',{name:'Confirmar cancelación',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:/Ver actividades canceladas/}).click();await expect(page.getByText(/Cancelada/)).toBeVisible();await expect(page.getByRole('button',{name:'Asignar ganador',exact:true})).toBeDisabled();
 const after=snapshot();expect(after.polla_contributions).toEqual(before.polla_contributions);await evidence(info,'reverso-cancelación',before,after);
});
test('RLS: identidad sin membresía no lee ni modifica el workspace Polla',async({page},info)=>{
 await login(page,f.outsiderEmail);const before=snapshot();const read=await page.evaluate(async cycle=>{const p='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */p);const r=await supabase.from('polla_activities').select('id').eq('cycle_id',cycle);return r.data;},f.cycleId);expect(read).toEqual([]);
 const response=await rejectedRpc(page,'register_polla_contribution',contributionArgs(0));expect(response.error).toBeTruthy();expect(snapshot()).toEqual(before);await evidence(info,'RLS',before,snapshot(),{response});
});
test('crear otra actividad de marzo selecciona su UUID; aporte y reverso UI no contaminan bolsas anteriores',async({page},info)=>{
 await login(page);await activity(page,'marzoA','Marzo');const before=snapshot();
 await page.getByRole('button',{name:'Nueva polla',exact:true}).click();const form=page.getByRole('dialog');await form.getByLabel('Nombre actividad').fill('Marzo nueva sintética');await form.getByRole('combobox',{name:'Mes',exact:true}).selectOption('3');await form.getByRole('button',{name:'Crear actividad',exact:true}).click();await expect(form).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Polla del mes'}).getByRole('button',{name:'Marzo nueva sintética',exact:true})).toHaveAttribute('aria-pressed','true');
 const created=snapshot().polla_activities.find((x:any)=>x.name==='Marzo nueva sintética');expect(created.id).not.toBe(f.activities.marzoA);
 await page.getByRole('button',{name:'Registrar aporte',exact:true}).click();await form.getByRole('combobox',{name:'Participante',exact:true}).selectOption(f.ids[0]);await form.getByLabel('Aporte polla',{exact:true}).fill('10000');await form.getByLabel('Fecha aporte',{exact:true}).fill('2026-11-20');await form.getByRole('button',{name:'Guardar aporte',exact:true}).click();await expect(form).toHaveCount(0);
 const posted=snapshot();expect(posted.polla_contributions.filter((x:any)=>x.activity_id===created.id)).toHaveLength(1);expect(posted.polla_contributions.filter((x:any)=>x.activity_id===f.activities.marzoA)).toEqual(before.polla_contributions.filter((x:any)=>x.activity_id===f.activities.marzoA));expect(delta(before,posted,'cash')).toBe('10000.00');
 await page.locator('.polla-contribution-history summary').click();await page.locator('.polla-contribution-history li').getByRole('button',{name:'Anular',exact:true}).click();await form.getByLabel('Motivo',{exact:true}).fill('Reverso sintético de aporte');await form.getByRole('button',{name:'Confirmar anulación',exact:true}).click();await expect(form).toHaveCount(0);
 const reversed=snapshot();expect(reversed.polla_contributions.find((x:any)=>x.activity_id===created.id).status).toBe('reversed');for(const account of new Set([...Object.keys(balances(before)),...Object.keys(balances(reversed))]))expect(delta(before,reversed,account)).toBe('0.00');await page.reload();await evidence(info,'crear-aportar-revertir',before,reversed);
});
test('recaudo legacy colectivo no inventa diez derechos individuales ni habilita ganador sin evidencia',async({page},info)=>{
 await login(page);await activity(page,'colectiva','Marzo');const before=snapshot();await expect(page.getByText('Recaudo registrado',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Asignar ganador',exact:true}).click();
 expect(await page.getByRole('combobox',{name:'Ganador'}).locator('option').count()).toBe(1);await expect(page.getByRole('button',{name:'Asignar premio',exact:true})).toBeDisabled();expect(snapshot()).toEqual(before);await evidence(info,'derechos-colectivos-no-inferidos',before,snapshot());
});
test('fecha actual de premio no falsifica marzo; corte histórico conserva la bolsa y elegibilidad',async({page},info)=>{
 await login(page);await activity(page,'marzoA','Marzo');const before=snapshot(),form=await award(page,0,'100000',f.today);await form.getByRole('button',{name:'Asignar premio',exact:true}).click();await expect(form).toHaveCount(0);
 const after=snapshot(),prize=after.polla_prizes.find((x:any)=>x.activity_id===f.activities.marzoA);expect(prize.awarded_at).toBe(f.today);expect(after.financial_operations.find((x:any)=>x.id===prize.award_operation_id).effective_date).toBe(f.today);
 const historical=JSON.parse(auditSql(`select json_build_object('awards',count(*) filter(where operation_type='polla_prize_awarded'),'pool',coalesce((select -sum(le.amount) from public.ledger_entries le join public.financial_operations fo on fo.id=le.operation_id where le.cycle_id='${f.cycleId}' and le.account='polla_pool' and fo.effective_date<='2026-03-31'),0)) from public.financial_operations where cycle_id='${f.cycleId}' and effective_date<='2026-03-31';`));expect(historical).toEqual({awards:0,pool:305000});
 await page.goto('/#/home');await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-03-31');await expect(page.locator('[data-figure-key="bolsa-polla"] [data-figure-value]')).toContainText('305.000');await activity(page,'marzoB','Marzo');await page.getByRole('button',{name:'Asignar ganador',exact:true}).click();await expect(page.getByRole('combobox',{name:'Ganador'}).locator(`option[value="${f.ids[1]}"]`)).toBeEnabled();expect(snapshot()).toEqual(after);await evidence(info,'fechas-y-corte',before,after,{historical});
});
