// Controlled recovery proof. This tool deliberately supports local TEST only and never reads dotenv.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {userInfo} from 'node:os';

const source='supabase_db_natillera-manager-test';
const target='supabase_db_natillera-manager-recovery-test';
const sourceStorage='supabase_storage_natillera-manager-test';
const targetStorage='supabase_storage_natillera-manager-recovery-test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const recoveryRoot=path.join(root,'incoming/fin-qa-2026-10-16/restore-stack');
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const sha=value=>createHash('sha256').update(value).digest('hex');
const run=(args,input)=>{
  try{return execFileSync('docker',args,{input,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});}
  catch(error){
    const detail=String(error.stderr||'').split('\n').filter(line=>/^(?:ERROR:|pg_dump: error:|pg_restore: error:|tar:|Error response)/.test(line)).map(line=>line.slice(0,260)).join(' ')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,'[redacted]');
    error.recoverySafeMessage=`Controlled TEST command failed (${args.slice(0,4).join(' ')}): ${detail||'raw output suppressed'}`;
    throw error;
  }
};
const sql=(container,query)=>run(['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],query).toString('utf8').trim();
function status(workdir){return JSON.parse(execFileSync(process.execPath,[cli,'status','--workdir',workdir,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
function safeArtifact(file){
  const result=path.resolve(file||'');
  if(!result.startsWith(path.join(root,'incoming')+path.sep)||result.startsWith(path.join(root,'incoming/private')+path.sep)||/^\.env(?:\.|$)/.test(path.basename(result)))throw Error('Recovery files must be explicitly named under ignored incoming, outside private inputs.');
  return result;
}
function assertSource(){
  const s=status(path.join(root,'.supabase-test'));
  if(s.API_URL!=='http://127.0.0.1:55421')throw Error('Source must be TEST 55421.');
  return s;
}
function assertTarget({empty=false}={}){
  const s=status(recoveryRoot);
  if(s.API_URL!=='http://127.0.0.1:55521')throw Error('Target must be independent recovery TEST 55521.');
  if(source===target)throw Error('Source and target cannot coincide.');
  const image=run(['inspect','--format','{{.Config.Image}}',target]).toString().trim();
  const sourceImage=run(['inspect','--format','{{.Config.Image}}',source]).toString().trim();
  if(image!==sourceImage)throw Error('Recovery requires compatible database images.');
  if(empty){
    const exists=sql(target,"select to_regclass('public.workspaces') is not null;");
    if(exists==='t'&&sql(target,'select count(*) from public.workspaces;')!=='0')throw Error('Recovery target contains workspaces; refusing to overwrite it.');
  }
  return s;
}

function fingerprints(container){
  const tables=JSON.parse(sql(container,"select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','auth','storage','supabase_migrations');"));
  const result={};
  const queries=[];
  for(const t of tables){
    if(!/^\w+$/.test(t.schema)||!/^\w+$/.test(t.table))throw Error('Unexpected identifier');
    queries.push(`select '${t.schema}.${t.table}' name,jsonb_build_object('count',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]'))) info from "${t.schema}"."${t.table}" r`);
  }
  const batch=JSON.parse(sql(container,`select jsonb_object_agg(name,info) from (${queries.join(' union all ')}) snapshot;`));
  for(const t of tables)result[t.schema+'.'+t.table]=batch[t.schema+'.'+t.table];
  const policies=sql(container,"select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname in ('public','auth','storage');");
  result.policies={hash:sha(policies),count:JSON.parse(policies).length};
  const functions=sql(container,"select coalesce(jsonb_agg(jsonb_build_object('name',proname,'args',pg_get_function_identity_arguments(oid),'definition',pg_get_functiondef(oid)) order by proname,pg_get_function_identity_arguments(oid)),'[]') from pg_proc where pronamespace='public'::regnamespace and prokind in ('f','p');");
  result.functions={hash:sha(functions),count:JSON.parse(functions).length};
  const security=sql(container,`select jsonb_agg(item order by item->>'identity') from (
    select jsonb_build_object('identity','relation:'||n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'acl',array(select x::text from unnest(c.relacl) x order by x::text),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) item
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage','supabase_migrations')
    union all select jsonb_build_object('identity','schema:'||nspname,'owner',pg_get_userbyid(nspowner),'acl',array(select x::text from unnest(nspacl) x order by x::text)) from pg_namespace where nspname in ('public','auth','storage','supabase_migrations')
    union all select jsonb_build_object('identity','function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','owner',pg_get_userbyid(p.proowner),'acl',array(select x::text from unnest(p.proacl) x order by x::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage')
    union all select jsonb_build_object('identity','database:postgres','owner',pg_get_userbyid(datdba),'acl',array(select x::text from unnest(datacl) x order by x::text)) from pg_database where datname='postgres'
  ) objects;`);
  result.security={hash:sha(security),count:JSON.parse(security).length};
  return result;
}

function storageFiles(container){
  const listing=run(['exec','--user','0',container,'sh','-c','cd /mnt && find . -type f -exec sha256sum {} +']).toString('utf8').trim();
  if(!listing)return {};
  const files={};
  for(const line of listing.split('\n')){const match=line.match(/^([a-f0-9]{64})  (\.\/.*)$/);if(!match)throw Error('Unsupported Storage file name.');files[match[2]]=match[1];}
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}

async function projectFiles(){
  const files={};
  const collect=async(relative)=>{
    for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
      const next=path.posix.join(relative,item.name);
      if(item.isSymbolicLink())throw Error('Project recovery does not follow symbolic links.');
      if(item.isDirectory())await collect(next);
      else if(item.isFile()&&!/^\.env(?:\.|$)/.test(item.name)){
        const bytes=await readFile(path.join(root,next)); files[next]={sha256:sha(bytes),data:bytes.toString('base64')};
      }
    }
  };
  for(const directory of ['src','public','scripts','supabase/migrations','supabase/templates'])await collect(directory);
  for(const file of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','README.md','docs/BUSINESS_RULES.md','docs/DECISIONS.md']){
    try{const bytes=await readFile(path.join(root,file));files[file]={sha256:sha(bytes),data:bytes.toString('base64')};}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return files;
}

export async function backupNative({out,keyFile}){
  const s=assertSource(); out=safeArtifact(out); keyFile=safeArtifact(keyFile);
  if(out===keyFile)throw Error('Encryption key must be separate from backup.');
  // This rehearsal must not read a real legacy source or private receipt.
  const safe=JSON.parse(sql(source,"select jsonb_build_object('non_test_auth',(select count(*) from auth.users where email !~ '@example[.]test$'),'legacy_batches',(select count(*) from public.legacy_operational_import_batches));"));
  if(safe.non_test_auth||safe.legacy_batches)throw Error('This TEST rehearsal refuses non-synthetic users or imported legacy batches.');
  await mkdir(path.dirname(out),{recursive:true}); await mkdir(path.dirname(keyFile),{recursive:true});
  let key;
  try{key=await readFile(keyFile);}catch{key=randomBytes(32);await writeFile(keyFile,key,{flag:'wx',mode:0o600});}
  if(key.length!==32)throw Error('Recovery key must contain exactly 32 bytes.');
  if(process.platform==='win32')execFileSync('icacls',[keyFile,'/inheritance:r','/grant:r',`${userInfo().username}:(F)`],{stdio:['ignore','pipe','pipe']});
  const before=fingerprints(source);
  const database=run(['exec',source,'pg_dump','-U','postgres','-d','postgres','--format=custom']);
  const fileHashes=storageFiles(sourceStorage);
  const storage=run(['exec','--user','0',sourceStorage,'tar','-C','/mnt','-cf','-','.']);
  const roles=JSON.parse(sql(source,"select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'bypass',rolbypassrls) order by rolname) from pg_roles;"));
  const after=fingerprints(source);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during backup; retry with TEST quiescent. No incomplete backup written.');
  if(JSON.stringify(fileHashes)!==JSON.stringify(storageFiles(sourceStorage)))throw Error('Storage changed during backup; retry with TEST quiescent.');
  const config=await readFile(path.join(root,'supabase/config.toml'),'utf8');
  const image=run(['inspect','--format','{{.Config.Image}}',source]).toString().trim();
  const databasePrivileges=JSON.parse(sql(source,`select jsonb_build_object('owner',pg_get_userbyid(d.datdba),'explicit_acl',d.datacl is not null,'grants',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantor,a.grantee,a.privilege_type) from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a)) from pg_database d where datname='postgres';`));
  const payload={format:'natillera-integral-test.v1',image,createdAt:new Date().toISOString(),fingerprints:before,roles,
    database:database.toString('base64'),databaseSha256:sha(database),databasePrivileges,storage:storage.toString('base64'),storageSha256:sha(storage),storageFiles:fileHashes,
    projectFiles:await projectFiles(),
    configuration:{configToml:config,runtime:s,secretPolicy:'Encrypted CLI archive only; never included in browser JSON or public evidence.'}};
  const nonce=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,nonce);
  const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);
  const archive=Buffer.concat([Buffer.from('NATREC1\n'),nonce,cipher.getAuthTag(),encrypted]);
  await writeFile(out,archive,{flag:'wx',mode:0o600});
  const result={format:payload.format,file:path.relative(root,out),sha256:sha(archive),bytes:archive.length,tables:Object.keys(before).length-3,
    storageObjects:before['storage.objects']?.count??0,credentials:'encrypted; key stored separately'};
  await writeFile(out+'.manifest.json',JSON.stringify(result,null,2));
  return result;
}

async function decryptArchive(file,keyFile){
  const raw=await readFile(safeArtifact(file)); const key=await readFile(safeArtifact(keyFile));
  if(raw.subarray(0,8).toString()!=='NATREC1\n')throw Error('Unknown encrypted backup format.');
  const decipher=createDecipheriv('aes-256-gcm',key,raw.subarray(8,20)); decipher.setAuthTag(raw.subarray(20,36));
  const payload=JSON.parse(gunzipSync(Buffer.concat([decipher.update(raw.subarray(36)),decipher.final()])).toString());
  if(payload.format!=='natillera-integral-test.v1')throw Error('Unknown payload.');
  if(sha(Buffer.from(payload.database,'base64'))!==payload.databaseSha256||sha(Buffer.from(payload.storage,'base64'))!==payload.storageSha256)throw Error('Backup component hash mismatch.');
  return payload;
}

export async function restoreNative({file,keyFile,out}){
  assertSource(); assertTarget({empty:true}); const payload=await decryptArchive(file,keyFile);
  if(!payload.databasePrivileges||!payload.fingerprints.security||!payload.storageFiles)throw Error('Backup lacks ownership/ACL/file verification; generate a new integral backup.');
  if(Object.keys(storageFiles(targetStorage)).length)throw Error('Recovery Storage volume must be empty; refusing to overwrite existing files.');
  if(run(['inspect','--format','{{.Config.Image}}',target]).toString().trim()!==payload.image)throw Error('Database image mismatch.');
  const roles=JSON.parse(sql(target,'select jsonb_agg(rolname) from pg_roles;'));
  for(const role of payload.roles){
    if(!roles.includes(role.name)){
      if(!/^\w+$/.test(role.name))throw Error('Unsupported custom role name.');
      run(['exec','-i',target,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],`create role "${role.name}" ${role.login?'login':'nologin'} ${role.bypass?'bypassrls':'nobypassrls'};`);
    }
  }
  const paused=['supabase_auth_natillera-manager-recovery-test','supabase_rest_natillera-manager-recovery-test',targetStorage,'supabase_pg_meta_natillera-manager-recovery-test'];
  run(['stop',...paused]);
  try{
    // A new template0 database avoids cleaning inherited platform partitions in-place.
    // assertTarget above refuses any existing application workspace, and target is a fixed independent TEST container.
    const owner=payload.databasePrivileges.owner;
    if(!/^\w+$/.test(owner))throw Error('Unsupported database owner.');
    run(['exec','-i',target,'psql','-U','supabase_admin','-d','template1','-v','ON_ERROR_STOP=1'],
      `drop database postgres with(force);\ncreate database postgres template template0 owner "${owner}";\n`);
    // Platform service roles must retain their schema/table ownership to start Auth and Storage.
    run(['exec','-i',target,'pg_restore','-U','supabase_admin','-d','postgres','--single-transaction','--exit-on-error'],Buffer.from(payload.database,'base64'));
    if(payload.databasePrivileges.explicit_acl){
      const grants=payload.databasePrivileges.grants;
      const quote=role=>{if(!/^\w+$/.test(role))throw Error('Unsupported ACL role.');return role==='PUBLIC'?'public':'"'+role+'"';};
      const grantees=[...new Set(['PUBLIC',owner,...grants.map(g=>g.grantee)])];
      let permissions='revoke all on database postgres from '+grantees.map(quote).join(',')+';\n';
      for(const g of grants){if(!['CONNECT','CREATE','TEMPORARY'].includes(g.privilege))throw Error('Unsupported database privilege.');permissions+=`set role ${quote(g.grantor)};grant ${g.privilege} on database postgres to ${quote(g.grantee)}${g.grantable?' with grant option':''};reset role;\n`;}
      run(['exec','-i',target,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],permissions);
    }
  }finally{run(['start',...paused]);}
  run(['exec','-i','--user','0',targetStorage,'tar','-C','/mnt','-xf','-'],Buffer.from(payload.storage,'base64'));
  const restoredStorage=storageFiles(targetStorage);
  if(JSON.stringify(restoredStorage)!==JSON.stringify(payload.storageFiles))throw Error('Restored Storage file hashes differ.');
  for(const service of [paused[0],targetStorage]){
    let healthy=false;
    for(let attempt=0;attempt<30;attempt++){
      healthy=run(['inspect','--format','{{if .State.Health}}{{.State.Health.Status}}{{end}}',service]).toString().trim()==='healthy';
      if(healthy)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!healthy)throw Error('Restored platform service is unhealthy: '+service);
  }
  const actual=fingerprints(target);
  const recoveredFiles=path.join(root,'incoming/fin-qa-2026-10-16/recovered-project');
  let fileCount=0;
  for(const [relative,item] of Object.entries(payload.projectFiles||{})){
    const destination=path.resolve(recoveredFiles,relative);
    if(!destination.startsWith(recoveredFiles+path.sep)||relative.split('/').some(part=>part==='..'||/^\.env(?:\.|$)/.test(part)))throw Error('Unsafe recovered project path.');
    const bytes=Buffer.from(item.data,'base64'); if(sha(bytes)!==item.sha256)throw Error('Project component hash mismatch.');
    await mkdir(path.dirname(destination),{recursive:true}); await writeFile(destination,bytes);
    if(sha(await readFile(destination))!==item.sha256)throw Error('Recovered project file mismatch.');
    fileCount++;
  }
  const differences=Object.keys({...actual,...payload.fingerprints}).filter(k=>JSON.stringify(actual[k])!==JSON.stringify(payload.fingerprints[k]));
  const result={result:differences.length?'FAIL':'PASS',targetApi:'http://127.0.0.1:55521',tables:Object.keys(actual).length-3,differences,
    policies:actual.policies,functions:actual.functions,security:actual.security,platformServices:'healthy',storageObjects:actual['storage.objects']?.count??0,storageFilesCompared:Object.keys(restoredStorage).length,storageFileDifferences:0,recoveredProjectFiles:fileCount,
    sourceUnchanged:JSON.stringify(fingerprints(source))===JSON.stringify(payload.fingerprints),
    configuration:'Fresh isolated ports and service credentials; source runtime/config retained only inside encrypted archive.'};
  if(out)await writeFile(safeArtifact(out),JSON.stringify(result,null,2));
  if(differences.length)throw Error('Restored data/schema comparison failed: '+differences.join(', '));
  return result;
}

export async function restoreWorkspaceJson({file,out}){
  assertSource(); assertTarget({empty:true}); const backup=JSON.parse(await readFile(safeArtifact(file),'utf8'));
  if(backup.format!=='natillera-manager.workspace.v3')throw Error('El respaldo anterior no contiene todas las colecciones. Genere uno nuevo workspace.v3; aceptar solo la etiqueta v2 no recupera datos omitidos.');
  const encoded=Buffer.from(JSON.stringify(backup)).toString('base64');
  const result=JSON.parse(sql(target,`begin; set local natillera.restore_test='on'; select public.restore_natillera_workspace(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb); commit;`).split('\n').find(line=>line.startsWith('{')));
  if(out)await writeFile(safeArtifact(out),JSON.stringify(result,null,2));
  return result;
}

const main=async()=>{
  const [mode,...tokens]=process.argv.slice(2); const args={};
  for(let i=0;i<tokens.length;i+=2){if(!tokens[i].startsWith('--')||!tokens[i+1])throw Error('Expected explicit --option value.');args[tokens[i].slice(2)]=tokens[i+1];}
  const input={file:args.file,out:args.out,keyFile:args['key-file']};
  const result=mode==='backup-native'?await backupNative(input):mode==='restore-native'?await restoreNative(input):mode==='restore-json'?await restoreWorkspaceJson(input):null;
  if(!result)throw Error('Use backup-native, restore-native or restore-json with explicit file paths.');
  console.log(JSON.stringify(result,null,2));
};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  // Captured pg_dump/pg_restore errors may contain Auth contents; never echo subprocess buffers.
  console.error(error.recoverySafeMessage||(error.status!==undefined?'Recovery command failed; raw database output was suppressed.':error.message));
  process.exitCode=1;
});
