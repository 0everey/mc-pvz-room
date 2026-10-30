import { safeArchivePath, checkArchiveNames } from './library-state.js';

const ZIP32=0xffffffff, BLOB_LIMIT=512*1024*1024, CHUNK=256*1024;
const encoder=new TextEncoder();
const cancelled=()=>new DOMException('批量下载已取消','AbortError');
function check(signal){if(signal?.aborted)throw cancelled();}
function delay(ms,signal){check(signal);return new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(cancelled());}signal?.addEventListener('abort',abort,{once:true});});}
const tick=signal=>delay(0,signal);
function abortable(promise,signal){promise=Promise.resolve(promise);if(signal?.aborted){promise.catch(()=>{});return Promise.reject(cancelled());}if(!signal)return promise;return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(cancelled());};signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(cancelled());else resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});}
function absoluteURL(value,baseURL){const base=new URL(baseURL),url=new URL(value,base);if(!/^https?:$/.test(url.protocol)||url.origin!==base.origin||url.username||url.password)throw Error('批量下载只允许同源 HTTP 资源');return url.href;}
function progress(callback,phase,files,totalFiles,bytes,totalBytes){callback?.({phase,completedFiles:files,totalFiles,completedBytes:bytes,totalBytes});}

function validatePlan(plan){
  if(plan?.schema!=='resource-batch.v1'||typeof plan.libraryId!=='string'||!plan.libraryId||typeof plan.revision!=='string'||!plan.revision||!Array.isArray(plan.items)||!Array.isArray(plan.files))throw Error('批量计划 schema/身份无效');
  if(plan.itemCount!==plan.items.length||plan.fileCount!==plan.files.length||!plan.items.length)throw Error('批量计划计数无效');
  const ids=new Set(),paths=new Set();let total=0;
  for(const file of plan.files){safeArchivePath(file.path);const fold=file.path.toLowerCase();if(paths.has(fold)||fold==='batch-manifest.json'||typeof file.id!=='string'||ids.has(file.id)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[0-9a-f]{64}$/i.test(file.sha256)||typeof file.url!=='string')throw Error('批量计划文件无效或冲突');ids.add(file.id);paths.add(fold);total+=file.bytes;}
  const itemIds=new Set();for(const item of plan.items){if(typeof item.id!=='string'||itemIds.has(item.id)||typeof item.fingerprint!=='string'||!Array.isArray(item.files)||!item.files.length||item.files.some(id=>!ids.has(id)))throw Error('批量计划 item 映射无效');itemIds.add(item.id);}
  if(!Number.isSafeInteger(total)||total!==plan.totalBytes)throw Error('批量计划字节量不符');checkArchiveNames([...plan.files.map(file=>file.path),'BATCH-MANIFEST.json']);return plan;
}
function planSignature(plan){validatePlan(plan);return JSON.stringify({libraryId:plan.libraryId,revision:plan.revision,itemCount:plan.itemCount,fileCount:plan.fileCount,totalBytes:plan.totalBytes,items:[...plan.items].sort((a,b)=>a.id.localeCompare(b.id)).map(i=>({id:i.id,fingerprint:i.fingerprint,files:[...i.files].sort()})),files:[...plan.files].sort((a,b)=>a.id.localeCompare(b.id)).map(f=>({id:f.id,path:f.path,bytes:f.bytes,sha256:f.sha256.toLowerCase()}))});}
function publicManifest(plan){return JSON.stringify({schema:plan.schema,libraryId:plan.libraryId,revision:plan.revision,itemCount:plan.itemCount,fileCount:plan.fileCount,totalBytes:plan.totalBytes,items:plan.items.map(i=>({id:i.id,name:i.name,fingerprint:i.fingerprint,files:[...i.files]})),files:plan.files.map(f=>({id:f.id,path:f.path,name:f.name,bytes:f.bytes,sha256:f.sha256}))},null,2)+'\n';}

const CRC_TABLE=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let bit=0;bit<8;bit++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;CRC_TABLE[n]=c>>>0;}
export async function crc32Async(bytes,{signal,onProgress}={}){
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let crc=0xffffffff;
  for(let start=0;start<view.length;start+=CHUNK){check(signal);const end=Math.min(view.length,start+CHUNK);for(let i=start;i<end;i++)crc=CRC_TABLE[(crc^view[i])&255]^(crc>>>8);onProgress?.(end);await tick(signal);}
  check(signal);return(crc^0xffffffff)>>>0;
}
function binary(size,fill){const data=new Uint8Array(size);fill(new DataView(data.buffer));return data;}
function localHeader(name,size,crc,stream){return binary(30,view=>{view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800|(stream?8:0),true);view.setUint16(12,0x21,true);view.setUint32(14,stream?0:crc,true);view.setUint32(18,stream?0:size,true);view.setUint32(22,stream?0:size,true);view.setUint16(26,name.length,true);});}
function centralHeader(entry){return binary(46,view=>{view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);view.setUint16(8,0x800|(entry.stream?8:0),true);view.setUint16(14,0x21,true);view.setUint32(16,entry.crc,true);view.setUint32(20,entry.size,true);view.setUint32(24,entry.size,true);view.setUint16(28,entry.name.length,true);view.setUint32(42,entry.offset,true);});}
async function zipToSink(entries,sink,{signal,onProgress,stream=false}={}){
  if(entries.length>65535)throw Error('ZIP32 最多 65535 个文件');let estimate=22;const names=new Set();
  checkArchiveNames(entries.map(entry=>entry.name));
  for(const entry of entries){safeArchivePath(entry.name);const name=encoder.encode(entry.name);if(name.length>65535||!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>ZIP32)throw Error('ZIP32 文件大小或名称超限');const folded=entry.name.toLowerCase();if(names.has(folded))throw Error('ZIP 文件路径重复');names.add(folded);estimate+=entry.size+76+name.length*2+(stream?16:0);}
  if(estimate>ZIP32)throw Error('ZIP32 总大小超过 4GiB');let offset=0,completed=0;const central=[];
  const write=async bytes=>{check(signal);await sink(bytes);check(signal);offset+=bytes.byteLength;};
  for(const entry of entries){check(signal);const bytes=await entry.load();check(signal);if(!(bytes instanceof Uint8Array)||bytes.length!==entry.size)throw Error(`ZIP 文件大小不符：${entry.name}`);
    const crc=await crc32Async(bytes,{signal,onProgress:value=>onProgress?.({phase:'crc',entry:entry.name,completedBytes:value,totalBytes:bytes.length,completedFiles:completed,totalFiles:entries.length})});
    const name=encoder.encode(entry.name),start=offset;await write(localHeader(name,bytes.length,crc,stream));await write(name);
    for(let at=0;at<bytes.length;at+=CHUNK){await write(bytes.subarray(at,Math.min(bytes.length,at+CHUNK)));await tick(signal);}
    if(stream)await write(binary(16,v=>{v.setUint32(0,0x08074b50,true);v.setUint32(4,crc,true);v.setUint32(8,bytes.length,true);v.setUint32(12,bytes.length,true);}));
    central.push({name,offset:start,size:bytes.length,crc,stream});completed++;onProgress?.({phase:'zip',entry:entry.name,completedFiles:completed,totalFiles:entries.length});await tick(signal);
  }
  const centralOffset=offset;for(const entry of central){await write(centralHeader(entry));await write(entry.name);await tick(signal);}const centralSize=offset-centralOffset;
  await write(binary(22,v=>{v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,centralOffset,true);}));check(signal);return offset;
}

export async function makeZipAsync(entries,{signal,onProgress}={}){
  if(!Array.isArray(entries))throw Error('ZIP entries 必须是数组');
  const normalized=entries.map(entry=>{const raw=entry.bytes??entry.data;if(!(raw instanceof ArrayBuffer)&&!ArrayBuffer.isView(raw))throw Error('ZIP entry bytes 必须是二进制数组');const bytes=raw instanceof Uint8Array?raw:ArrayBuffer.isView(raw)?new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength):new Uint8Array(raw);return{name:entry.name,size:bytes.length,load:async()=>bytes};});
  const parts=[];await zipToSink(normalized,async bytes=>{parts.push(bytes);},{signal,onProgress});check(signal);return new Blob(parts,{type:'application/zip'});
}

function nativeClick(url,name){const anchor=document.createElement('a');anchor.href=url;if(name)anchor.download=name;anchor.hidden=true;document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}}
async function localBatch(plan,{baseURL,signal,onProgress,saveName}){
  let prepared=null,cancelledOnce=false;
  const cancel=async()=>{if(!prepared?.cancelUrl||cancelledOnce)return;cancelledOnce=true;try{await fetch(absoluteURL(prepared.cancelUrl,baseURL),{method:'POST',cache:'no-store',keepalive:true});}catch{/* task owner is cancelled even if transport failed */}};
  const responsePromise=fetch(absoluteURL('api/batches/prepare',baseURL),{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({revision:plan.revision,itemIds:plan.items.map(item=>item.id)})}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||`批量准备失败：HTTP ${response.status}`);prepared=body;if(signal?.aborted)await cancel();return body;});
  const onAbort=()=>{void cancel();};signal?.addEventListener('abort',onAbort,{once:true});
  try{
    progress(onProgress,'preparing',0,plan.fileCount,0,plan.totalBytes);await abortable(responsePromise,signal);check(signal);
    if(!prepared?.token||!prepared.downloadUrl||!prepared.statusUrl||!prepared.cancelUrl)throw Error('本机批量 API 返回缺少任务字段');
    absoluteURL(prepared.cancelUrl,baseURL);const downloadURL=absoluteURL(prepared.downloadUrl,baseURL),statusURL=absoluteURL(prepared.statusUrl,baseURL);
    if(planSignature(prepared.plan)!==planSignature(plan))throw Error('准备后的冻结计划与预览不一致，请刷新目录重试');
    check(signal);nativeClick(downloadURL,saveName);
    while(true){check(signal);const response=await abortable(fetch(statusURL,{cache:'no-store',signal}),signal);if(!response.ok)throw Error(`任务进度读取失败：HTTP ${response.status}`);const status=await abortable(response.json(),signal);check(signal);
      const states=['prepared','packing','ready','sending','handed-off','failed','cancelled'];if(!states.includes(status.state)||status.totalFiles!==plan.fileCount||status.totalBytes!==plan.totalBytes||!Number.isSafeInteger(status.completedFiles)||!Number.isSafeInteger(status.completedBytes)||status.completedFiles<0||status.completedFiles>plan.fileCount||status.completedBytes<0||status.completedBytes>plan.totalBytes)throw Error('本机任务进度合同无效');
      progress(onProgress,status.state,status.completedFiles,status.totalFiles,status.completedBytes,status.totalBytes);
      if(status.state==='handed-off'){check(signal);return{handedOff:true,method:'native'};}
      if(status.state==='failed')throw Error(status.error||'本机批量任务失败');if(status.state==='cancelled')throw cancelled();await delay(250,signal);
    }
  }catch(error){void cancel();if(signal?.aborted)throw cancelled();throw error;}finally{signal?.removeEventListener('abort',onAbort);}
}

async function readVerified(file,baseURL,signal,onRead){
  const response=await abortable(fetch(absoluteURL(file.url,baseURL),{cache:'no-store',signal}),signal);check(signal);if(!response.ok)throw Error(`原件读取失败：${file.path}（HTTP ${response.status}）`);
  let bytes,position=0;
  if(response.body?.getReader){bytes=new Uint8Array(file.bytes);const reader=response.body.getReader();const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});try{while(true){check(signal);const {value,done}=await abortable(reader.read(),signal);check(signal);if(done)break;if(position+value.length>bytes.length)throw Error(`原件大小超出计划：${file.path}`);bytes.set(value,position);position+=value.length;onRead(position);await tick(signal);}}finally{signal?.removeEventListener('abort',abort);try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}}
  else{bytes=new Uint8Array(await abortable(response.arrayBuffer(),signal));check(signal);if(bytes.length!==file.bytes)throw Error(`原件大小不符：${file.path}`);position=bytes.length;onRead(position);}
  if(position!==file.bytes)throw Error(`原件大小不符：${file.path}`);check(signal);const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));check(signal);const hex=[...hash].map(value=>value.toString(16).padStart(2,'0')).join('');if(hex!==file.sha256.toLowerCase())throw Error(`原件 SHA-256 不符：${file.path}`);return bytes;
}

// Picker invocation occurs synchronously before the first await in this async
// call. A rejected picker never falls back to a second download gesture.
export async function downloadBatch(plan,{mode='static',baseURL=globalThis.document?.baseURI,signal,onProgress,saveName='资源原件.zip',preferFileSystem=true}={}){
  validatePlan(plan);check(signal);if(!baseURL)throw Error('缺少下载 baseURL');if(!['static','local'].includes(mode))throw Error('未知批量下载 mode');
  if(mode==='local')return localBatch(plan,{baseURL,signal,onProgress,saveName});
  const manifest=encoder.encode(publicManifest(plan));
  const canFSA=preferFileSystem&&typeof globalThis.showSaveFilePicker==='function';
  if(!canFSA&&plan.totalBytes>BLOB_LIMIT)throw Error('兼容下载最多 512MiB 原件；请使用支持流式保存的浏览器或本机服务');
  if(plan.fileCount+1>65535||plan.totalBytes+manifest.length+plan.files.reduce((n,f)=>n+76+encoder.encode(f.path).length*2,0)+76+encoder.encode('BATCH-MANIFEST.json').length*2+22+(canFSA?16*(plan.fileCount+1):0)>ZIP32)throw Error('所选集合超出 ZIP32 容量');
  let picker;
  if(canFSA){try{picker=Promise.resolve(globalThis.showSaveFilePicker({suggestedName:saveName,types:[{description:'ZIP 归档',accept:{'application/zip':['.zip']}}]}));}catch(error){if(error.name==='AbortError')throw cancelled();throw error;}}
  let writable=null,finished=false,activeBytes=0;const parts=[];let completedFiles=0,completedBytes=0;
  const report=(phase,read=0)=>progress(onProgress,phase,completedFiles,plan.fileCount,Math.min(plan.totalBytes,completedBytes+read),plan.totalBytes);
  try{
    if(canFSA){const handle=await abortable(picker,signal);check(signal);const pending=handle.createWritable();pending.then(stream=>{if(signal?.aborted)void stream.abort().catch(()=>{});},()=>{});writable=await abortable(pending,signal);}
    check(signal);report('preparing');
    const entries=plan.files.map(file=>({name:file.path,size:file.bytes,load:()=>readVerified(file,baseURL,signal,read=>report('reading',read)).then(bytes=>{activeBytes=bytes.length;return bytes;})}));entries.push({name:'BATCH-MANIFEST.json',size:manifest.length,load:async()=>manifest});
    const sink=canFSA?async bytes=>{check(signal);await abortable(writable.write(bytes),signal);}:async bytes=>{parts.push(bytes);};
    await zipToSink(entries,sink,{signal,stream:canFSA,onProgress:event=>{
      if(event.phase==='crc')report('crc',activeBytes);
      if(event.phase==='zip'&&event.completedFiles<=plan.fileCount){completedFiles=event.completedFiles;completedBytes+=plan.files[completedFiles-1].bytes;activeBytes=0;report('packing');}
    }});
    check(signal);report('saving');
    if(canFSA){await abortable(writable.close(),signal);check(signal);finished=true;return{handedOff:true,method:'file-system'};}
    const blob=new Blob(parts,{type:'application/zip'});check(signal);const address=URL.createObjectURL(blob);try{check(signal);nativeClick(address,saveName);}finally{setTimeout(()=>URL.revokeObjectURL(address),60000);}check(signal);finished=true;return{handedOff:true,method:'blob'};
  }catch(error){if(writable&&!finished){try{const cleanup=Promise.resolve(writable.abort()).catch(()=>{});if(!signal?.aborted)await cleanup;}catch{}}if(signal?.aborted||error.name==='AbortError')throw cancelled();throw error;}
}
