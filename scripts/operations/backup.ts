import 'dotenv/config';
import {spawn} from 'node:child_process';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,mkdir,link,unlink,mkdtemp,rm,stat} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
const MAGIC=Buffer.from('RCBKP01\n');const HEADER=MAGIC.length+16+12+16;
function key(password:string,salt:Buffer){if(password.length<32)throw new Error('BACKUP_KEY needs at least 32 independent characters');return scryptSync(password,salt,32);}
function database(url:string){const u=new URL(url);if(!['postgresql:','postgres:'].includes(u.protocol)||!u.pathname.slice(1))throw new Error('Invalid database URL');return u;}
function child(command:string,args:string[],url:string){database(url);const db=database(url);const ssl=db.searchParams.get('sslmode');const proc=spawn(command,args,{env:{...process.env,PGDATABASE:decodeURIComponent(db.pathname.slice(1)),PGHOST:db.hostname,PGPORT:db.port||'5432',PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),...(ssl?{PGSSLMODE:ssl}:{}),...Object.fromEntries(['sslrootcert','sslcert','sslkey','connect_timeout'].flatMap(k=>db.searchParams.has(k)?[[{sslrootcert:'PGSSLROOTCERT',sslcert:'PGSSLCERT',sslkey:'PGSSLKEY',connect_timeout:'PGCONNECT_TIMEOUT'}[k]!,db.searchParams.get(k)!]]:[]))},stdio:['ignore','pipe','pipe']});let error='';proc.stderr!.on('data',chunk=>{error+=chunk.toString();if(error.length>16000)error=error.slice(-16000);});const done=new Promise<void>((ok,fail)=>{proc.once('error',()=>fail(new Error(`${command} could not start`)));proc.once('exit',code=>code===0?ok():fail(new Error(`${command} failed; inspect database availability and tool compatibility`)));});done.catch(()=>{});return{proc,done};}
export async function backupDatabase(url:string,destination:string,password:string){
  process.umask(0o077);const salt=randomBytes(16),iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(password,salt),iv);const path=resolve(destination);await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{await stat(path);throw new Error('Backup destination already exists');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const partial=path+`.partial-${randomBytes(6).toString('hex')}`;const file=await open(partial,'wx',0o600);await file.write(Buffer.concat([MAGIC,salt,iv,Buffer.alloc(16)]));await file.close();
  const {proc,done}=child('pg_dump',['--format=custom','--no-owner','--no-privileges'],url);
  try{await pipeline(proc.stdout!,cipher,createWriteStream(partial,{flags:'a',mode:0o600}));await done;const handle=await open(partial,'r+');await handle.write(cipher.getAuthTag(),0,16,MAGIC.length+16+12);await handle.sync();await handle.close();await link(partial,path);await unlink(partial);return{path,encrypted:true,format:'AES-256-GCM / pg_dump custom'};}
  catch(e){proc.kill('SIGTERM');await unlink(partial).catch(()=>{});throw e;}
}
export async function restoreDatabase(backup:string,sourceUrl:string,targetUrl:string,password:string,confirmation:string){
  const source=database(sourceUrl),target=database(targetUrl);const name=decodeURIComponent(target.pathname.slice(1));
  if(source.hostname===target.hostname&&(source.port||'5432')===(target.port||'5432')&&source.pathname===target.pathname)throw new Error('Restore target must be a different database');
  if(confirmation!==name)throw new Error('RESTORE_CONFIRM_DATABASE must exactly match target database name');
  process.umask(0o077);const temp=await mkdtemp(join(tmpdir(),'riskcontrol-restore-'));const plain=join(temp,'verified.dump');
  try{
    const input=await open(backup,'r');const header=Buffer.alloc(HEADER);const read=await input.read(header,0,HEADER,0);await input.close();if(read.bytesRead!==HEADER||!header.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Invalid backup header');
    const salt=header.subarray(MAGIC.length,MAGIC.length+16),iv=header.subarray(MAGIC.length+16,MAGIC.length+28),tag=header.subarray(MAGIC.length+28,HEADER);const decipher=createDecipheriv('aes-256-gcm',key(password,salt),iv);decipher.setAuthTag(tag);
    // Authenticate the entire archive before pg_restore can touch the target.
    await pipeline(createReadStream(backup,{start:HEADER}),decipher,createWriteStream(plain,{flags:'wx',mode:0o600}));
    const probe=child('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')"],targetUrl);let count='';probe.proc.stdout!.on('data',chunk=>count+=chunk.toString());await probe.done;if(count.trim()!=='0')throw new Error('Restore refuses a nonempty database; it never deletes or overwrites existing data');
    const restore=child('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname',name,plain],targetUrl);
    // The destination name is non-secret; connection credentials remain in environment variables.
    await restore.done;return{restored:true,database:name};
  }finally{await rm(temp,{recursive:true,force:true});}
}
