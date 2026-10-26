import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
const base = 'incoming/ux13-2026-10-20';
const fixture = JSON.parse(readFileSync(base + '/fixture.json', 'utf8'));
const before = process.env.UX13_PHASE === 'before';
const modules = ['bank', 'movements', 'yield', 'admin', 'settlements', 'profit', 'stats', 'exports'];
const titles = ['Banco y caja','Movimientos financieros','Rendimientos bancarios','Mi ganancia como administrador','Cuentas finales de socios','Ganancia de préstamos de los socios','Distribución del dinero','Respaldos'];
const api = 'http://127.0.0.1:55421';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({page}) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + new URL(response.url()).pathname); });
  await page.route('**/*', route => ['http://127.0.0.1:5198', api, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});
test.afterEach(async ({page}) => expect(faults.get(page)).toEqual([]));
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('Correo autorizado').fill(fixture.email);
  await page.getByRole('button', {name:'Enviar codigo',exact:true}).click(); await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail = inbox.messages.find((item:any) => item.To?.some((to:any) => to.Address === fixture.email));
  const body = await (await page.request.get('http://127.0.0.1:55424/api/v1/message/' + encodeURIComponent(mail.ID))).json();
  const token = (String(body.Text ?? '') + String(body.HTML ?? '')).match(/\b\d{6}\b/)?.[0]; expect(token).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(token!); await page.getByRole('button', {name:'Ingresar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
  const target = await page.evaluate(async () => { const {supabase} = await import('/src/lib/supabase.ts'); return (supabase as any).supabaseUrl; }); expect(target).toBe(api);
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
}
async function invariants(page: Page) {
  return page.evaluate(async cycleId => {
    const {supabase} = await import('/src/lib/supabase.ts');
    const {reconstructMoney} = await import('/src/domain/financialReconstruction.ts');
    const {bankPosition} = await import('/src/domain/bankPosition.ts');
    const read = async (table:string) => { const r=await supabase.from(table).select('*').eq('cycle_id',cycleId).order('id'); if(r.error)throw Error(r.error.message); return r.data; };
    const [operations,entries,members,contributions] = await Promise.all(['financial_operations','ledger_entries','cycle_members','savings_contributions'].map(read));
    const result = reconstructMoney(operations,entries,'2026-10-20');
    const banks=await supabase.from('bank_accounts').select('*').eq('workspace_id',members[0].workspace_id);
    const bank=bankPosition(operations,entries,banks.data![0].id,'2026-10-20');
    return { members:members.length, received:contributions.filter((x:any)=>x.status!=='reversed'&&x.effective_date<='2026-10-20').reduce((sum:number,x:any)=>sum+Number(x.amount),0).toFixed(2), accounts:Object.fromEntries([...result.accounts].map(([k,v]:any)=>[k,v.toFixed(2)])), bank:bank.balance.toFixed(2), interest:bank.interest.toFixed(2), base:bank.base.toFixed(2), operations:operations.length, entries:entries.length };
  },fixture.cycleId);
}
async function overflow(page: Page) {
  return page.evaluate(() => ({global:document.documentElement.scrollWidth>innerWidth,local:[...document.querySelectorAll<HTMLElement>('.metric-value,.metric-label,.more-hub-text strong,.hero-band h2,.page-heading h2,.members-actions')].filter(el=>el.getClientRects().length&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)).map(el=>({text:el.textContent?.trim(),width:el.clientWidth,scroll:el.scrollWidth}))}));
}
for (const width of [320,375,390,768,1024,1440]) test('inventory and invariants at '+width,async({page})=>{
  await page.setViewportSize({width,height:1000}); await login(page);
  const expected=await invariants(page); const path=(process.env.UX13_EVIDENCE_DIR || base)+'/'+(before?'before':'after')+'/'+width;mkdirSync(path,{recursive:true});
  if(before)writeFileSync(path+'/invariants.json',JSON.stringify(expected,null,2)); else expect(expected).toEqual(JSON.parse(readFileSync(base+'/before/'+width+'/invariants.json','utf8')));
  const inventory:any[]=[];
  for (const id of ['home','members',...modules.map(id=>'more/'+id)]) {
    await page.goto('/#/'+id); const section=id.split('/')[1];
    await expect(page.getByRole('heading',{name:id==='home'?'Inicio':id==='members'?'Socios':titles[modules.indexOf(section)],exact:true}).first()).toBeVisible();
    await page.evaluate(()=>document.fonts.ready); await page.screenshot({path:path+'/'+id.replace('/','-')+'.png',fullPage:true,animations:'disabled'});
    const issues=await overflow(page);inventory.push({route:id,headings:await page.locator('h2,h3').allTextContents(),buttons:await page.getByRole('button').allTextContents(),overflow:issues});
    if(!before){expect(issues.global,id+' global').toBe(false);expect(issues.local,id+' local').toEqual([]);}
    if(!before&&id==='home'){
      await expect(page.locator('.home-metrics .home-metric')).toHaveCount(6);
      await expect(page.locator('.home-page .bank-position,.home-page .money-reconstruction,.home-page .home-grid')).toHaveCount(0);
      for(const [key,value]of [['dinero-en-caja',expected.bank],['dinero-prestado',expected.accounts.loans_receivable],['intereses-cobrados',expected.interest],['ahorro-del-ciclo',(-Number(expected.accounts.savings_liability)).toFixed(2)],['bolsa-polla',(-Number(expected.accounts.polla_pool)).toFixed(2)]]){
        const formatted=new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
        await expect(page.locator('[data-figure-key="'+key+'"] [data-figure-value]')).toContainText(formatted);
      }
    }
  }
  writeFileSync(path+'/inventory.json',JSON.stringify(inventory,null,2));
  expect(await invariants(page)).toEqual(expected);
});
test('Home presentation retains canonical amounts and moves details out',async({page})=>{
  test.skip(before); await page.setViewportSize({width:375,height:1000}); await login(page);
  const model=await invariants(page);expect(model).toEqual(JSON.parse(readFileSync(base+'/before/375/invariants.json','utf8')));
  await expect(page.locator('.home-metrics .home-metric')).toHaveCount(6);
  await expect(page.locator('.home-page .bank-position,.home-page .money-reconstruction,.home-page .home-grid')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Gestionar polla'})).toBeVisible();
  expect(await overflow(page)).toEqual({global:false,local:[]});
  await page.getByRole('button',{name:'Gestionar polla'}).click();await expect(page.getByRole('heading',{name:'Polla',exact:true})).toBeVisible();
});
test('Socios monthly context, modes, withdrawn, empty and detail access',async({page})=>{
  test.skip(before);await page.setViewportSize({width:375,height:1000});await login(page);await page.goto('/#/members');
  await expect(page.locator('[data-member-stat=active]')).toHaveText('3');
  await expect(page.locator('[data-member-stat=complete]')).toHaveText('1 de 3');
  await expect(page.locator('[data-member-stat=pending]')).toHaveText('2');
  await expect(page.getByText('B · Solo ahorro',{exact:true})).toHaveCount(2);
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');
  await expect(page.locator('[data-member-stat=complete]')).toHaveText('3 de 3');
  await expect(page.locator('[data-member-stat=pending]')).toHaveText('0');
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
  const row=page.locator('[data-savings-member-row="'+fixture.memberId+'"]');
  await row.getByRole('button',{name:'Detalle',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click();
  await row.getByRole('button',{name:'Editar',exact:true}).click();await expect(page.getByRole('heading',{name:'Editar socio',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click();
  await row.getByRole('button',{name:'Ver ahorro',exact:true}).click();await expect(page).toHaveURL(/#\/savings/);await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click();
  await page.goto('/#/members');await page.getByRole('searchbox',{name:'Buscar socio'}).fill('nunca-existe');await expect(page.getByText('No hay socios que coincidan con la búsqueda y los filtros.')).toBeVisible();
  await page.route('**/rest/v1/cycle_members?**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'*/0'},body:'[]'}));
  await page.reload();await expect(page.locator('[data-member-stat=active]')).toHaveText('0');await expect(page.locator('[data-member-stat=complete]')).toHaveText('0 de 0');
  await expect(page.getByRole('button',{name:'Nuevo socio',exact:true})).toBeVisible();
});
for(const width of [375,1440])test('navigation, audit details, backups and keyboard at '+width,async({page})=>{
  test.skip(before);await page.setViewportSize({width,height:1000});await login(page);const model=await invariants(page);
  await page.goto('/#/more/bank');
  const names=['Banco y caja','Movimientos','Rendimientos','Administración','Cuentas finales','Utilidades','Estadísticas','Respaldos'];
  for(let i=1;i<modules.length;i++){
    await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();
    await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:names[i],exact:true}).click();
    await expect(page.getByRole('heading',{name:titles[i],exact:true}).first()).toBeVisible();await expect(page).toHaveURL(new RegExp('#/more/'+modules[i]+'$'));
    await page.goBack();
    await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Banco y caja',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Banco y caja',exact:true})).toBeVisible();
  }
  await page.getByText('Ver cálculo del dinero',{exact:true}).click();
  await expect(page.getByRole('article',{name:'Dinero de la natillera en el banco'})).toBeVisible();
  await page.getByText('Cómo se calcula el dinero al 20/10/2026',{exact:true}).click();await page.getByText('Operaciones y saldo acumulado',{exact:true}).click();
  await expect(page.locator('.money-reconstruction .row-list li').first()).toBeVisible();
  await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();
  await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Rendimientos',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Abonos Pibank recibidos',exact:true})).toBeVisible();await expect(page.locator('.bank-interest-history')).toContainText('12,34');
  await page.locator('.bank-interest-history').getByRole('button',{name:'Ver movimientos',exact:true}).click();
  await page.getByRole('button',{name:'Banco',exact:true}).click();const receipt=page.locator('.movement-row').filter({hasText:'Rendimiento bancario recibido'}).first();await expect(receipt).toContainText('12,34');await receipt.click();await expect(page.getByText('Detalle del movimiento',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Ahorro',exact:true}).click();await page.locator('.movement-row').first().click();await expect(page.getByRole('button',{name:'Anular',exact:true})).toBeVisible();
  await page.goto('/#more/admin');await expect(page.getByRole('heading',{name:'Mi ganancia como administrador',exact:true})).toBeVisible();
  await page.getByText('Ver movimientos del administrador',{exact:true}).click();await expect(page.locator('.admin-history li').first()).toBeVisible();
  await page.goto('/#/more/exports');
  for(const [label,isJson]of [['Descargar respaldo',true],['Descargar reporte CSV',false]] as const){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await pending;
    const stream=await download.createReadStream();const parts:Buffer[]=[];for await(const chunk of stream!)parts.push(Buffer.from(chunk));const data=Buffer.concat(parts).toString();
    expect(data).not.toMatch(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./);
    if(isJson)expect(JSON.parse(data).tables).toBeTruthy();else expect(data).toContain('aportes_ahorro');
  }
  await page.getByText('Qué incluye el respaldo',{exact:true}).click();await expect(page.locator('.backup-inventory .count-grid')).toBeVisible();
  await page.goto('/#/members');await page.getByRole('searchbox',{name:'Buscar socio'}).focus();await expect(page.getByRole('searchbox',{name:'Buscar socio'})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Ver ahorro',exact:true}).first()).toBeFocused();
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/more/admin');
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect((await overflow(page)).global).toBe(false);
  await page.evaluate(()=>document.documentElement.style.fontSize='');expect(await invariants(page)).toEqual(model);
});
