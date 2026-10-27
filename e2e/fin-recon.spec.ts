import { readFileSync, existsSync } from 'node:fs';
import { expect,test,type Page } from './test-fixtures';
const fixture=JSON.parse(readFileSync('incoming/fin-recon-2026-10-20/fixture.json','utf8')) as {email:string;cycleId:string;memberId:string};
const api='http://127.0.0.1:55421';
const faults=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
  const list:string[]=[];faults.set(page,list);
  page.on('pageerror',error=>list.push(error.message));
  page.on('console',message=>{if(message.type()==='error')list.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)list.push(response.status()+' '+new URL(response.url()).pathname);});
  await page.route('**/*',route=>{
    const origin=new URL(route.request().url()).origin;
    if(['http://127.0.0.1:5198',api,'https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(origin))return route.fallback();
    return route.abort();
  });
});
test.afterEach(async({page})=>{expect(faults.get(page)).toEqual([]);});
async function login(page:Page){
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Correo autorizado').fill(fixture.email);
  await page.getByRole('button',{name:'Enviar codigo',exact:true}).click();
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox=await(await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail=inbox.messages.find((m:{To?:{Address:string}[]})=>m.To?.some(to=>to.Address===fixture.email));
  const body=await(await page.request.get('http://127.0.0.1:55424/api/v1/message/'+encodeURIComponent(mail.ID))).json();
  const token=(String(body.Text??'')+' '+String(body.HTML??'')).match(/\b\d{6}\b/)?.[0];expect(token).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(token!);await page.getByRole('button',{name:'Ingresar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inicio',exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');return(supabase as unknown as{supabaseUrl:string}).supabaseUrl;})).toBe(api);
}
async function query(page:Page){
  return page.evaluate(async cycleId=>{
    const{ supabase }=await import('/src/lib/supabase.ts');
    const operations=await supabase.from('financial_operations').select('id,operation_type').eq('cycle_id',cycleId);
    const entries=await supabase.from('ledger_entries').select('account,amount,liquidity_location').eq('cycle_id',cycleId);
    const settlements=await supabase.from('member_settlements').select('net_amount,transfer_amount,snapshot,status').eq('cycle_id',cycleId);
    if(operations.error||entries.error||settlements.error)throw Error('Persistence query failed');
    return{operations:operations.data,entries:entries.data,settlements:settlements.data};
  },fixture.cycleId);
}
async function openSettlement(page:Page){
  await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();
  await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Cuentas finales',exact:true}).click();
  await page.locator('[data-settlement-member="'+fixture.memberId+'"]').click();
}

async function bank(page:Page){
 await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();
 await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Banco y caja',exact:true}).click();
}
for(const width of [320,1280])test('before and after changed screens at '+width,async({page},info)=>{
 await page.setViewportSize({width,height:1100});
 const baselineAvailable=existsSync('.temp/FinReconBaseline.tsx');
 if(baselineAvailable){
 await page.route('**/src/ui/App.tsx*',async route=>{
  const response=await page.request.get('http://127.0.0.1:5198/.temp/FinReconBaseline.tsx');
  await route.fulfill({response});
 });
 await login(page);await page.screenshot({path:info.outputPath('home-before.png'),fullPage:true,animations:'disabled'});
 await bank(page);await page.screenshot({path:info.outputPath('bank-before.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Administración',exact:true}).click();
 await page.screenshot({path:info.outputPath('admin-before.png'),fullPage:true,animations:'disabled'});
 await page.unroute('**/src/ui/App.tsx*');await page.goto('/#home');await page.reload();
 }else{await login(page);}
 await expect(page.getByLabel('Fecha de corte',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('home-after.png'),fullPage:true,animations:'disabled'});
 for(const section of ['bank','admin']){
  if(section==='bank')await bank(page);else {
    await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Más',exact:true}).click();
    await page.getByRole('navigation',{name:'Secciones de mas opciones'}).getByRole('button',{name:'Administración',exact:true}).click();
  }
  await expect(page.getByLabel('Fecha de corte',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByRole('article',{name:'Cuadre'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath(section+'-after.png'),fullPage:true,animations:'disabled'});
 }
});

test('one cut reconstructs historical bank, principal and reversed payments across reload and screens',async({page})=>{
 await login(page);
 await page.evaluate(async cycleId=>{
  const{ supabase }=await import('/src/lib/supabase.ts');
  const loan=await supabase.from('loan_contracts').select('id').eq('cycle_id',cycleId).eq('external_borrower_name','Synthetic bank destination').single();
  const bank=await supabase.from('bank_accounts').select('id').eq('workspace_id',(await supabase.from('cycles').select('workspace_id').eq('id',cycleId).single()).data!.workspace_id).single();
  const result=await supabase.rpc('record_located_loan_payment',{p_loan_id:loan.data!.id,p_idempotency_key:'fin-recon-dated-payment',p_payment_date:'2026-10-16',p_amount:110,p_capital_amount:100,p_interest_amount:10,p_kind:'regular',p_bank_account_id:bank.data!.id,p_quote_hash:null});if(result.error)throw Error(result.error.message);
  const undo=await supabase.rpc('reverse_financial_operation',{p_operation_id:result.data.operation_id,p_idempotency_key:'fin-recon-dated-undo',p_effective_date:'2026-10-20',p_reason:'Synthetic dated annulment'});if(undo.error)throw Error(undo.error.message);
 },fixture.cycleId);
 await page.reload();
 for(const [date,balance,principal]of [['2026-10-15','1.000,00','1.000,00'],['2026-10-16','1.110,00','900,00'],['2026-10-20','1.000,00','1.000,00']]){
  await page.getByLabel('Fecha de corte',{exact:true}).fill(date);
  await expect(page.locator('[data-figure-key="dinero-en-caja"] [data-figure-value]')).toContainText(balance);
  await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText(principal);
 }
 await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-10-16');await bank(page);
 await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-10-16');
 await page.getByText('Ver cálculo del dinero',{exact:true}).click();
 await expect(page.getByRole('article',{name:'Dinero de la natillera en el banco'})).toContainText('1.110,00');
 await page.reload();await expect(page.getByLabel('Fecha de corte',{exact:true})).toHaveValue('2026-10-16');
 await page.getByText('Ver cálculo del dinero',{exact:true}).click();
 await page.getByLabel('Fecha de corte',{exact:true}).fill('2026-01-01');
 await expect(page.getByRole('article',{name:'Dinero de la natillera en el banco'})).toContainText('0,00');
});

test('personal receipt and return persist without changing collective balances',async({page})=>{
 await login(page);await bank(page);await page.getByText('Dinero personal en la cuenta',{exact:true}).click();
 const before=await query(page);
 const save=page.getByRole('button',{name:'Guardar movimiento personal',exact:true});await expect(save).toBeDisabled();
 for(const [direction,amount,reference]of [['in','100,40','Synthetic personal in'],['out','100,40','Synthetic personal out']]){
  await page.getByRole('combobox',{name:'Movimiento personal',exact:true}).selectOption(direction);
  await page.getByLabel('Fecha del movimiento personal').fill('2026-10-20');await page.getByLabel('Importe personal').fill(amount);
  await page.getByLabel('Referencia personal').fill(reference);await page.getByLabel('Motivo del movimiento personal').fill('Synthetic documented transfer');
  await page.getByRole('checkbox',{name:'Verifiqué el movimiento y que no está registrado antes.'}).check();
  const response=page.waitForResponse(r=>r.url()===api+'/rest/v1/rpc/record_personal_funds');await save.click();expect((await response).status()).toBe(200);
  await expect(page.getByText('Movimiento personal guardado. El dinero de la natillera no cambió.',{exact:true})).toBeVisible();
 }
 await page.reload();const after=await query(page);
 const sum=(rows:typeof after.entries,account:string)=>rows.filter(r=>r.account===account).reduce((total,r)=>total+Number(r.amount),0);
 expect(after.operations.length).toBe(before.operations.length+2);
 for(const account of ['cash','savings_liability','admin_payable','member_loan_profit_fund'])expect(sum(after.entries,account)).toBe(sum(before.entries,account));
 expect(sum(after.entries,'personal_bank_cash')).toBe(0);expect(sum(after.entries,'personal_funds_payable')).toBe(0);
});

test('cash completion covers only the final-account shortfall and persists after reload',async({page},info)=>{
 await login(page);await openSettlement(page);await page.getByRole('button',{name:'Calcular',exact:true}).click();
 await page.screenshot({path:info.outputPath('completion-before.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Registrar pago para completar la cuenta final'}).click();
 await page.getByLabel('Dónde se recibió').selectOption('cash');
 await expect(page.getByLabel('Cuenta que recibió el dinero')).toHaveCount(0);
 await page.getByLabel('Importe recibido').fill('67,28');await page.getByLabel('Fecha real de la consignación').fill('2026-10-20');await page.getByLabel('Referencia de la consignación').fill('Synthetic completion cash');
 await page.getByRole('checkbox').check();
 const response=page.waitForResponse(r=>r.url()===api+'/rest/v1/rpc/record_settlement_completion');await page.getByRole('button',{name:'Guardar consignación y recalcular'}).click();expect((await response).status()).toBe(200);
 await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath('completion-after.png'),fullPage:true,animations:'disabled'});
 await page.reload();await openSettlement(page);await page.getByRole('button',{name:'Calcular',exact:true}).click();await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeEnabled();
 const evidence=await query(page);expect(evidence.entries.filter(e=>e.account==='settlement_completion_liability').reduce((sum,e)=>sum+Number(e.amount),0)).toBe(-67.28);
});
