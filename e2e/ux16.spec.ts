import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from './test-fixtures';
const base = 'docs/ux/evidence/ux16';
const fixture = JSON.parse(readFileSync('incoming/ux13-2026-10-20/fixture.json', 'utf8'));
const before = process.env.UX16_PHASE === 'before';
const api = 'http://127.0.0.1:55421';
const faults = new WeakMap<Page, string[]>();
async function auditPage(page: Page) {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + new URL(response.url()).pathname); });
  await page.route('**/rest/v1/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;if(req.method()!=='GET'&&!/\/rpc\/(preview_[a-z_]+|fin_civil_today)$/.test(path)){errors.push('Mutación no autorizada: '+path);return route.abort()}return route.fallback()});
  await page.route('**/*', route => ['http://127.0.0.1:5198', api, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin) ? route.fallback() : route.abort());
}
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-21T17:00:00Z'));
  await auditPage(page);
});
test.afterEach(async ({page}) => expect(faults.get(page)).toEqual([]));
async function login(page: Page, selected=fixture) {
  await page.goto('/'); await page.getByLabel('Correo autorizado').fill(selected.email);
  await page.getByRole('button', {name:'Enviar codigo',exact:true}).click(); await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail = inbox.messages.find((item:any) => item.To?.some((to:any) => to.Address === selected.email));
  const body = await (await page.request.get('http://127.0.0.1:55424/api/v1/message/' + encodeURIComponent(mail.ID))).json();
  const token = (String(body.Text ?? '') + String(body.HTML ?? '')).match(/\b\d{6}\b/)?.[0]; expect(token).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(token!); await page.getByRole('button', {name:'Ingresar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
  const target = await page.evaluate(async () => { const {supabase} = await import('/src/lib/supabase.ts'); return (supabase as any).supabaseUrl; }); expect(target).toBe(api);
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
}
async function invariants(page: Page, cut = '2026-10-20',selected=fixture) {
  return page.evaluate(async ({cycleId, cut}) => {
    const {supabase} = await import('/src/lib/supabase.ts');
    const {reconstructMoney} = await import('/src/domain/financialReconstruction.ts');
    const {bankPosition} = await import('/src/domain/bankPosition.ts');
    const read = async (table:string) => { const r=await supabase.from(table).select('*').eq('cycle_id',cycleId).order('id'); if(r.error)throw Error(r.error.message); return r.data; };
    const [operations,entries,members,contributions] = await Promise.all(['financial_operations','ledger_entries','cycle_members','savings_contributions'].map(read));
    const result = reconstructMoney(operations,entries,cut);
    const banks=await supabase.from('bank_accounts').select('*').eq('workspace_id',members[0].workspace_id);
    const bank=bankPosition(operations,entries,banks.data![0].id,cut);
    return { members:members.length, received:contributions.filter((x:any)=>x.status!=='reversed'&&x.effective_date<=cut).reduce((sum:number,x:any)=>sum+Number(x.amount),0).toFixed(2), accounts:Object.fromEntries([...result.accounts].map(([k,v]:any)=>[k,v.toFixed(2)])), bank:bank.balance.toFixed(2), interest:bank.interest.toFixed(2), base:bank.base.toFixed(2), operations:operations.length, entries:entries.length };
  },{cycleId:selected.cycleId,cut});
}

for(const width of [320,375,390,768,1024,1280,1440]) test('three views '+width,async({page})=>{
 await page.setViewportSize({width,height:1000}); await login(page);
 const path=base+'/'+(before?'before':'after')+'/'+width;mkdirSync(path,{recursive:true});
 const values=await invariants(page);writeFileSync(path+'/invariants.json',JSON.stringify(values,null,2));
 if(!before)expect(values).toEqual(JSON.parse(readFileSync(process.env.E2E_SQL_BASELINE || base+'/before/'+width+'/invariants.json','utf8')));
 for(const route of ['home','members','more/admin']){
  await page.goto('/#/'+route);
  if(route==='members'){await page.getByRole('button',{name:'Detalle',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();}
  if(route==='more/admin')await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
  if(!before&&route==='members'){await expect(page.getByRole('dialog').getByText('Pibank calculado al corte, sin nuevo abono',{exact:true})).toBeVisible();await expect(page.getByRole('dialog').locator('.insight-value').filter({hasText:'Ahorro total a su favor'})).toContainText('154.932,72');}
  if(!before&&route==='more/admin')await expect(page.getByRole('heading',{name:'Mi ganancia estimada al 5 de diciembre',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path+'/'+route.replace('more/','')+'.png',fullPage:true,animations:'disabled'});
  if(!before)expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(route==='members'){
    if(!before){const dialog=page.getByRole('dialog');await dialog.screenshot({path:path+'/member-dialog-top.png',animations:'disabled'});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expectReadable(page);await dialog.locator('.insight-history summary').click();await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await dialog.screenshot({path:path+'/member-dialog-history.png',animations:'disabled'});await expectReadable(page);}
    await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  }
 }
 expect(await invariants(page)).toEqual(values);
});

async function expectReadable(page:Page){
 const problems=await page.evaluate(()=>{const issues:string[]=[];if(document.documentElement.scrollWidth>innerWidth)issues.push('desborde global');const dialog=document.querySelector<HTMLElement>('.sheet:has(.member-insight)');if(dialog&&dialog.scrollWidth>dialog.clientWidth+1)issues.push('desborde diálogo');
 for(const el of document.querySelectorAll<HTMLElement>('.insight-value strong,.home-metric .metric-value,.sheet:has(.member-insight) .sheet-head h2,.sheet:has(.member-insight) .sheet-cancel')){
  const box=el.getBoundingClientRect();if(!el.getClientRects().length)continue;
  if(el.scrollWidth>el.clientWidth+1)issues.push('desborde '+el.textContent);
  if(box.left<0||box.right>innerWidth+1)issues.push('fuera de pantalla '+el.textContent);
  for(let parent=el.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent),b=parent.getBoundingClientRect();if(/hidden|clip/.test(css.overflowX)&&(box.left<b.left-1||box.right>b.right+1))issues.push('recorte '+el.textContent)}
 }return issues});expect(problems).toEqual([]);
}
for(const width of [390,1440])test('six cards and shared cut '+width,async({page})=>{
 test.skip(before);await page.setViewportSize({width,height:1000});await login(page);const snapshot=await invariants(page);
 await expect(page.locator('.home-metric')).toHaveCount(6);
 const cards=[['dinero-en-caja','more/bank'],['dinero-prestado','loans'],['intereses-prestamos-cobrados','loans'],['intereses-cobrados','more/yield'],['ahorro-del-ciclo','savings'],['bolsa-polla','polla']];
 for(const[key,route]of cards){await page.goto('/#/home');await page.locator('[data-figure-key="'+key+'"]').focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(new RegExp('#/'+route+'$'));}
 await page.goto('/#/home');await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');await expect(page.locator('[data-figure-key="intereses-prestamos-cobrados"]')).toContainText('0,00');
 await page.goto('/#/members');await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-09-20');await page.goto('/#/more/admin');await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-09-20');await expect(page.locator('.admin-projection')).toContainText('Total neto no verificable');
 expect(await invariants(page)).toEqual(snapshot);
});
for(const width of [320,1440])test('verified receipts, B, Annie and conditional scenarios '+width,async({page})=>{
 test.skip(before);const f=JSON.parse(readFileSync('incoming/ux16/scenarios/fixture.json','utf8'));await page.setViewportSize({width,height:1000});await login(page,f);const original=await invariants(page,'2026-10-20',f);
 await expect(page.locator('[data-figure-key="intereses-prestamos-cobrados"] [data-figure-value]')).toContainText('150.000,00');
 await expect(page.locator('[data-figure-key="intereses-cobrados"] [data-figure-value]')).toContainText('1.000,00');
 await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');await expect(page.locator('[data-figure-key="intereses-prestamos-cobrados"] [data-figure-value]')).toContainText('100.000,00');await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
 await page.goto('/#/members');await page.locator('.member-directory-table tbody tr').filter({hasText:'Annie Sintetica'}).getByRole('button',{name:'Detalle',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Retiro verificado');await expect(dialog).toContainText('15/09/2026');await expect(dialog).toContainText('Utilidad congelada al retiro');
 const frozen=await dialog.locator('.insight-value').filter({hasText:'Utilidad congelada al retiro'}).innerText();writeFileSync(base+'/annie-frozen.json',JSON.stringify({cut:'2026-10-20',frozen}));
 await dialog.locator('.insight-details').first().locator('summary').click();await expect(dialog).toContainText('Estado actual: pendiente de pago');await dialog.screenshot({path:base+'/after/'+width+'/annie-retired.png',animations:'disabled'});await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.locator('.member-directory-table tbody tr').filter({hasText:'Carlos Sintetico'}).getByRole('button',{name:'Detalle',exact:true}).click();await expect(dialog).toContainText('12 % EA devengado al corte');await expect(dialog).toContainText('participación registrada 7–12');await expect(dialog.locator('.insight-value').filter({hasText:'Aportes ordinarios recibidos'})).toContainText('1.000.000,00');await expect(dialog).toContainText('No participa en utilidades colectivas');await expectReadable(page);
 await dialog.locator('.insight-history summary').click();await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await dialog.screenshot({path:base+'/after/'+width+'/fixed-yield-history.png',animations:'disabled'});await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.goto('/#/more/admin');await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();const projection=page.locator('.admin-projection');await expect(projection).not.toContainText('Total neto no verificable');const available=await page.getByText('Disponible para retirar',{exact:true}).locator('..').innerText();const extra=projection.locator('.insight-value').filter({hasText:'Podrías ganar adicionalmente'});const initial=await extra.innerText();await projection.getByRole('checkbox').first().uncheck();expect(await extra.innerText()).not.toBe(initial);await projection.getByRole('checkbox').last().uncheck();await expect(extra).toContainText('0,00');expect(await page.getByText('Disponible para retirar',{exact:true}).locator('..').innerText()).toBe(available);
 await projection.getByRole('checkbox').first().check();await projection.getByRole('checkbox').last().check();await projection.locator('summary').click();await expect(projection).toContainText('Interés vencido incierto');await expect(projection).toContainText('Sin multas futuras');await expectReadable(page);await page.screenshot({path:base+'/after/'+width+'/admin-scenario-expanded.png',fullPage:true,animations:'disabled'});
 await projection.getByRole('button',{name:'Ver préstamos',exact:true}).click();await expect(page).toHaveURL(/#\/loans$/);expect(await invariants(page,'2026-10-20',f)).toEqual(original);
 writeFileSync(base+'/scenario-invariants.json',JSON.stringify(original,null,2));
});
test('same detail in Savings, missing retirement, zero contributions, retry and text200',async({page})=>{
 test.skip(before);await page.setViewportSize({width:320,height:1000});await login(page);const original=await invariants(page);
 await page.goto('/#/members');await page.getByRole('button',{name:'Detalle',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Pibank calculado al corte');const ordinary=await dialog.locator('.insight-value').filter({hasText:'Aportes ordinarios recibidos'}).locator('strong').innerText();await dialog.getByRole('button',{name:'Ver ahorro e historial',exact:true}).click();await expect(page).toHaveURL(/#\/savings$/);await expect(dialog.locator('.insight-value').filter({hasText:'Aportes ordinarios recibidos'}).locator('strong')).toHaveText(ordinary);await dialog.getByRole('button',{name:'Ver ahorro e historial',exact:true}).click();await expect(dialog.locator('.insight-history')).toHaveAttribute('open','');await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.goto('/#/members');await page.locator('.member-directory-table tbody tr').filter({hasText:'Diego Retirado'}).getByRole('button',{name:'Detalle',exact:true}).click();await expect(dialog).toContainText('Falta fecha efectiva de retiro');await expect(dialog.locator('.insight-value').filter({hasText:'Meta del año'})).toContainText('No verificable');await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.locator('.member-directory-table tbody tr').filter({hasText:'Elena Ingresa'}).getByRole('button',{name:'Detalle',exact:true}).click();await expect(dialog.getByText('Consultando beneficios…',{exact:true})).toHaveCount(0);await dialog.locator('.insight-history summary').click();await expect(dialog).toContainText('Sin aportes ordinarios');await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.addStyleTag({content:'html{font-size:200% !important}'});await page.getByRole('button',{name:'Detalle',exact:true}).first().click();await expectReadable(page);await dialog.screenshot({path:base+'/after/320/member-text200.png',animations:'disabled'});await page.keyboard.press('Escape');await page.goto('/#/home');await expectReadable(page);await page.screenshot({path:base+'/after/320/home-text200.png',fullPage:true,animations:'disabled'});await page.goto('/#/more/admin');await expect(page.locator('.admin-projection')).toBeVisible();await expectReadable(page);await page.screenshot({path:base+'/after/320/admin-text200.png',fullPage:true,animations:'disabled'});expect(await invariants(page)).toEqual(original);
});

test('benefit read failure can retry without changing any financial record',async({page})=>{
 test.skip(before);await login(page);const snapshot=await invariants(page);await page.goto('/#/members');
 await page.route('**/rpc/preview_member_settlement',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic TEST benefit read unavailable'})}));
 await page.getByRole('button',{name:'Detalle',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('button',{name:'Reintentar beneficios',exact:true})).toBeVisible();
 const expected=faults.get(page)!;expect(expected.some(x=>x.startsWith('503 /rest/v1/rpc/preview_member_settlement'))).toBe(true);expect(expected.every(x=>/503/.test(x))).toBe(true);expected.length=0;
 await page.unroute('**/rpc/preview_member_settlement');await dialog.getByRole('button',{name:'Reintentar beneficios',exact:true}).click();await expect(dialog.getByText('Pibank calculado al corte, sin nuevo abono',{exact:true})).toBeVisible();await expect(dialog.getByRole('alert')).toHaveCount(0);expect(await invariants(page)).toEqual(snapshot);
});

test('historical projection uncertainty, reduced motion and enlarged detail focus',async({page})=>{
 test.skip(before);await page.setViewportSize({width:320,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await login(page);await page.goto('/#/members');await page.getByRole('button',{name:'Detalle',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Pibank calculado al corte');await dialog.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');await expect(dialog).toContainText('Proyección histórica no verificable');await expect(dialog.locator('.insight-value').filter({hasText:'Posición neta de cuenta final estimada'})).toContainText('No verificable');await dialog.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');await expect(dialog.getByText('Consultando beneficios…',{exact:true})).toHaveCount(0);
 await page.addStyleTag({content:'html{font-size:200% !important}'});const action=dialog.getByRole('button',{name:'Ver préstamos',exact:true});await action.focus();await expect(action).toBeInViewport({ratio:1});const bounds=await action.boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(1000);await expectReadable(page);await dialog.screenshot({path:base+'/after/320/member-text200-benefits.png',animations:'disabled'});await page.keyboard.press('Enter');await expect(page).toHaveURL(/#\/loans$/);
});
