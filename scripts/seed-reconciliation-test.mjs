// Fresh synthetic workspace per run: repeatable E2E without erasing financial history.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Solo TEST55421.');
const prefix=crypto.randomUUID().slice(0,8),cycleId=prefix+'-0000-4000-8000-000000000003',workspaceId=prefix+'-0000-4000-8000-000000000002';
const sql=query=>execFileSync('docker',['exec','-i','supabase_db_natillera-manager-test','psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:3e6}).trim();
let fixture=readFileSync('supabase/tests/database/legacy_reconciliation_test.sql','utf8').split('create temp table recon_before')[0].replace('select no_plan();','').replaceAll('a1800000',prefix).replaceAll('Synthetic reconciliation unit',`Synthetic reconciliation ${prefix}`).replaceAll('reconcile-unit-admin@example.test',`reconcile-unit-admin-${prefix}@example.test`).replaceAll('reconcile-unit-reader@example.test',`reconcile-unit-reader-${prefix}@example.test`);
sql(fixture+'commit;');
const email=`qa-phasea-${prefix}@example.test`;
const admin=createClient(status.API_URL,status.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const result=await admin.auth.admin.createUser({email,password:crypto.randomUUID(),email_confirm:true});if(result.error)throw Error(result.error.message);
sql(`insert into public.workspace_users(workspace_id,user_id,role)values('${workspaceId}','${result.data.user.id}','admin');`);
mkdirSync('incoming/reconciliation-synthetic-2026-10-17',{recursive:true});
writeFileSync('incoming/reconciliation-synthetic-2026-10-17/fixture.json',JSON.stringify({cycleId,workspaceId,email},null,2));
console.log(JSON.stringify({target:'TEST55421',synthetic:true,freshWorkspace:true,fixture:'incoming/reconciliation-synthetic-2026-10-17/fixture.json'}));
