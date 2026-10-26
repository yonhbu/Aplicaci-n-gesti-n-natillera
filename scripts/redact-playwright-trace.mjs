// Produce a usable review trace without authorization headers or session credentials.
import {createRequire}from'node:module';
import{createWriteStream}from'node:fs';
const{yauzl,yazl}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const[input,output]=process.argv.slice(2);if(!input||!output||input===output)throw Error('Use input.zip output.zip (distinct paths).');
let redactions=0;
function maskString(value){return value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g,()=>{redactions++;return'[redacted-token]';}).replace(/([?&](?:access_token|refresh_token|token_hash|token|code)=)[^&\s"<>]+/gi,(_,prefix)=>{redactions++;return prefix+'[redacted]';});}
function scrub(value){
 if(typeof value==='string'){const masked=maskString(value);if(/^[\[{]/.test(masked.trim())){try{return JSON.stringify(scrub(JSON.parse(masked)));}catch{}}return masked;}
 if(Array.isArray(value))return value.map(scrub);
 if(value&&typeof value==='object'){
  if(typeof value.name==='string'&&/^(authorization|apikey|cookie|set-cookie)$/i.test(value.name)){redactions++;return{...value,value:'[redacted]'};}
  return Object.fromEntries(Object.entries(value).map(([key,child])=>{if(/^(access_token|refresh_token|token_hash|token|password|authorization|apikey|secret_key)$/i.test(key)){redactions++;return[key,'[redacted]'];}return[key,scrub(child)];}));
 }return value;
}
const files=await new Promise((resolve,reject)=>yauzl.open(input,{lazyEntries:true},(error,zip)=>{
 if(error)return reject(error);const rows=[];zip.on('error',reject);zip.on('end',()=>resolve(rows));zip.on('entry',entry=>{
  if(entry.fileName.endsWith('/')){zip.readEntry();return;}
  zip.openReadStream(entry,(err,stream)=>{if(err)return reject(err);const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('error',reject);stream.on('end',()=>{let bytes=Buffer.concat(chunks);try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let result;if(/\.(trace|network)$/.test(entry.fileName))result=text.split('\n').map(line=>line?JSON.stringify(scrub(JSON.parse(line))):'').join('\n');else if(/^[\[{]/.test(text.trim()))result=JSON.stringify(scrub(JSON.parse(text)));else result=maskString(text);bytes=Buffer.from(result);}catch{}rows.push({name:entry.fileName,bytes});zip.readEntry();});});
 });zip.readEntry();
}));
const archive=new yazl.ZipFile();const stream=createWriteStream(output);const done=new Promise((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.outputStream.on('error',reject);});archive.outputStream.pipe(stream);for(const f of files)archive.addBuffer(f.bytes,f.name);archive.end();await done;
console.log(JSON.stringify({files:files.length,redactions,output}));
