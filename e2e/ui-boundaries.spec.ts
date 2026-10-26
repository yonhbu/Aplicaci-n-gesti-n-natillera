import {expect,test,type Page} from '@playwright/test';
const app='http://127.0.0.1:5196',api='http://127.0.0.1:55421';
const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const list:string[]=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))list.push(m.text());});});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
async function login(page:Page,email='qa-ux-cortes@example.test'){
  await page.route('**/*',r=>[app,api,'https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByLabel('Correo autorizado').fill(email);
  const response=page.waitForResponse(r=>r.url()===api+'/auth/v1/otp');await page.getByRole('button',{name:'Enviar codigo',exact:true}).click();expect((await response).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();const inbox=await(await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const m=inbox.messages.find((m:{To?:{Address:string}[]})=>m.To?.some(t=>t.Address===email));
  const d=await(await page.request.get('http://127.0.0.1:55424/api/v1/message/'+encodeURIComponent(m.ID))).json();const token=`${d.Text??''}\n${d.HTML??''}`.match(/\b\d{6}\b/)?.[0];expect(token).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(token!);await page.getByRole('button',{name:'Ingresar',exact:true}).click();await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
}
async function settlements(page:Page,name='QA Liquidación detallada'){
  await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Cuentas finales de socios',exact:true}).click();await page.getByRole('button').filter({hasText:name}).click();
}
async function calculate(page:Page,date='2026-10-16'){
  await page.getByLabel('Fecha de corte',{exact:true}).fill(date);await page.getByRole('button',{name:'Calcular',exact:true}).click();await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeVisible();
}
async function records(page:Page,table:string,field:string,value:string){
  return page.evaluate(async({table,field,value})=>{const {supabase}=await import('/src/lib/supabase.ts');const {data,error}=await supabase.from(table).select('*').eq(field,value);if(error)throw Error(error.message);return data;},{table,field,value});
}
async function loans(page:Page){await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Préstamos',exact:true}).click();}
test('debts identify each contract, principal and agreed interest',async({page})=>{
  await login(page);await settlements(page);await calculate(page);const d=page.getByRole('dialog');
  await expect(d.getByText('QA-P013',{exact:false})).toBeVisible();await expect(d.getByText('QA-P005',{exact:false})).toBeVisible();await expect(d).toContainText('Interés acordado');
  await expect(d.getByText('Cuota de administración',{exact:true})).toBeVisible();await expect(d.getByText('Multa por retiro',{exact:true})).toBeVisible();
});
test('negative net is explained and cannot be confirmed',async({page})=>{
  await login(page);await settlements(page);await calculate(page);await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeDisabled();await expect(page.getByRole('dialog')).toContainText('faltante');
});
test('awards remain explained when the cutoff crosses their effective day',async({page})=>{
  await login(page);await settlements(page);await calculate(page,'2026-10-11');await expect(page.getByRole('dialog')).toContainText('135.000');
  await calculate(page,'2026-10-10');await expect(page.getByRole('dialog')).toContainText('Después del corte');await expect(page.getByRole('dialog')).toContainText('35.000');
  await calculate(page,'2026-10-09');await expect(page.getByRole('dialog').getByText('Después del corte',{exact:false})).toHaveCount(2);
});
test('loan card body opens the correct detail and moves focus into it',async({page})=>{
  await login(page);await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Préstamos',exact:true}).click();const card=page.getByRole('article').filter({hasText:'QA-P013'});await card.click({position:{x:90,y:30}});
  const detail=page.locator('[data-loan-detail]');await expect(detail).toBeVisible();await expect(detail).toContainText('QA-P013');await expect(detail).toBeFocused();
});

test('manual cycle shows zero fees and applies only entered amounts',async({page})=>{
  await login(page,'qa-ux-manual@example.test');await settlements(page);await calculate(page);const d=page.getByRole('dialog');
  await expect(d).toContainText('descuentos manuales');await expect(d.locator('.total-row')).toContainText('60.494,00');
  await expect(d.locator('.breakdown .value-row').filter({hasText:'Cuota de administración'})).toContainText('0,00');
  await d.getByLabel('Cuota de administración',{exact:true}).fill('20.000');await d.getByLabel('Multa por retiro',{exact:true}).fill('50.000');await calculate(page);
  await expect(d.locator('.total-row')).toContainText('9.506,00');await expect(d.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeDisabled();
});
test('malformed money and cutoff boundaries do not call preview',async({page})=>{
  await login(page,'qa-ux-manual@example.test');await settlements(page);let count=0;page.on('request',r=>{if(r.url().endsWith('/rpc/preview_member_settlement'))count++;});
  const d=page.getByRole('dialog');for(const value of ['-1','NaN','1,234','1.23','1e9']){await d.getByLabel('Otros descuentos',{exact:true}).fill(value);await expect(d.getByRole('button',{name:'Calcular',exact:true})).toBeDisabled();}
  await d.getByLabel('Otros descuentos',{exact:true}).fill('0');for(const value of ['','2025-12-31','2026-12-06']){await d.getByLabel('Fecha de corte',{exact:true}).fill(value);await expect(d.getByRole('button',{name:'Calcular',exact:true})).toBeDisabled();}expect(count).toBe(0);
  await d.getByLabel('Otros descuentos',{exact:true}).fill('0,01');await calculate(page);await expect(d.locator('.total-row')).toContainText('60.493,99');
});
test('future simulation and closing-day penalty are explicit',async({page})=>{
  await login(page);await settlements(page,'QA Neto positivo');await calculate(page,'2026-12-05');const d=page.getByRole('dialog');await expect(d).toContainText('fecha futura');await expect(d.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeDisabled();
  await expect(d.locator('.breakdown .value-row').filter({hasText:'Multa por retiro'})).toContainText('0,00');
  await calculate(page,'2026-12-04');await expect(d.locator('.breakdown .value-row').filter({hasText:'Multa por retiro'})).toContainText('50.000,00');
});
test('pending prize and fixed saver use different entitlements',async({page})=>{
  await login(page);await settlements(page,'QA Neto positivo');await calculate(page);const d=page.getByRole('dialog');await expect(d).toContainText('Incluido como premio pendiente');await expect(d.locator('.breakdown .value-row').filter({hasText:'Premios pendientes por acreditar'})).toContainText('45.000,00');
  await d.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('button').filter({hasText:'QA Solo ahorro'}).click();await calculate(page);await expect(d.locator('.breakdown')).toContainText('Rendimiento 12 % EA');await expect(d.getByRole('region',{name:'Premios y fecha de corte'})).toHaveCount(0);
});
test('discount inputs reset when changing member and modal traps keyboard',async({page})=>{
  await login(page,'qa-ux-manual@example.test');await settlements(page);const d=page.getByRole('dialog');await d.getByLabel('Cuota de administración',{exact:true}).fill('123');await d.getByLabel('Otros descuentos',{exact:true}).fill('456');
  await d.getByRole('button',{name:'Calcular',exact:true}).focus();await page.keyboard.press('Tab');await expect(d.getByRole('button',{name:'Cancelar',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(d.getByRole('button',{name:'Calcular',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(d).toHaveCount(0);await expect(page.getByRole('button').filter({hasText:'QA Liquidación detallada'})).toBeFocused();
  await page.getByRole('button').filter({hasText:'QA Neto positivo'}).click();await expect(d.getByLabel('Cuota de administración',{exact:true})).toHaveValue('0');await expect(d.getByLabel('Otros descuentos',{exact:true})).toHaveValue('0');
});
test('late response from closed member cannot populate the next member',async({page})=>{
  await login(page);await settlements(page);let release!:()=>void,arrived!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>arrived=r);
  await page.route(api+'/rest/v1/rpc/preview_member_settlement',async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'Calcular',exact:true}).click();await seen;await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('button').filter({hasText:'QA Neto positivo'}).click();release();
  await calculate(page);const d=page.getByRole('dialog');await expect(d.locator('.total-row')).toContainText('175.000,00');await expect(d).not.toContainText('QA-P013');
});
test('out-of-order previews keep the latest date and balance',async({page})=>{
  await login(page);await settlements(page);let release!:()=>void,arrived!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>arrived=r);
  await page.route(api+'/rest/v1/rpc/preview_member_settlement',async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'Calcular',exact:true}).click();await seen;await calculate(page,'2026-10-09');release();
  await expect(page.getByRole('dialog').locator('.total-row')).toContainText('144.506,00');await expect(page.getByRole('dialog').getByText('Después del corte',{exact:false})).toHaveCount(2);
});
test('failed preview is retryable without phantom success',async({page})=>{
  await login(page);await settlements(page);await page.route(api+'/rest/v1/rpc/preview_member_settlement',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'synthetic backend failure'})}),{times:1});
  await page.getByRole('button',{name:'Calcular',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('No se guardo ningun exito aparente');await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toHaveCount(0);await calculate(page);await expect(page.getByText('QA-P013',{exact:true})).toBeVisible();
});
test('loan cards open by title, amount, keyboard and preserve secondary action',async({page})=>{
  await login(page);await loans(page);const card=page.getByRole('article').filter({hasText:'QA-P013'}),detail=page.locator('[data-loan-detail]');
  for(const position of [{x:60,y:30},{x:30,y:70}]){await card.click({position});await expect(detail).toBeFocused();await detail.getByRole('button',{name:'Cerrar detalle'}).click();await expect(card.getByRole('button',{name:'Ver detalle'})).toBeFocused();}
  await page.keyboard.press('Enter');await expect(detail).toBeFocused();await detail.getByRole('button',{name:'Cerrar detalle'}).click();
  await page.getByRole('article').filter({hasText:'QA-DRAFT'}).getByRole('button',{name:'Desembolsar',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Desembolsar préstamo');await expect(detail).toHaveCount(0);await page.keyboard.press('Escape');
});
test('loan search handles accent, case, code and empty filter',async({page})=>{
  await login(page);await loans(page);const search=page.getByRole('searchbox');await search.fill('liquidacion');await expect(page.getByRole('article')).toHaveCount(2);await search.fill('qa-p013');await expect(page.getByRole('article')).toHaveCount(1);await search.fill('NO-EXISTE');await expect(page.getByRole('article')).toHaveCount(0);await expect(page.getByText('No hay contratos que coincidan con el filtro.')).toBeVisible();await search.fill('');await page.getByRole('button',{name:/^Pagados/}).click();await expect(page.getByRole('article')).toHaveCount(0);await page.getByRole('button',{name:/^Todos/}).click();await expect(page.getByRole('article')).toHaveCount(3);
});
test('settlement fits narrow landscape without horizontal page overflow',async({page})=>{
  await login(page);await page.setViewportSize({width:812,height:375});await settlements(page);await calculate(page);await expect(page.getByText('QA-P013',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);const d=page.getByRole('dialog');expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await d.getByRole('button',{name:'Confirmar cuenta final',exact:true}).scrollIntoViewIfNeeded();await expect(d.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeInViewport();
});
test('confirmed and paid snapshot persists; missing ref and empty source cannot pay',async({page},info)=>{
  await login(page,'qa-ux-manual@example.test');const memberId='f4170000-0000-4000-8000-'+(info.project.name==='desktop'?'000000000204':'000000000205');const name='QA Pago '+info.project.name;
  await settlements(page,name);const d=page.getByRole('dialog');let saved=await records(page,'member_settlements','cycle_member_id',memberId);
  if(!saved.length){await d.getByLabel('Cuota de administración',{exact:true}).fill('20.000');await d.getByLabel('Multa por retiro',{exact:true}).fill('50.000');await calculate(page);await d.getByRole('button',{name:'Confirmar cuenta final',exact:true}).click();await expect(d.getByText('Cálculo confirmado',{exact:false})).toBeVisible();saved=await records(page,'member_settlements','cycle_member_id',memberId);}
  expect(saved).toHaveLength(1);expect(Number(saved[0].net_amount)).toBe(130000);expect(saved[0].snapshot.annual_admin_fee).toBe(20000);await page.reload();await page.getByRole('button').filter({hasText:name}).click();await expect(d.locator('.breakdown .value-row').filter({hasText:'Multa por retiro'})).toContainText('50.000,00');
  if(saved[0].status!=='paid'){
    const pay=d.getByRole('button',{name:/^Pagar \$/});await expect(pay).toBeDisabled();await d.getByLabel('Referencia',{exact:true}).fill('UX-'+info.project.name);await d.getByLabel('Fecha del pago',{exact:true}).fill('2026-10-17');await expect(pay).toBeDisabled();await d.getByLabel('Fecha del pago',{exact:true}).fill('2026-10-16');await d.getByRole('combobox',{name:'Cuenta',exact:true}).selectOption({label:'QA Sin saldo'});
    const failed=page.waitForResponse(r=>r.url().endsWith('/rpc/pay_member_settlement'));await pay.click();expect((await failed).status()).toBe(400);await expect(d).toContainText('No hay dinero suficiente');expect((await records(page,'member_settlements','cycle_member_id',memberId))[0].status).toBe('confirmed');
    await d.getByRole('combobox',{name:'Cuenta',exact:true}).selectOption({label:'QA Cuenta principal'});const paid=page.waitForResponse(r=>r.url().endsWith('/rpc/pay_member_settlement'));await pay.click();expect((await paid).status()).toBe(200);await expect(d).toHaveCount(0);await page.reload();await page.getByRole('button').filter({hasText:name}).click();
  }
  await expect(d).toContainText('Pagada:');await expect(d).toContainText('16 oct 2026');const final=await records(page,'member_settlements','cycle_member_id',memberId);expect(final).toHaveLength(1);expect(final[0].status).toBe('paid');expect(Number(final[0].transfer_amount)).toBe(130000);
  const payments=await records(page,'member_settlement_payments','settlement_id',final[0].id);expect(payments).toHaveLength(1);expect(Number(payments[0].amount)).toBe(130000);const entries=await records(page,'ledger_entries','operation_id',payments[0].operation_id);expect(entries.reduce((sum,e)=>sum+Number(e.amount),0)).toBe(0);expect(entries.filter(e=>e.account==='cash')).toHaveLength(1);expect(Number(entries.find(e=>e.account==='cash').amount)).toBe(-130000);
});

test('stale confirmation returns actionable error and requires recalculation',async({page})=>{
  await login(page,'qa-ux-manual@example.test');await settlements(page,'QA Sin aportes');await calculate(page);
  await page.route(api+'/rest/v1/rpc/confirm_member_settlement',async route=>{const data=route.request().postDataJSON();const response=await route.fetch({postData:{...data,p_preview_hash:'stale-synthetic-hash'}});await route.fulfill({response});},{times:1});
  const response=page.waitForResponse(r=>r.url().endsWith('/rpc/confirm_member_settlement'));await page.getByRole('button',{name:'Confirmar cuenta final',exact:true}).click();expect((await response).status()).toBe(400);await expect(page.getByRole('dialog')).toContainText('Los saldos cambiaron');await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toHaveCount(0);await calculate(page);await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeEnabled();
});
test('committed zero settlement survives lost response and does not create zero payment',async({page},info)=>{
  await login(page,'qa-ux-manual@example.test');const n=info.project.name==='desktop'?6:7;const memberId='f4170000-0000-4000-8000-'+String(200+n).padStart(12,'0');await settlements(page,'QA Participante '+n);
  if(!(await records(page,'member_settlements','cycle_member_id',memberId)).length){
    await calculate(page);let resolve!:()=>void;const committed=new Promise<void>(r=>resolve=r);await page.route(api+'/rest/v1/rpc/confirm_member_settlement',async route=>{const result=await route.fetch();expect(result.status()).toBe(200);resolve();await route.abort('connectionfailed');},{times:1});
    await page.getByRole('button',{name:'Confirmar cuenta final',exact:true}).click();await committed;await expect(page.getByText('No se pudo confirmar si la operación quedó guardada.',{exact:false})).toBeVisible();
  }
  await page.reload();await page.getByRole('button').filter({hasText:'QA Participante '+n}).click();await expect(page.getByRole('dialog')).toContainText('No se registra un pago de $0');await expect(page.getByRole('dialog').getByRole('button',{name:/^Pagar \$/})).toHaveCount(0);
  const s=await records(page,'member_settlements','cycle_member_id',memberId);expect(s).toHaveLength(1);expect(s[0].status).toBe('confirmed');expect(await records(page,'member_settlement_payments','settlement_id',s[0].id)).toHaveLength(0);
});
