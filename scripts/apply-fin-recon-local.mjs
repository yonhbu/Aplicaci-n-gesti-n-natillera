// Atomic local schema application. No dotenv, reimport or historical financial writes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const mode=process.argv[2];if(!['--test','--dev'].includes(mode))throw Error('Indique --test o --dev local.');
const container='supabase_db_natillera-manager'+(mode==='--test'?'-test':''),port=mode==='--test'?'55422':'44122';
const binding=JSON.parse(execFileSync('docker',['inspect','--format','{{json .HostConfig.PortBindings}}',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(!binding['5432/tcp']?.some(item=>item.HostPort===port))throw Error('Destino local incompatible.');
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'];
const query=input=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:8e6});
const q=value=>"'"+value.replaceAll("'","''")+"'";
const installed=new Set(query('select version from supabase_migrations.schema_migrations;').trim().split('\n'));
const names=['20261106000100_fin_recon_personal_and_cash_completion.sql','20261106000200_fin_recon_admin_penalty.sql','20261106000300_fin_recon_preserve_existing_penalty.sql'];
const pending=names.filter(name=>!installed.has(name.slice(0,14)));
if(!pending.length){console.log('FIN-RECON ya aplicada; sin cambios.');process.exit(0);}
let sql="begin;set local lock_timeout='15s';lock table public.financial_operations,public.ledger_entries in share row exclusive mode;create temp table fin_recon_before as select md5(coalesce(jsonb_agg(to_jsonb(e)order by id)::text,''))hash from public.ledger_entries e;";
for(const name of pending){const source=readFileSync('supabase/migrations/'+name,'utf8');sql+=source+"\ninsert into supabase_migrations.schema_migrations(version,name,statements)values("+q(name.slice(0,14))+","+q(name.slice(15,-4))+",array["+q(source)+"]);";}
sql+="do $$begin if(select md5(coalesce(jsonb_agg(to_jsonb(e)order by id)::text,''))from public.ledger_entries e)is distinct from(select hash from fin_recon_before)then raise exception 'Se modificaron partidas existentes.';end if;if exists(select 1 from pg_trigger where tgname='fin_recon_withdrawal_penalty')then raise exception 'Reconocimiento de multa redundante.';end if;end $$;commit;";
query(sql);console.log('FIN-RECON aplicada atomicamente en '+(mode==='--test'?'TEST55422':'DEV44122')+'; partidas originales intactas.');
