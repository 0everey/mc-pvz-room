const cancelled=()=>new DOMException('请求已取消','AbortError');

// Slots cover the complete transfer. Rank 0 can use capacity reserved from
// ordinary visible work; near-view/background work can never fill the pool.
export class ResourceQueue{
 constructor({limit=6,nonUrgentLimit=4,lowLimit=1,cacheBytes=24*1024*1024,fetcher=globalThis.fetch.bind(globalThis)}={}){
  this.limit=limit;this.nonUrgentLimit=nonUrgentLimit;this.lowLimit=lowLimit;this.cacheLimit=cacheBytes;this.fetcher=fetcher;
  this.records=new Map();this.waiting=[];this.active=new Set();this.cached=new Map();this.cachedBytes=0;this.sequence=0;this.scheduled=false;this.reload=new Set();
 }
 rank(record){let rank=Infinity;for(const consumer of record.consumers){let value=typeof consumer.priority==='function'?consumer.priority():consumer.priority;value=Number.isFinite(value)?Math.max(0,value):3;if(typeof document!=='undefined'&&document.hidden)value=Math.max(3,value);rank=Math.min(rank,value);}return rank;}
 refresh(){if(!this.scheduled){this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}}
 bytes(url,{signal,priority=1,cache=true}={}){
  const address=new URL(url,globalThis.location?.href||'http://localhost/').href;
  const key=cache?'bytes:'+address:'fresh:'+this.sequence++;
  return this.acquire(key,async(innerSignal,record)=>{
   const rank=this.rank(record),fresh=this.reload.delete(address),response=await this.fetcher(address,{signal:innerSignal,cache:fresh?'reload':cache?'force-cache':'no-store',priority:rank<2?'high':rank<3?'auto':'low'});
   if(!response.ok){const error=Error('资源读取失败：HTTP '+response.status);error.status=response.status;throw error;}
   const bytes=await response.arrayBuffer();
   if(innerSignal.aborted)throw cancelled();return bytes;
  },{signal,priority,cache});
 }
 run(work,{signal,priority=2}={}){return this.acquire('task:'+this.sequence++,innerSignal=>work(innerSignal),{signal,priority,cache:false});}
 acquire(key,work,{signal,priority,cache}){
  if(signal?.aborted)return Promise.reject(cancelled());
  let record=this.records.get(key);
  if(record?.state==='done'){
   this.cached.delete(key);this.cached.set(key,record);return Promise.resolve(record.value);
  }
  if(!record){record={key,work,cache,sequence:this.sequence++,state:'waiting',controller:new AbortController(),consumers:new Set(),value:null};this.records.set(key,record);this.waiting.push(record);}
  const promise=new Promise((resolve,reject)=>{
   const consumer={resolve,reject,signal,priority};
   const release=()=>{signal?.removeEventListener('abort',abort);record.consumers.delete(consumer);};
   const abort=()=>{
    release();reject(cancelled());
    if(!record.consumers.size&&record.state!=='done'){
     if(this.records.get(key)===record)this.records.delete(key);
     record.controller.abort();if(record.state==='waiting')record.state='cancelled';
    }
    this.refresh();
   };
   consumer.finish=(error,value)=>{release();error?reject(error):resolve(value);};
   record.consumers.add(consumer);signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
  });
  this.refresh();return promise;
 }
 pump(){
  this.waiting=this.waiting.filter(record=>record.state==='waiting'&&record.consumers.size);
  this.waiting.sort((a,b)=>this.rank(a)-this.rank(b)||a.sequence-b.sequence);
  while(this.active.size<this.limit){
   let nonUrgent=0,low=0;
   for(const active of this.active){const rank=this.rank(active);if(rank>=1)nonUrgent++;if(rank>=2)low++;}
   const index=this.waiting.findIndex(record=>{const rank=this.rank(record);return rank<1||(nonUrgent<this.nonUrgentLimit&&(rank<2||low<this.lowLimit));});
   if(index<0)break;
   const record=this.waiting.splice(index,1)[0];record.state='running';this.active.add(record);
   Promise.resolve().then(()=>{if(record.controller.signal.aborted)throw cancelled();return record.work(record.controller.signal,record);})
    .then(value=>{
     record.state='done';record.value=value;
     if(record.cache&&value instanceof ArrayBuffer&&value.byteLength<=this.cacheLimit&&this.records.get(record.key)===record){this.cached.set(record.key,record);this.cachedBytes+=value.byteLength;}
     else if(this.records.get(record.key)===record)this.records.delete(record.key);
     for(const consumer of [...record.consumers])consumer.finish(null,value);
     this.trim();
    },error=>{
     record.state='failed';if(this.records.get(record.key)===record)this.records.delete(record.key);
     for(const consumer of [...record.consumers])consumer.finish(error);
    }).finally(()=>{this.active.delete(record);this.refresh();});
  }
 }
 trim(){
  for(const [key,record]of this.cached){
   if(this.cachedBytes<=this.cacheLimit)break;
   if(record.consumers.size)continue;
   this.cached.delete(key);if(this.records.get(key)===record)this.records.delete(key);this.cachedBytes-=record.value.byteLength;
  }
 }
 invalidate(url){const address=new URL(url,globalThis.location?.href||'http://localhost/').href,key='bytes:'+address,record=this.cached.get(key);if(record){this.cached.delete(key);this.cachedBytes-=record.value.byteLength;if(this.records.get(key)===record)this.records.delete(key);}this.reload.add(address);while(this.reload.size>128)this.reload.delete(this.reload.values().next().value);}
 dispose(){
  for(const record of this.records.values())if(record.state!=='done'){
   record.controller.abort();for(const consumer of [...record.consumers])consumer.finish(cancelled());
   if(record.state==='waiting')record.state='cancelled';
  }
  this.records.clear();this.cached.clear();this.cachedBytes=0;this.waiting.length=0;
 }
}

export const resourceQueue=new ResourceQueue();

export function viewPriority(host,detail=false){
 if(document.hidden)return 3;
 if(detail)return 0;
 if(document.querySelector('dialog[open]')||(innerWidth<=900&&document.body.classList.contains('groups-open')))return 3;
 const root=document.getElementById('gridWrap'),a=host.getBoundingClientRect(),b=root?.getBoundingClientRect();
 if(!host.isConnected||!b)return 3;
 if(a.bottom>b.top&&a.top<b.bottom&&a.right>b.left&&a.left<b.right)return host.dataset.urgent==='true'?0:1;
 return a.bottom>b.top-64&&a.top<b.bottom+64?2:3;
}

export function foregroundVisible(host){
 if(document.hidden)return false;
 if(innerWidth<=900&&document.body.classList.contains('groups-open')&&!document.getElementById('groupSidebar')?.contains(host))return false;
 const dialog=document.querySelector('dialog[open]');return !dialog||dialog.contains(host);
}
