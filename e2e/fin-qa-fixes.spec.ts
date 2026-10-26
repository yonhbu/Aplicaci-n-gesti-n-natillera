import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const api='http://127.0.0.1:55421', app='http://127.0.0.1:5190';
const cycle='a0150000-0000-4000-8000-000000000002';
const runtime=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(runtime.API_URL!==api)throw Error('Refusing any environment other than TEST');
const publicKey=runtime.PUBLISHABLE_KEY??runtime.ANON_KEY;
async function login(page:Page){
  await page.route('**/*',route=>[api,app,'https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Correo autorizado').fill('qa-audit-2026@example.test');
  const response=page.waitForResponse(r=>r.url()===api+'/auth/v1/otp');
  await page.getByRole('button',{name:'Enviar codigo',exact:true}).click();expect((await response).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  let token:string|undefined;
  await expect.poll(async()=>{
    const inbox=await(await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
    const m=inbox.messages.find((m:{To?:{Address:string}[]})=>m.To?.some(t=>t.Address==='qa-audit-2026@example.test'));
    if(!m)return false;
    const detail=await(await page.request.get('http://127.0.0.1:55424/api/v1/message/'+encodeURIComponent(m.ID))).json();
    token=`${detail.Text??''}\n${detail.HTML??''}`.match(/\b\d{6}\b/)?.[0];return !!token;
  }).toBe(true);
  await page.getByLabel('Codigo recibido').fill(token!);await page.getByRole('button',{name:'Ingresar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
}
async function rest(page:Page,path:string,body?:unknown){
  return page.evaluate(async({path,body,publicKey,api})=>{
    const key=Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/.test(k));
    const session=JSON.parse(localStorage.getItem(key!)!);
    const response=await fetch(api+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:publicKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,data:await response.json()};
  },{path,body,publicKey,api});
}
async function more(page:Page,name:string){await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name,exact:true}).click();}
test.beforeEach(async({page})=>{await login(page);});
test('QA010: frozen new rights and preserved historical remainder block unreviewed distribution',async({page})=>{
  await more(page,'Rendimientos');await page.getByRole('button',{name:'Calcular reparto',exact:true}).click();
  await expect(page.getByText(/históricos pendientes de conciliación explícita/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirmar reparto',exact:true})).toBeDisabled();
  const p=await rest(page,'rpc/preview_bank_yield_distribution',{p_cycle_id:cycle,p_cut_date:'2026-12-05'});
  expect(p.status).toBe(200);expect(p.data.pool).toBe(p.data.net_received-p.data.recognized_in_withdrawals-p.data.already_distributed);
  expect(p.data.recognized_in_withdrawals).toBe(4900);expect(p.data.confirmation_allowed).toBe(false);
  const rights=await rest(page,'bank_yield_rights?cycle_id=eq.'+cycle);expect(rights.data).toHaveLength(2);expect(rights.data.reduce((s:number,r:{amount:number})=>s+r.amount,0)).toBe(100);
  await page.reload();await page.getByRole('button',{name:'Calcular reparto',exact:true}).click();await expect(page.getByRole('button',{name:'Confirmar reparto',exact:true})).toBeDisabled();
});
test('QA009: posted partials persist with exact explicit applications and a paid first quota',async({page})=>{
  const loans=await rest(page,'loan_contracts?external_borrower_name=eq.'+encodeURIComponent('QA FIN móvil parcial'));expect(loans.data).toHaveLength(1);
  const loan=loans.data[0];const payments=await rest(page,'loan_payments?loan_id=eq.'+loan.id);const apps=await rest(page,'loan_payment_applications?loan_id=eq.'+loan.id);
  expect(payments.data.filter((p:{kind:string})=>p.kind==='regular')).toHaveLength(2);
  for(const p of payments.data){const applied=apps.data.filter((a:{payment_id:string})=>a.payment_id===p.id);expect(applied.reduce((s:number,a:{capital_amount:number})=>s+a.capital_amount,0)).toBe(p.capital_amount);expect(applied.reduce((s:number,a:{interest_amount:number})=>s+a.interest_amount,0)).toBe(p.interest_amount);}
  const progress=await rest(page,'loan_schedule_progress?loan_id=eq.'+loan.id+'&installment_number=eq.1');expect(progress.data[0].status).toBe('paid');expect(progress.data[0].interest_paid).toBe(561.49);
  await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Préstamos',exact:true}).click();await page.getByRole('button',{name:/^Todos/}).click();await expect(page.getByText('QA FIN móvil parcial',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:/^Todos/}).click();await expect(page.getByText('QA FIN móvil parcial',{exact:true})).toBeVisible();
});
test('QA008: confirmed EA prepayment retains 133.14 quotation and exact total',async({page})=>{
  const loans=await rest(page,'loan_contracts?external_borrower_name=eq.'+encodeURIComponent('QA FIN móvil parcial'));const loan=loans.data[0];expect(loan.status).toBe('paid');
  const payments=await rest(page,'loan_payments?loan_id=eq.'+loan.id+'&kind=eq.prepayment');expect(payments.data).toHaveLength(1);
  const p=payments.data[0];expect(p.interest_amount).toBe(133.14);expect(p.amount).toBe(30694.63);expect(p.calculation_snapshot.interest_due).toBe(133.14);expect(p.calculation_snapshot.quote_hash).toMatch(/^[a-f0-9]{32}$/);
  const retry=await rest(page,'rpc/confirm_loan_prepayment',{p_loan_id:loan.id,p_idempotency_key:p.idempotency_key,p_payment_date:p.payment_date,p_quote_hash:p.calculation_snapshot.quote_hash});expect(retry.status).toBe(200);expect(retry.data.id).toBe(p.id);
  expect((await rest(page,'loan_payments?loan_id=eq.'+loan.id+'&kind=eq.prepayment')).data).toHaveLength(1);
});
test('QA007: withdrawal form exposes protected reserve and requires a real source',async({page})=>{
  await more(page,'Mi ganancia como administrador');await page.getByRole('button',{name:'Registrar retiro',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('12 % EA');await expect(dialog.getByRole('button',{name:'Registrar retiro',exact:true})).toBeDisabled();
  const preview=await rest(page,'rpc/preview_admin_withdrawal',{p_cycle_id:cycle,p_effective_date:'2026-10-16'});expect(preview.status).toBe(200);expect(preview.data.available).toBeLessThanOrEqual(preview.data.admin_balance);expect(preview.data.ea_reserve).toBeGreaterThanOrEqual(0);
  await expect(dialog.getByText('Efectivo',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
});
test('QA004: browser exports 44 complete collections and cannot invoke privileged restore',async({page},info)=>{
  await more(page,'Respaldos');await expect(page.getByText(/todos los ciclos de esta natillera/)).toBeVisible();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar respaldo',exact:true}).click();const download=await downloadPromise;
  const file=info.outputPath('workspace-v3.json');await download.saveAs(file);const {readFile}=await import('node:fs/promises');const backup=JSON.parse(await readFile(file,'utf8'));
  expect(backup.format).toBe('natillera-manager.workspace.v3');expect(Object.keys(backup.tables)).toHaveLength(44);
  for(const [name,rows] of Object.entries(backup.tables))expect((rows as unknown[]).length).toBe(backup.counts[name]);
  expect(backup.tables.loan_payment_applications.length).toBeGreaterThan(0);expect(backup.tables.bank_yield_rights.length).toBe(2);expect(backup).not.toHaveProperty('auth');
  const denied=await rest(page,'rpc/restore_natillera_workspace',{p_backup:backup});expect([401,403,404]).toContain(denied.status);
});
