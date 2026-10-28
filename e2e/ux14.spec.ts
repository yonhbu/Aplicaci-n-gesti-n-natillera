import { startAuditTrace, finishAuditTrace } from './audit-safe-trace';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from './test-fixtures';
import { renderedLayout, responsiveViewport } from './responsive-layout';
const base = 'docs/ux/evidence/ux14';
const evidenceBase = process.env.UX14_EVIDENCE_DIR || base;
const fixture = JSON.parse(readFileSync('incoming/ux13-2026-10-20/fixture.json', 'utf8'));
const before = process.env.UX14_PHASE === 'before';
const modules = ['bank', 'movements', 'yield', 'admin', 'settlements', 'profit', 'stats', 'exports'];
const titles = ['Banco y caja','Movimientos financieros','Rendimientos bancarios','Mi ganancia como administrador','Cuentas finales de socios','Ganancia de préstamos de los socios','Distribución del dinero','Respaldos'];
const api = 'http://127.0.0.1:55421';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({page}) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + new URL(response.url()).pathname); });
  await page.route('**/*', route => ['http://127.0.0.1:5198', api, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin) ? route.fallback() : route.abort());
});
test.afterEach(async ({page}, info) => { await finishAuditTrace(page, info); expect(faults.get(page)).toEqual([]); });
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
async function composition(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const selector = '.hero-band h2,.hero-figure strong,.hero-chips span,.page-heading h2,.more-hub-text strong,.bank-page > .quick-grid .quick-action,.financial-cut-picker input,.topbar-brand strong,.section-tab span,.members-name .member-name,.members-table .member-mode,.members-table .member-state,.members-table .members-period';
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!element.getClientRects().length) continue;
      const box = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? '').matchAll(/[\p{L}\p{N}]+/gu)) {
          const range = document.createRange();
          range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
          const rects = [...range.getClientRects()];
          if (new Set(rects.map(rect => Math.round(rect.top))).size > 1) issues.push('Palabra partida: ' + match[0]);
          if (rects.some(rect => rect.left < box.left - 1 || rect.right > box.right + 1)) {
            const style = getComputedStyle(element);
            issues.push('Texto fuera: ' + match[0] + ' ' + JSON.stringify({ viewport: innerWidth, width: box.width, left: box.left,
              fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
              fonts: document.fonts.status, heroPadding: element.closest('.hero-band') ? getComputedStyle(element.closest('.hero-band')!).paddingInline : null,
              word: rects.map(rect => ({left:rect.left,right:rect.right,width:rect.width})) }));
          }
          for(let ancestor=element.parentElement; ancestor; ancestor=ancestor.parentElement) {
            const style=getComputedStyle(ancestor);
            const boundary=ancestor.getBoundingClientRect();
            if(/hidden|clip/.test(style.overflowX) && rects.some(rect=>rect.left<boundary.left-1||rect.right>boundary.right+1)) issues.push('Texto recortado por contenedor: '+match[0]);
          }
        }
      }
      if (element.matches('input') && box.height < 44) issues.push('Fecha menor de 44px');
    }
    for (const header of document.querySelectorAll('.hero-band-top')) {
      const title = header.querySelector('h2')?.getBoundingClientRect();
      const action = header.querySelector(':scope > button')?.getBoundingClientRect();
      if (title && action && Math.min(title.right, action.right) > Math.max(title.left, action.left) && Math.min(title.bottom, action.bottom) > Math.max(title.top, action.top)) issues.push('Colisión de título y acción');
    }
    return issues;
  });
}
for (const width of [320,375,390,768,1024,1440]) test('inventory and invariants at '+width,async({page})=>{
  await page.setViewportSize({width,height:1000}); await login(page);
  const expected=await invariants(page); const path=evidenceBase+'/'+(before?'before':'after')+'/'+width;mkdirSync(path,{recursive:true});
  if(!before)expect(expected).toEqual(JSON.parse(readFileSync(process.env.E2E_SQL_BASELINE || base+'/before/'+width+'/invariants.json','utf8')));
  writeFileSync(path+'/invariants.json',JSON.stringify(expected,null,2));
  const inventory:any[]=[];
  for (const id of ['home','members',...(before ? [] : ['more']),...modules.map(id=>'more/'+id)]) {
    await page.goto('/#/'+id); const section=id.split('/')[1];
    await expect(page.getByRole('heading',{name:id==='home'?'Inicio':id==='members'?'Socios':id==='more'?'Más':titles[modules.indexOf(section)],exact:true}).first()).toBeVisible();
    if(section==='admin') await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
    await expect(page.getByText(/Calculando saldo disponible/)).toHaveCount(0);
    await page.evaluate(()=>document.fonts.ready); await page.screenshot({path:path+'/'+id.replace('/','-')+'.png',fullPage:true,animations:'disabled'});
    const issues=await overflow(page);inventory.push({route:id,headings:await page.locator('h2,h3').allTextContents(),buttons:await page.getByRole('button').allTextContents(),overflow:issues});
    if(!before){expect(issues.global,id+' global').toBe(false);expect(issues.local,id+' local').toEqual([]);expect(await composition(page),id+' composición').toEqual([]);}
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

for (const width of [320, 375, 390, 1440]) test('directory, back, focus, deep link and dates at '+width, async ({page}) => {
  test.skip(before);
  await page.setViewportSize({width, height:900}); await login(page);
  const model = await invariants(page);
  if (width === 320) await startAuditTrace(page);
  await page.goto('/#/more');
  const nav = page.getByRole('navigation',{name:'Secciones de mas opciones'});
  await expect(page.locator('.more-content')).toBeHidden();
  for (let i=0;i<modules.length;i++) {
    const button = nav.locator('[data-more-section="'+modules[i]+'"]');
    await button.focus(); await page.keyboard.press('Enter');
    const heading = page.getByRole('heading',{name:titles[i],exact:true});
    await expect(heading).toBeVisible(); await expect(heading).toBeFocused();
    if (width < 980) {
      await expect(nav).toBeHidden();
      expect((await heading.boundingBox())!.y).toBeLessThan(350);
    } else await expect(nav.locator('[aria-current=page]')).toHaveAttribute('data-more-section',modules[i]);
    await page.reload(); await expect(heading).toBeVisible();
    await page.goBack(); await expect(button).toBeFocused();
    await button.click(); await expect(heading).toBeVisible();
    await page.getByRole('button',{name:'‹ Más',exact:true}).click();
    await expect(button).toBeFocused();
    await expect(button).toBeInViewport({ratio:1});
    if(width<980) {
      const bounds=await button.boundingBox(), footer=await page.locator('.section-tabs').boundingBox();
      expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(footer!.y);
    }
  }
  await page.goto('/#more/admin');
  await expect(page.getByRole('heading',{name:titles[3],exact:true})).toBeVisible();
  await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
  const date=page.getByLabel('Fecha de corte',{exact:true});
  await date.focus(); await expect(date).toBeFocused();
  expect(await date.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await date.fill('2026-09-20'); await page.reload(); await expect(page.getByRole('heading',{name:titles[3],exact:true})).toBeVisible({timeout:30_000}); await expect(date).toHaveValue('2026-09-20');
  await date.fill('2027-01-01'); await expect(date).toHaveValue('2026-09-20');
  await date.fill('2026-10-20');
  await page.goto('/#/members');
  await expect(page.locator('[data-member-stat=complete]')).toHaveText('1 de 3');
  const retiredRow=page.locator('[data-savings-member-row="'+fixture.retiredMemberId+'"]');
  await expect(retiredRow.getByText('Fuera del periodo',{exact:true})).toBeVisible();
  const today=await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const result=await supabase.rpc('fin_civil_today');if(result.error)throw Error(result.error.message);return result.data as string;});
  await page.getByLabel('Fecha de corte',{exact:true}).fill(today);
  await expect(retiredRow.getByText('Retirado',{exact:true})).toBeVisible();
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');
  await expect(page.locator('[data-member-stat=complete]')).toHaveText('3 de 3');
  await expect(page.getByText(/El estado histórico.*no es verificable/)).toBeVisible();
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
  const row=page.locator('[data-savings-member-row="'+fixture.memberId+'"]');
  for(const action of ['Detalle','Editar','Ver ahorro']) {
    await row.getByRole('button',{name:action,exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click();
    await page.goto('/#/members');
  }
  await page.getByRole('button',{name:'Nuevo socio',exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click();
  await page.getByRole('searchbox',{name:'Buscar socio'}).fill('nunca-existe');
  await expect(page.getByText('No hay socios que coincidan con la búsqueda y los filtros.')).toBeVisible();
  await page.goto('/#/more/bank');
  for (const action of ['Conciliar','Intereses','Comisión','Mover entre banco y efectivo']) {
    await page.locator('.bank-page > .quick-grid').getByRole('button',{name:action,exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:/Cancelar|Volver/}).first().click();
  }
  expect(await invariants(page)).toEqual(model);

});

test('reduced motion, text at 200 percent, landscape and touch dates', async ({browser}) => {
  test.skip(before);
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce',locale:'es-CO'});
  try {
  const page=await context.newPage(); await login(page);
  await page.getByLabel('Fecha de corte',{exact:true}).tap(); await page.keyboard.press('Escape');
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-09-20');
  await page.reload(); await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-09-20');
  await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-20');
  await responsiveViewport(page,{width:375,height:900});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await renderedLayout(page);
  for(const route of ['home','members','more','more/admin','more/bank','more/profit','more/settlements']) {
    await page.goto('/#/'+route);
    await expect(page.locator('main h2').first()).toBeVisible();
    if(route==='more/admin') await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
    expect((await overflow(page)).global,route).toBe(false);
    expect(await composition(page),route).toEqual([]);
    await page.screenshot({path:evidenceBase+'/after/accessibility/'+route.replace('/','-')+'-text200.png',fullPage:true,animations:'disabled'});
  }
  await page.goto('/#/more/admin'); await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
  await page.getByRole('heading',{name:titles[3],exact:true}).focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const date=page.getByLabel('Fecha de corte',{exact:true}); await expect(date).toBeFocused();
  const field=await date.boundingBox(), footer=await page.locator('.section-tabs').boundingBox();
  expect(field!.y+field!.height).toBeLessThanOrEqual(footer!.y);
  const contrast=await date.evaluate(el=>{
    const style=getComputedStyle(el);
    const luminance=(color:string)=>{const parts=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>{const x=value/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return parts[0]*.2126+parts[1]*.7152+parts[2]*.0722;};
    const fg=luminance(style.color),bg=luminance(style.backgroundColor);
    return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  }); expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await page.locator('.hero-band').evaluate(el=>parseFloat(getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(.001);
  for(const width of [320,390]) {
    await responsiveViewport(page,{width,height:900});
    for(const route of ['more/admin','more/bank','members']) {
      await page.goto('/#/'+route); await expect(page.locator('main h2').first()).toBeVisible();
      if(route==='more/admin')await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
      expect((await overflow(page)).global).toBe(false);expect(await composition(page)).toEqual([]);
      if(route==='members') {
        const last=page.getByRole('button',{name:'Editar',exact:true}).last();
        await last.focus(); await last.scrollIntoViewIfNeeded();
        const bounds=await last.boundingBox(), footer=await page.locator('.section-tabs').boundingBox();
        expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(footer!.y);
        await page.evaluate(()=>window.scrollTo(0,0));
      }
      await page.screenshot({path:evidenceBase+'/after/accessibility/'+route.replace('/','-')+'-'+width+'-text200.png',fullPage:true,animations:'disabled'});
    }
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await responsiveViewport(page,{width:844,height:390}); await page.goto('/#/more/admin');
  await expect(page.getByText('Disponible para retirar',{exact:true})).toBeVisible();
  expect((await overflow(page)).global).toBe(false);expect(await composition(page)).toEqual([]);
  await page.screenshot({path:evidenceBase+'/after/accessibility/admin-landscape.png',fullPage:true,animations:'disabled'});
  } finally { await context.close(); }
});
