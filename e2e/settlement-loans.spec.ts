import {expect,test,type Page} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const folder='incoming/settlement-loans-2026-10-21';
const fixture=JSON.parse(readFileSync(folder+'/fixture.json','utf8'));
const api='http://127.0.0.1:55421';
test.describe.configure({mode:'serial'});
const faults=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-21T17:00:00Z'));
 const errors:string[]=[];faults.set(page,errors);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname)});
 await page.route('**/*',route=>['http://127.0.0.1:5198',api,'https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
});
test.afterEach(async({page})=>expect(faults.get(page)).toEqual([]));
async function login(page:Page){
 await page.goto('/');await page.getByLabel('Correo autorizado').fill(fixture.email);await page.getByRole('button',{name:'Enviar codigo',exact:true}).click();await page.getByLabel('Codigo recibido').waitFor();
 const inbox=await(await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();const mail=inbox.messages.find((m:any)=>m.To?.some((to:any)=>to.Address===fixture.email));
 const body=await(await page.request.get('http://127.0.0.1:55424/api/v1/message/'+mail.ID)).json();const token=(String(body.Text??'')+String(body.HTML??'')).match(/\b\d{6}\b/)?.[0];expect(token).toBeTruthy();
 await page.getByLabel('Codigo recibido').fill(token!);await page.getByRole('button',{name:'Ingresar',exact:true}).click();await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>{const{supabase}=await import('/src/lib/supabase.ts');return(supabase as any).supabaseUrl})).toBe(api);
 await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
}
async function state(page:Page){return page.evaluate(async f=>{
 const{supabase}=await import('/src/lib/supabase.ts');
 const read=async(table:string)=>{const r=await supabase.from(table).select('*').eq('cycle_id',f.cycleId);if(r.error)throw Error(r.error.message);return r.data;};
 const[loans,payments,applications,settlements,paid,schedules,entries,operations]=await Promise.all(['loan_contracts','loan_payments','loan_settlement_effects','member_settlements','member_settlement_payments','loan_schedule_progress','ledger_entries','financial_operations'].map(read));
 const sums=Object.fromEntries(['loans_receivable','savings_liability','settlements_payable','bank_interest_income','admin_payable','member_loan_profit_fund'].map(account=>[account,entries.filter(e=>e.account===account).reduce((s,e)=>s+Number(e.amount),0).toFixed(2)]));
 const bank=entries.filter(e=>e.account==='cash'&&e.bank_account_id===f.bankId).reduce((s,e)=>s+Number(e.amount),0).toFixed(2);
 return{loans,payments,applications,settlements,paid,schedules,sums,bank,operations:operations.length,entries:entries.length};
},fixture)}
async function checkClosed(page:Page){
 const s=await state(page);expect(s.loans.every(l=>l.status==='paid')).toBe(true);expect(s.payments).toHaveLength(0);expect(s.applications).toHaveLength(2);expect(s.sums.loans_receivable).toBe('0.00');expect(s.schedules.filter(x=>x.status==='projected')).toHaveLength(0);return s;
}
test('browser confirms two debts, receives 100 and pays exact 32.72 with persistence',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await login(page);const initial=await state(page);writeFileSync(folder+'/browser-before.json',JSON.stringify(initial,null,2));
 await page.screenshot({path:info.outputPath('home-before.png'),fullPage:true,animations:'disabled'});
 await page.goto('/#/more/settlements');await page.locator('[data-settlement-member="'+fixture.memberId+'"]').click();let sheet=page.getByRole('dialog');
 await sheet.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');await sheet.getByRole('button',{name:'Calcular',exact:true}).click();await expect(sheet.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeDisabled();
 await expect(sheet.getByLabel('Préstamos incluidos en la cuenta final')).toContainText('SYN-C005');await expect(sheet.getByLabel('Préstamos incluidos en la cuenta final')).toContainText('SYN-C013');
 await sheet.getByRole('button',{name:'Registrar pago para completar la cuenta final',exact:true}).click();await sheet.getByLabel('Dónde se recibió').selectOption('bank');await sheet.getByLabel('Importe recibido').fill('100');await sheet.getByLabel('Fecha real de la consignación').fill('2026-10-20');await sheet.getByLabel('Referencia de la consignación').fill('Synthetic bank completion 100');await sheet.getByRole('checkbox').check();
 let response=page.waitForResponse(r=>r.url()===api+'/rest/v1/rpc/record_settlement_completion');await sheet.getByRole('button',{name:'Guardar consignación y recalcular',exact:true}).click();expect((await response).status()).toBe(200);
 response=page.waitForResponse(r=>r.url()===api+'/rest/v1/rpc/confirm_member_settlement');await sheet.getByRole('button',{name:'Confirmar cuenta final',exact:true}).click();expect((await response).status()).toBe(200);
 await expect(sheet.getByText('A entregar',{exact:true})).toBeVisible();const confirmed=await checkClosed(page);expect(confirmed.bank).toBe((Number(initial.bank)+100).toFixed(2));expect(confirmed.settlements[0].transfer_amount).toBe(32.72);
 await page.screenshot({path:info.outputPath('confirmed-before-payment.png'),fullPage:true,animations:'disabled'});
 await sheet.getByLabel('Fecha del pago',{exact:true}).fill('2026-10-20');await sheet.getByLabel('Referencia',{exact:true}).fill('Synthetic actual payout 32.72');
 response=page.waitForResponse(r=>r.url()===api+'/rest/v1/rpc/pay_member_settlement');await sheet.getByRole('button',{name:/^Pagar /}).click();const payment=await response;expect(payment.status()).toBe(200);const originalRequest=payment.request().postDataJSON();
 await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();await expect(page.locator('[data-settlement-member="'+fixture.memberId+'"]')).toContainText('32,72');
 const paid=await checkClosed(page);expect(paid.bank).toBe((Number(initial.bank)+100-32.72).toFixed(2));expect(paid.sums.settlements_payable).toBe('0.00');expect(paid.settlements[0].status).toBe('paid');expect(paid.paid).toHaveLength(1);
 expect((Number(paid.sums.admin_payable)-Number(initial.sums.admin_payable)).toFixed(2)).toBe('-72500.00');
 expect((Number(paid.sums.member_loan_profit_fund)-Number(initial.sums.member_loan_profit_fund)).toFixed(2)).toBe('-22500.00');
 expect((Number(paid.sums.bank_interest_income)-Number(initial.sums.bank_interest_income)).toFixed(2)).toBe('9438.72');
 expect((Number(paid.sums.savings_liability)-Number(initial.sums.savings_liability)).toFixed(2)).toBe('1135000.00');
 const retry=await page.evaluate(async request=>{const{supabase}=await import('/src/lib/supabase.ts');const r=await supabase.rpc('pay_member_settlement',request);return{error:r.error?.message};},originalRequest);expect(retry.error).toBeUndefined();expect((await state(page)).entries).toBe(paid.entries);
 await page.goto('/#/loans');await expect(page.locator('[data-loan-row]')).toHaveCount(0);await page.getByRole('button',{name:/^Pagados/}).click();await expect(page.locator('[data-loan-row]')).toHaveCount(2);
 for(const loanId of Object.values(fixture.loans) as string[]){const card=page.locator('[data-loan-row="'+loanId+'"]');await expect(card).toContainText('Compensado');await card.getByRole('button',{name:'Ver detalle',exact:true}).click();const detail=page.locator('[data-loan-detail="'+loanId+'"]');await expect(detail).toContainText('0 pendientes');await expect(detail).toContainText('Extinguida por cuenta final');await expect(detail.getByRole('button',{name:'Registrar pago',exact:true})).toHaveCount(0);}
 await page.screenshot({path:info.outputPath('loans-after.png'),fullPage:true,animations:'disabled'});
 await page.goto('/#/members');await page.locator('[data-savings-member-row="'+fixture.memberId+'"]').getByRole('button',{name:'Detalle',exact:true}).click();await expect(page.getByRole('dialog')).not.toContainText('Capital de préstamos propios pendiente');await page.screenshot({path:info.outputPath('member-after.png'),fullPage:true,animations:'disabled'});
 writeFileSync(folder+'/browser-paid.json',JSON.stringify(paid,null,2));
});
test('annulling only payout restores 32.72 and keeps compensated contracts closed',async({page},info)=>{
 await login(page);const before=await checkClosed(page);await page.goto('/#/more/movements');await page.getByRole('button',{name:/Cuenta final pagada/}).click();await page.getByRole('button',{name:'Anular',exact:true}).click();const sheet=page.getByRole('dialog');await sheet.getByLabel('Fecha de la anulación').fill('2026-10-20');await sheet.getByLabel('Motivo',{exact:true}).fill('Synthetic mistaken payout');const response=page.waitForResponse(r=>r.url()===api+'/rest/v1/rpc/reverse_financial_operation');await sheet.getByRole('button',{name:'Confirmar anulación',exact:true}).click();expect((await response).status()).toBe(200);await expect(sheet).toHaveCount(0);await page.reload();
 await expect(page.getByRole('heading',{name:'Movimientos financieros',exact:true})).toBeVisible();
 const after=await checkClosed(page);expect(after.bank).toBe((Number(before.bank)+32.72).toFixed(2));expect(after.settlements[0].status).toBe('confirmed');expect(after.sums.settlements_payable).toBe('-32.72');
 await page.screenshot({path:info.outputPath('payout-annulled.png'),fullPage:true,animations:'disabled'});writeFileSync(folder+'/browser-annulled.json',JSON.stringify(after,null,2));
});
test('mobile historical cut preserves pre-settlement debt and current cut shows zero',async({page},info)=>{
 await page.setViewportSize({width:375,height:1000});await login(page);await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-19');await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('1.049.506,00');await page.goto('/#/loans');await expect(page.locator('[data-loan-row]')).toHaveCount(2);
 await page.goto('/#/home');await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('0,00');await page.goto('/#/loans');await expect(page.getByRole('heading',{name:'Préstamos',exact:true})).toBeVisible();await expect(page.locator('[data-loan-row]')).toHaveCount(0);await page.getByRole('button',{name:/^Pagados/}).click();await expect(page.locator('[data-loan-row]')).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.reload();await expect(page.getByRole('heading',{name:'Préstamos',exact:true})).toBeVisible();await expect(page.locator('[data-loan-row]')).toHaveCount(0);await checkClosed(page);await page.screenshot({path:info.outputPath('mobile-closed.png'),fullPage:true,animations:'disabled'});
});
