import { readFileSync } from 'node:fs';
import { expect,test,type Page } from './test-fixtures';
const fixture=JSON.parse(readFileSync('incoming/money-control-2026-10-20/fixture.json','utf8')) as {email:string;cycleId:string;memberId:string};
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
for(const width of[320,390,768,1280])test('bank summary and movement detail at '+width+'px',async({page},info)=>{
  await page.setViewportSize({width,height:1000});await login(page);await page.goto('/#/more/bank');await page.getByText('Ver cálculo del dinero',{exact:true}).click();
  const card=page.getByRole('article',{name:'Dinero de la natillera en el banco'});
  await expect(card).toContainText('Total que debería haber en la cuenta');
  await card.getByText('Ver movimientos que forman este saldo').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await card.screenshot({path:info.outputPath('bank-'+width+'.png')});
});
test('cancel, validation, partial receipt, reload, overpayment, confirmation and exact cents',async({page},info)=>{
  await login(page);const before=await query(page);await openSettlement(page);
  await page.getByRole('button',{name:'Calcular',exact:true}).click();
  await expect(page.getByText('Esta cuenta final no puede confirmarse mientras tenga un faltante.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Registrar pago para completar la cuenta final'}).click();
  await page.getByRole('button',{name:'Cancelar consignación'}).click();expect((await query(page)).operations.length).toBe(before.operations.length);
  await page.getByRole('button',{name:'Registrar pago para completar la cuenta final'}).click();
  const save=page.getByRole('button',{name:'Guardar consignación y recalcular'});
  await expect(save).toBeDisabled();
  await page.getByLabel('Importe recibido').fill('-1');await expect(save).toBeDisabled();
  await page.getByLabel('Importe recibido').fill('10');
  await page.getByLabel('Fecha real de la consignación').fill('2026-10-20');
  await page.getByLabel('Referencia de la consignación').fill('Synthetic completion partial');
  await page.getByRole('checkbox').check();
  for(const width of[320,390]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole('dialog').screenshot({path:info.outputPath('completion-form-'+width+'.png')});
  }
  const received=page.waitForResponse(response=>response.url()===api+'/rest/v1/rpc/record_settlement_completion');
  await save.click();expect((await received).status()).toBe(200);
  await expect(page.getByText(/Falta completar.*57,28/)).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Cuentas finales de socios',exact:true})).toBeVisible();await openSettlement(page);
  await page.getByRole('button',{name:'Calcular',exact:true}).click();
  await expect(page.getByText(/Falta completar.*57,28/)).toBeVisible();
  await page.getByRole('button',{name:'Registrar pago para completar la cuenta final'}).click();
  await page.getByLabel('Importe recibido').fill('58');await page.getByLabel('Fecha real de la consignación').fill('2026-10-20');
  await page.getByLabel('Referencia de la consignación').fill('Synthetic completion remainder');await page.getByRole('checkbox').check();
  await save.click();await expect(page.getByText(/Saldo a favor del socio.*0,72/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirmar cuenta final',exact:true})).toBeEnabled();
  await page.screenshot({path:info.outputPath('covered-settlement.png'),fullPage:true});
  const persisted=await query(page);
  expect(persisted.operations.filter(op=>op.operation_type==='member_settlement_completion')).toHaveLength(2);
  expect(persisted.entries.filter(entry=>entry.account==='savings_liability').reduce((sum,entry)=>sum+Number(entry.amount),0)).toBe(-69932.72);
  await page.getByRole('button',{name:'Confirmar cuenta final',exact:true}).click();
  await expect(page.getByRole('button',{name:/Pagar.*0,72/})).toBeVisible();
  const final=await query(page);expect(Number(final.settlements[0].net_amount)).toBe(0.72);
  expect(final.entries.filter(entry=>entry.account==='settlement_completion_liability').reduce((sum,entry)=>sum+Number(entry.amount),0)).toBe(0);
  await page.reload();await expect(page.getByRole('heading',{name:'Cuentas finales de socios',exact:true})).toBeVisible();await openSettlement(page);
  await expect(page.getByRole('button',{name:/Pagar.*0,72/})).toBeVisible();
});
test('new loan receipt selects bank and one annulment restores cash and bank exactly',async({page},info)=>{
  await login(page);const before=await query(page);
  const sum=(rows:typeof before.entries,location:string)=>rows.filter(row=>row.account==='cash'&&row.liquidity_location===location).reduce((total,row)=>total+Number(row.amount),0).toFixed(2);
  await page.getByRole('navigation',{name:'Secciones principales'}).getByRole('button',{name:'Préstamos',exact:true}).click();
  await page.getByRole('article').filter({hasText:'Synthetic bank destination'}).getByRole('button',{name:'Ver detalle',exact:true}).click();
  await page.getByRole('button',{name:'Registrar pago',exact:true}).click();
  await expect(page.getByRole('group',{name:'Destino del cobro'}).getByRole('button',{name:'Banco',exact:true})).toHaveAttribute('aria-pressed','true');
  const bankId=await page.getByRole('combobox',{name:'Cuenta',exact:true}).inputValue();
  await page.getByRole('combobox',{name:'Cuenta',exact:true}).selectOption('');
  await expect(page.getByRole('button',{name:'Registrar Pago',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'Cuenta',exact:true}).selectOption(bankId);
  await page.getByLabel('Fecha del pago',{exact:true}).fill('2026-10-20');
  for(const width of[320,390]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole('dialog').screenshot({path:info.outputPath('loan-destination-'+width+'.png')});
  }
  const posted=page.waitForResponse(response=>response.url()===api+'/rest/v1/rpc/record_noted_loan_payment');
  await page.getByRole('button',{name:'Registrar Pago',exact:true}).click();expect((await posted).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after=await query(page);
  expect(Number(sum(after.entries,'bank'))-Number(sum(before.entries,'bank'))).toBe(510);
  expect(sum(after.entries,'cash')).toBe(sum(before.entries,'cash'));
  await page.getByRole('button',{name:'Anular',exact:true}).click();
  const undone=page.waitForResponse(response=>response.url()===api+'/rest/v1/rpc/reverse_financial_operation');
  await page.getByRole('button',{name:'Confirmar anulación',exact:true}).click();expect((await undone).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const final=await query(page);
  expect(sum(final.entries,'bank')).toBe(sum(before.entries,'bank'));
  expect(sum(final.entries,'cash')).toBe(sum(before.entries,'cash'));
  expect(final.operations.length-before.operations.length).toBe(4);
  await page.reload();await expect(page.getByRole('heading',{name:'Préstamos',exact:true})).toBeVisible();
  expect(sum((await query(page)).entries,'bank')).toBe(sum(before.entries,'bank'));
});
