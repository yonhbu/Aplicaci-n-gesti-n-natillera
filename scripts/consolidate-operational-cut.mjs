// Revisa las fuentes originales sin dotenv. Las escrituras solo admiten TEST.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import Papa from 'papaparse';
import Decimal from 'decimal.js';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const jsonPath=arg('--json'),csvPath=arg('--csv'),cut=arg('--cut-date');
if(!jsonPath||!csvPath||!cut||!/^\d{4}-\d{2}-\d{2}$/.test(cut)||new Date(cut+'T12:00:00Z').toISOString().slice(0,10)!==cut)throw Error('Se requieren --json, --csv y --cut-date YYYY-MM-DD.');
const jsonBytes=readFileSync(jsonPath),csvBytes=readFileSync(csvPath),source=JSON.parse(jsonBytes.toString('utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sections=new Map();let section;
for(const line of csvBytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){
  if(line.trim()&&!line.includes(',')&&/^[A-ZÁÉÍÓÚÑ ]+$/.test(line.trim())){section=line.trim();sections.set(section,[]);}
  else if(section&&line.trim())sections.get(section).push(line);
}
for(const [key,lines] of sections){const result=Papa.parse(lines.join('\n'),{header:true,skipEmptyLines:true});if(result.errors.length)throw Error('CSV invalido: '+key);sections.set(key,result.data);}
const rows=key=>sections.get(key)??[],sum=(values,key)=>values.reduce((s,r)=>s.plus(r[key]),new Decimal(0)).toFixed(2);
for(const [key,values] of [['CUOTAS',source.cuotas],['MOVIMIENTOS',source.movimientos],['PREMIOS POLLA',source.premios],['PRESTAMOS',source.prestamos]]){
  if(rows(key).length!==values.length||!new Decimal(sum(rows(key),key==='PRESTAMOS'?'Principal':'Monto')).eq(sum(values,key==='PRESTAMOS'?'principal':'monto')))throw Error('JSON/CSV no coinciden: '+key);
}
const schedule=rows('PAGOS DE PRESTAMOS'),paid=schedule.filter(r=>source.pagos[`${r.Prestamo}#${r.PagoN}`]===true);
if(paid.length!==Object.values(source.pagos).filter(v=>v===true).length||schedule.some(r=>(String(r.Pagado).toLowerCase()==='true'||String(r.Pagado)==='1'||String(r.Pagado).toLowerCase()==='si')!==Boolean(source.pagos[`${r.Prestamo}#${r.PagoN}`])))throw Error('Las cuotas pagadas del JSON y CSV no coinciden.');
const report={status:'SOURCES_RECONCILED',cutDate:cut,sourceHashes:{json:hash(jsonBytes),csv:hash(csvBytes)},counts:{members:source.socios.length,savings:source.cuotas.length,loans:source.prestamos.length,schedules:schedule.length,paidInstallments:paid.length,prizes:source.premios.length},totals:{savings:sum(source.cuotas,'monto'),principal:sum(source.prestamos,'principal'),paidCapital:sum(paid,'Capital'),paidInterest:sum(paid,'Interes'),prizeGross:sum(source.premios,'monto'),prizeNet:new Decimal(sum(source.premios,'monto')).minus(source.premios.length*5000).toFixed(2)},datedRecordsAfterCut:{savings:source.cuotas.filter(r=>r.fecha>cut).length,movements:source.movimientos.filter(r=>r.fecha>cut).length},writes:'NONE'};
const output=arg('--out')??'incoming/operational-corrections-2026-10-16/source-review.json';
const cycle=arg('--test-cycle');
if(process.argv.includes('--apply-test')&&!cycle)throw Error('--apply-test requiere --test-cycle.');
if(cycle){
  if(!/^[0-9a-f-]{36}$/.test(cycle))throw Error('UUID de ciclo invalido.');
  const runtime=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));if(runtime.API_URL!=='http://127.0.0.1:55421')throw Error('Solo se permite TEST55421.');
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const sql=query=>execFileSync('docker',['exec','-i','supabase_db_natillera-manager-test','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  const actor=sql(`select user_id from workspace_users where workspace_id=(select workspace_id from cycles where id=${quote(cycle)}) and role='admin' order by user_id limit 1;`);
  if(!/^[0-9a-f-]{36}$/.test(actor))throw Error('TEST no contiene este ciclo con administrador.');
  const args=[cycle,report.sourceHashes.json,report.sourceHashes.csv,cut].map(quote).join(',');
  const prefix=`set local role authenticated;set local request.jwt.claim.sub=${quote(actor)};`;
  const preview=JSON.parse(sql(`begin;${prefix}select public.preview_operational_cut(${args});rollback;`).split('\n').find(line=>line.startsWith('{')));
  report.preview=preview;
  if(process.argv.includes('--apply-test')){
    report.confirmed=JSON.parse(sql(`begin;${prefix}select public.confirm_operational_cut(${args},${quote(preview.preview_hash)},'Corte confirmado por Juan; premios registrados al capital al 2026-10-01');commit;`).split('\n').find(line=>line.startsWith('{')));report.writes='TEST_ONLY';
  }
}
mkdirSync(new URL('../incoming/operational-corrections-2026-10-16/',import.meta.url),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cutDate:cut,counts:report.counts,totals:report.totals,datedRecordsAfterCut:report.datedRecordsAfterCut,writes:report.writes,report:output}));
