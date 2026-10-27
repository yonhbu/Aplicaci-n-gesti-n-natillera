import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from './test-fixtures';
const base = 'docs/ux/evidence/ux15';
const fixture = JSON.parse(readFileSync('incoming/ux13-2026-10-20/fixture.json', 'utf8'));
const before = process.env.UX15_PHASE === 'before';
const api = 'http://127.0.0.1:55421';
const faults = new WeakMap<Page, string[]>();
async function auditPage(page: Page) {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + new URL(response.url()).pathname); });
  await page.route('**/*', route => ['http://127.0.0.1:5198', api, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin) ? route.fallback() : route.abort());
}
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-10-20T17:00:00Z'));
  await auditPage(page);
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
async function invariants(page: Page, cut = '2026-10-20') {
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
  },{cycleId:fixture.cycleId,cut});
}
async function overflow(page: Page) {
  return page.evaluate(() => ({global:document.documentElement.scrollWidth>innerWidth,local:[...document.querySelectorAll<HTMLElement>('.metric-value,.metric-label,.more-hub-text strong,.hero-band h2,.page-heading h2,.members-actions')].filter(el=>el.getClientRects().length&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)).map(el=>({text:el.textContent?.trim(),width:el.clientWidth,scroll:el.scrollWidth}))}));
}
async function composition(page: Page) {
  return page.evaluate(()=>{
    const problems:string[]=[];
    const selector='.overview-home .metric-value,.overview-home .metric-label,.overview-home .home-hello,.overview-members h2,.member-kpi-value,.member-identity strong,.directory-mode,.directory-received strong,.member-state-pill,.directory-actions button';
    for(const el of document.querySelectorAll<HTMLElement>(selector)) {
      if(!el.getClientRects().length)continue;
      const box=el.getBoundingClientRect(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      for(let node=walker.nextNode();node;node=walker.nextNode()) for(const match of(node.textContent??'').matchAll(/[\p{L}\p{N}]+/gu)) {
        const range=document.createRange();range.setStart(node,match.index!);range.setEnd(node,match.index!+match[0].length);
        const rects=[...range.getClientRects()];
        if(new Set(rects.map(r=>Math.round(r.top))).size>1)problems.push('Palabra partida: '+match[0]);
        if(rects.some(r=>r.left<box.left-1||r.right>box.right+1))problems.push('Fuera de caja: '+match[0]);
        for(let parent=el.parentElement;parent;parent=parent.parentElement) {
          const css=getComputedStyle(parent),boundary=parent.getBoundingClientRect();
          if(/hidden|clip/.test(css.overflowX)&&rects.some(r=>r.left<boundary.left-1||r.right>boundary.right+1))problems.push('Recorte: '+match[0]);
        }
      }
    }
    return problems;
  });
}
async function compareFigures(page:Page, cut='2026-10-20') {
  const model=await invariants(page,cut);
  for(const [key,value]of [['dinero-en-caja',model.bank],['dinero-prestado',model.accounts.loans_receivable],['intereses-cobrados',model.interest],['ahorro-del-ciclo',(-Number(model.accounts.savings_liability)).toFixed(2)],['bolsa-polla',(-Number(model.accounts.polla_pool)).toFixed(2)]]) {
    const formatted=new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
    await expect(page.locator('[data-figure-key="'+key+'"] [data-figure-value]')).toContainText(formatted);
  }
}
async function closeDialog(page:Page) { await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click(); }

for (const width of [320,375,390,768,1024,1440,1672,1927]) test('Inicio y Socios at '+width,async({page})=>{
  await page.setViewportSize({width,height:1000});await login(page);
  const path=base+'/'+(before?'before':'after')+'/'+width;mkdirSync(path,{recursive:true});
  const money=await invariants(page);
  if(!before)expect(money).toEqual(JSON.parse(readFileSync(process.env.E2E_SQL_BASELINE || base+'/before/'+width+'/invariants.json','utf8')));
  writeFileSync(path+'/invariants.json',JSON.stringify(money,null,2));
  for(const route of ['home','members']) {
    await page.goto('/#/'+route);await expect(page.getByRole('heading',{name:route==='home'?'Inicio':'Socios',exact:true}).first()).toBeVisible();
    await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-10-20');
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:path+'/'+route+'.png',fullPage:true,animations:'disabled'});
    const issues=await overflow(page);if(!before){expect(issues.global).toBe(false);expect(await composition(page)).toEqual([]);}
    if(!before&&route==='home') {
      await expect(page.locator('.home-metric')).toHaveCount(6);await compareFigures(page);
      await expect(page.locator('.home-page .bank-position,.home-page .money-reconstruction,.home-page .home-grid')).toHaveCount(0);
    }
    if(!before&&route==='members')await expect(page.locator('.member-kpi')).toHaveCount(4);
    writeFileSync(path+'/'+route+'-layout.json',JSON.stringify(issues,null,2));
  }
  expect(await invariants(page)).toEqual(money);
});

for(const width of [375,1672]) test('cards, dates, quick actions and upcoming at '+width,async({page})=>{
  test.skip(before);await page.setViewportSize({width,height:1000});await login(page);const model=await invariants(page);
  const destinations=[['dinero-en-caja','Banco y caja','more/bank'],['dinero-prestado','Préstamos','loans'],['intereses-cobrados','Rendimientos bancarios','more/yield'],['ahorro-del-ciclo','Ahorros','savings'],['bolsa-polla','Polla','polla']];
  for(const[key,title,route]of destinations){
    await page.goto('/#/home');await page.locator('[data-figure-key="'+key+'"]').focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp('#/'+route+'$'));await expect(page.getByRole('heading',{name:title,exact:true}).first()).toBeVisible();
  }
  await page.goto('/#/home');await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');await compareFigures(page,'2026-09-20');
  await page.reload();await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-09-20');await compareFigures(page,'2026-09-20');
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');await compareFigures(page);
  for(const action of ['Registrar aporte','Nuevo préstamo']) {
    await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await closeDialog(page);await page.goto('/#/home');
  }
  for(const [action,title]of [['Registrar cobro','Préstamos'],['Gestionar polla','Polla']]) {
    await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('heading',{name:title,exact:true}).first()).toBeVisible();await page.goto('/#/home');
  }
  await page.locator('.home-upcoming .row-button').first().click();await expect(page.getByRole('dialog')).toBeVisible();await closeDialog(page);await page.goto('/#/home');
  await page.locator('.home-upcoming').getByRole('button',{name:/Ver todos/}).click();await expect(page.getByRole('heading',{name:'Préstamos',exact:true})).toBeVisible();
  expect(await invariants(page)).toEqual(model);
});

for(const width of [375,1672]) test('members filters, summaries, history and existing actions at '+width,async({page})=>{
  test.skip(before);await page.setViewportSize({width,height:1000});await login(page);const model=await invariants(page);await page.goto('/#/members');
  const rows=page.locator('[data-savings-member-row]'),search=page.getByRole('searchbox',{name:'Buscar socio'});
  for(const [filter,count]of [['Activos',3],['Solo ahorro (B)',2],['Polla y rendimientos (A)',3],['Todos',5]] as const){
    const button=page.getByRole('button',{name:filter,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(rows).toHaveCount(count);
  }
  await search.fill('ANGELA');await expect(rows).toHaveCount(1);
  await page.getByRole('button',{name:'Solo ahorro (B)',exact:true}).click();await expect(rows).toHaveCount(0);await expect(page.getByText('No hay socios que coincidan con la búsqueda y los filtros.')).toBeVisible();
  await page.getByRole('button',{name:'Todos',exact:true}).click();await expect(rows).toHaveCount(1);
  const row=rows.first();await expect(row.locator('.directory-received strong')).toContainText('139.932,72');await expect(row.locator('.directory-received small')).toContainText('01/10/2026');
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow','16');await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuetext',/840.000/);
  for(const action of ['Detalle','Editar','Ver ahorro']){
    await row.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await closeDialog(page);await page.goto('/#/members');await expect(search).toHaveValue('ANGELA');
  }
  await page.getByRole('button',{name:'Nuevo socio',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await closeDialog(page);
  await search.fill('nunca-existe');await expect(rows).toHaveCount(0);await search.fill('');
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');await expect(page.locator('[data-member-stat=complete]')).toHaveText('3 de 3');
  await expect(page.locator('[data-member-stat=active]')).toHaveText('No verificable');await expect(page.getByText(/El estado histórico de.*no es verificable/)).toBeVisible();
  await expect(page.locator('[data-savings-member-row="'+fixture.retiredMemberId+'"] .member-state-pill')).toHaveText('No verificable');
  await page.getByRole('button',{name:'Activos',exact:true}).click();await expect(rows).toHaveCount(0);await expect(page.getByText(/No hay socios activos verificables al corte/)).toBeVisible();
  await page.getByRole('button',{name:'Todos',exact:true}).click();await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
  expect(await invariants(page)).toEqual(model);
});

test('keyboard, touch, motion, enlarged text and safe bottom actions',async({browser})=>{
  test.skip(before);const context=await browser.newContext({viewport:{width:375,height:1000},hasTouch:true,reducedMotion:'reduce',locale:'es-CO'});const page=await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-20T17:00:00Z'));
  await auditPage(page);
  await login(page);await page.getByLabel('Fecha de corte',{exact:true}).tap();await page.keyboard.press('Escape');
  for(const width of [320,375,390,768]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    for(const route of ['home','members']){
      await page.goto('/#/'+route);await expect(page.getByRole('heading',{name:route==='home'?'Inicio':'Socios',exact:true}).first()).toBeVisible();
      expect((await overflow(page)).global).toBe(false);expect(await composition(page)).toEqual([]);
      const date=page.getByLabel('Fecha de corte',{exact:true});expect((await date.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if(route==='members'){
        const active=page.getByRole('button',{name:'Activos',exact:true});await active.focus();await page.keyboard.press('Enter');await expect(active).toHaveAttribute('aria-pressed','true');
        expect(await active.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');await page.getByRole('button',{name:'Todos',exact:true}).click();
        const contrast=await page.getByRole('button',{name:'Todos',exact:true}).evaluate(el=>{
          const css=getComputedStyle(el);
          const luminance=(color:string)=>{const p=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>{const x=value/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return p[0]*.2126+p[1]*.7152+p[2]*.0722;};
          const a=luminance(css.color),b=luminance(css.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        });expect(contrast).toBeGreaterThanOrEqual(4.5);
        const edit=page.getByRole('button',{name:'Editar',exact:true}).last();await edit.focus();await edit.scrollIntoViewIfNeeded();
        const bounds=await edit.boundingBox(),footer=await page.locator('.section-tabs').boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(footer!.y);
      }
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:base+'/after/accessibility/'+route+'-'+width+'-text200.png',fullPage:true,animations:'disabled'});
    }
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:844,height:390});await page.goto('/#/home');expect(await composition(page)).toEqual([]);
  expect(await page.locator('.home-metric').first().evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(.001);
  await page.screenshot({path:base+'/after/accessibility/home-landscape.png',fullPage:true,animations:'disabled'});expect(faults.get(page)).toEqual([]);await context.close();
});

test('loading, empty and recoverable data error are explicit',async({page})=>{
  test.skip(before);await login(page);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/rest/v1/cycle_members?**',async route=>{await gate;await route.fallback();});
  const reload=page.reload();await expect(page.getByLabel('Cargando información',{exact:true})).toBeVisible();
  await expect(page.locator('.overview-loading [data-figure-value]')).toHaveCount(0);release();await reload;await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
  await page.unroute('**/rest/v1/cycle_members?**');
  await page.route('**/rest/v1/cycle_members?**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'*/0'},body:'[]'}));
  await page.goto('/#/members');await page.reload();await expect(page.getByText(/Aún no hay socios en este ciclo/)).toBeVisible();await expect(page.locator('[data-member-stat=complete]')).toHaveText('0 de 0');
  await page.screenshot({path:base+'/after/states/members-empty.png',fullPage:true,animations:'disabled'});await page.unroute('**/rest/v1/cycle_members?**');
  await page.route('**/rest/v1/cycle_members?**',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Fallo sintético de lectura'})}));
  await page.reload();await expect(page.getByRole('heading',{name:'No se pudo cargar la información',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reintentar',exact:true})).toBeVisible();
  const observed=faults.get(page)!;expect(observed.some(error=>error.startsWith('500 /rest/v1/cycle_members'))).toBe(true);
  expect(observed.filter(error=>!error.startsWith('500 /rest/v1/cycle_members')&&!error.includes('Failed to load resource'))).toEqual([]);faults.set(page,[]);
  await page.screenshot({path:base+'/after/states/recoverable-error.png',fullPage:true,animations:'disabled'});
  await page.unroute('**/rest/v1/cycle_members?**');await page.getByRole('button',{name:'Reintentar',exact:true}).click();await expect(page.getByRole('heading',{name:'Socios',exact:true}).first()).toBeVisible();
});

test('200 percent zoom equivalent reflow at device scale 2',async({browser})=>{
  test.skip(before);
  // A 768×1000 display at 200% has a 384×500 CSS viewport. DPR2 preserves its physical screenshot scale.
  const context=await browser.newContext({viewport:{width:384,height:500},deviceScaleFactor:2,locale:'es-CO'});
  const page=await context.newPage();await page.clock.setFixedTime(new Date('2026-10-20T17:00:00Z'));await auditPage(page);await login(page);
  for(const route of ['home','members']) {
    await page.goto('/#/'+route);await expect(page.getByRole('heading',{name:route==='home'?'Inicio':'Socios',exact:true}).first()).toBeVisible();
    expect((await overflow(page)).global).toBe(false);expect(await composition(page)).toEqual([]);
    if(route==='home'){await compareFigures(page);await page.locator('[data-figure-key="bolsa-polla"]').click();await expect(page.getByRole('heading',{name:'Polla',exact:true})).toBeVisible();await page.goto('/#/home');}
    else {await page.getByRole('button',{name:'Nuevo socio',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await closeDialog(page);}
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:base+'/after/accessibility/'+route+'-zoom200-dpr2.png',fullPage:true,animations:'disabled'});
  }
  expect(faults.get(page)).toEqual([]);await context.close();
});
