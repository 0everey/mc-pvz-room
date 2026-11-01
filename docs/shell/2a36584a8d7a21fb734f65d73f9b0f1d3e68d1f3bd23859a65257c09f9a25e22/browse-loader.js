import {resourceQueue} from './request-queue.js';

const fail=message=>{throw Error(message);};
const aborted=()=>new DOMException('资料准备已取消','AbortError');
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const hex=value=>Array.from(new TextEncoder().encode(value),v=>v.toString(16).padStart(2,'0')).join('');
const text=(value,label)=>typeof value==='string'&&value.length>0?value:fail(label+'无效');
const normal=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));

export function expandRanges(ranges,total){
 if(!Array.isArray(ranges))fail('目录成员格式无效');const values=[];let previous=0;
 for(const pair of ranges){if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair[0]<previous||pair[0]<0||pair[1]<=pair[0]||pair[1]>total)fail('目录成员范围无效');for(let i=pair[0];i<pair[1];i++)values.push(i);previous=pair[1];}
 return values;
}

export class BrowseLoader{
 constructor(seed){
  if(seed?.schema!=='mc-pvz.browse.v1'||seed.type!=='seed'||!Number.isSafeInteger(seed.rowCount)||seed.rowCount<0||!/^data\/browse\/[a-f0-9]{64}\/$/.test(seed.dataRoot)||!Number.isSafeInteger(seed.headerSize)||seed.headerSize<1||!Number.isSafeInteger(seed.detailSize)||seed.detailSize<1)fail('页面目录版本无效，请刷新。');
  this.seed=seed;this.total=seed.rowCount;this.base=new URL(seed.dataRoot,document.baseURI);this.controller=new AbortController();this.documents=new Map();this.groups=new Map();this.rows=new Map();this.byId=new Map();this.headers=new Set();this.details=new Set();this.identityReady=false;this.identityPromise=null;this.identityConsumers=new Set();
  this.catalog={schema:'mc-pvz.browse-state.v1',libraryId:seed.libraryId,revision:seed.revision,...seed.meta,items:[],assets:{},models:{},textures:{},mcItems:{},identityReady:false};
  this.kinds=Object.create(null);this.classMasks={};
  for(const [field,groups]of Object.entries(seed.classes||{})){
   this.classMasks[field]=new Map();const seen=new Set();
   for(const [name,ranges]of Object.entries(groups)){
    const values=expandRanges(ranges,this.total);this.classMasks[field].set(name,new Set(values));
    if(field!=='filter')for(const index of values){if(seen.has(index))fail('资源分类身份重复');seen.add(index);if(!this.kinds[index])this.kinds[index]={};this.kinds[index][field]=name;}
   }
   if(field!=='filter'&&seen.size!==this.total)fail('资源分类身份不完整');
  }
  for(const [key,value]of Object.entries(seed.groups||{})){this.checkGroup(value);if(key!==value.id)fail('首层目录身份无效');this.groups.set(key,value);}
 }
 check(signal){if(this.controller.signal.aborted||signal?.aborted)throw aborted();}
 stamp(value,type){if(!object(value)||value.schema!==this.seed.schema||value.dataset!==this.seed.dataset||value.libraryId!==this.seed.libraryId||value.revision!==this.seed.revision||(type&&value.type!==type))fail('资料与当前目录版本不一致，请刷新。');return value;}
 async json(path,type,signal,priority=0){
  this.check(signal);if(this.documents.has(path))return this.documents.get(path);
  const controller=new AbortController(),signals=[this.controller.signal,signal].filter(Boolean),cancel=()=>controller.abort();
  for(const source of signals){source.addEventListener('abort',cancel,{once:true});if(source.aborted)cancel();}
  try{
   const raw=await resourceQueue.bytes(new URL(path,this.base),{signal:controller.signal,priority});this.check(signal);
   const value=this.stamp(JSON.parse(new TextDecoder().decode(raw)),type);this.check(signal);
   this.documents.set(path,value);if(this.documents.size>96){const key=this.documents.keys().next().value;this.documents.delete(key);}
   return value;
  }catch(error){if(error.name!=='AbortError'){this.invalidate(path);if(error.status===404&&this.catalog.mode==='local'&&!path.startsWith('groups/'))error.reloadBootstrap=true;}throw error;
  }finally{for(const source of signals)source.removeEventListener('abort',cancel);}
 }
 invalidate(path){this.documents.delete(path);resourceQueue.invalidate(new URL(path,this.base));}
 resetIdentity(){this.identityPromise=null;this.identityReady=false;this.catalog.identityReady=false;this.invalidate('identity.json');this.invalidate('structure.json');}
 checkGroup(group){
  this.stamp(group,'group');text(group.id,'分类ID');text(group.label,'分类名称');
  if(!Number.isSafeInteger(group.count)||group.count<0||!Array.isArray(group.children)||!Array.isArray(group.breadcrumbs)||!group.breadcrumbs.length)fail('分类记录无效');
  const members=expandRanges(group.ranges,this.total);if(members.length!==group.count)fail('分类计数不完整');
  for(const child of group.children){text(child.id,'子分类ID');text(child.label,'子分类名称');if(!Number.isSafeInteger(child.count)||child.count<0||!Number.isSafeInteger(child.childCount)||child.childCount<0)fail('子分类计数无效');}
  return group;
 }
 async group(id,signal,priority=0,redirect=false){
  this.check(signal);if(typeof id!=='string'||!id||id.length>240)fail('分类链接无效');
  if(this.groups.has(id))return this.groups.get(id);
  const path='groups/'+hex(id)+'.json';try{const value=await this.json(path,null,signal,priority);
  if(value.type==='alias'){
   if(redirect||value.id!==id||typeof value.target!=='string'||value.target===id)fail('分类别名无效');
   const target=await this.group(value.target,signal,priority,true);this.groups.set(id,target);return target;
  }
  this.checkGroup(value);if(value.id!==id)fail('分类身份不一致');this.groups.set(id,value);return value;
  }catch(error){if(error.name!=='AbortError')this.invalidate(path);throw error;}
 }
 memberIndices(group){return expandRanges(group.ranges,this.total);}
 filter(indices,{kind='all',game='all',source=''}={}){
  const mask=kind==='all'?null:this.classMasks.filter?.get(kind)||this.classMasks.kind?.get(kind);
  const games=game==='all'?null:this.classMasks.game.get(game),sources=source?this.classMasks.source.get(source):null;
  if(kind!=='all'&&!mask)return[];
  return indices.filter(i=>(!mask||mask.has(i))&&(!games||games.has(i))&&(!sources||sources.has(i)));
 }
 order(indices,featured=false,overview=false){
  if(featured){const scope=new Set(indices);return this.seed.featuredOrder.filter(i=>scope.has(i));}
  if(!overview)return indices;
  const pools=['spine','mc-model','recipe','texture','gif','audio','sound-event','definition','image'].map(kind=>indices.filter(i=>this.kinds[i].kind===kind));
  const positions=pools.map(()=>0),result=[];
  while(result.length<indices.length){let added=false;for(let j=0;j<pools.length;j++)if(positions[j]<pools[j].length){result.push(pools[j][positions[j]++]);added=true;}if(!added)break;}
  return result;
 }
 merge(index,row){
  if(!Number.isSafeInteger(index)||index<0||index>=this.total||!object(row)||typeof row.id!=='string')fail('资源记录身份无效');
  const current=this.rows.get(index);if(current&&current.id!==row.id)fail('资源行身份已变化');
  if(this.byId.has(row.id)&&this.byId.get(row.id)!==index)fail('资源身份重复');
  if(this.identityReady&&row.downloadFingerprint&&this.catalog.items[index].downloadFingerprint!==row.downloadFingerprint)fail('原件指纹与完整身份不一致');
  const value=current||{};Object.assign(value,row,{index});this.rows.set(index,value);this.byId.set(value.id,index);return value;
 }
 async header(index,signal,priority=0){
  this.check(signal);if(!Number.isSafeInteger(index)||index<0||index>=this.total)fail('资源索引越界');
  if(this.headers.has(index))return this.rows.get(index);
  const page=Math.floor(index/this.seed.headerSize),path='headers/'+page+'.json';try{const packet=await this.json(path,'headers',signal,priority);
  const start=page*this.seed.headerSize;if(packet.start!==start||!Array.isArray(packet.items)||packet.items.length!==Math.min(this.seed.headerSize,this.total-start))fail('检索页记录不完整');
  const seen=new Set();for(let offset=0;offset<packet.items.length;offset++){
   const row=packet.items[offset],i=start+offset;if(row.index!==i||typeof row.search!=='string'||typeof row.featured!=='boolean')fail('检索行无效');
   for(const field of ['id','name','displayName','relativePath','game','source','kind','category'])if(typeof row[field]!=='string')fail('检索字段无效');
   if(row.kind!==this.kinds[i].kind||row.game!==this.kinds[i].game||row.source!==this.kinds[i].source)fail('检索分类身份不一致');
   if(seen.has(row.id)||(this.byId.has(row.id)&&this.byId.get(row.id)!==i)||(this.rows.has(i)&&this.rows.get(i).id!==row.id))fail('检索资源身份重复或变化');seen.add(row.id);
  }
  for(const row of packet.items){this.merge(row.index,row);this.headers.add(row.index);}return this.rows.get(index);
  }catch(error){if(error.name!=='AbortError')this.invalidate(path);throw error;}
 }
 async detail(indices,signal,priority=1){
  this.check(signal);const pages=[...new Set(indices.filter(i=>!this.details.has(i)).map(i=>Math.floor(i/this.seed.detailSize)))];
  await Promise.all(pages.map(async page=>{const path='details/'+page+'.json';try{
   const packet=await this.json(path,'details',signal,priority);this.check(signal);
   if(packet.start!==page*this.seed.detailSize||packet.end!==Math.min(packet.start+this.seed.detailSize,this.total)||!Array.isArray(packet.items)||!object(packet.assets))fail('目标资料范围不完整');
   for(const [id,asset]of Object.entries(packet.assets)){
    if(!object(asset)||!/^media\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(asset.url)||!Number.isSafeInteger(asset.bytes)||asset.bytes<0||!/^[a-f0-9]{64}$/.test(asset.sha256)||typeof asset.name!=='string'||typeof asset.sourceRelative!=='string')fail('原件描述无效');
    if(own(this.catalog.assets,id)&&JSON.stringify(this.catalog.assets[id])!==JSON.stringify(asset))fail('原件描述发生混版');
   }
   const provided=new Set(),ids=new Set();for(const item of packet.items){
    const row=item.row;if(!object(row)||!Array.isArray(row.files)||typeof row.asset!=='string'||!/^[a-f0-9]{64}$/.test(row.downloadFingerprint))fail('目标原件身份无效');
    if(!Number.isSafeInteger(item.index)||item.index<0||item.index>=this.total||provided.has(item.index)||ids.has(row.id)||typeof row.id!=='string'||row.kind!==this.kinds[item.index].kind||row.game!==this.kinds[item.index].game||row.source!==this.kinds[item.index].source)fail('目标行身份无效');
    if((this.rows.has(item.index)&&this.rows.get(item.index).id!==row.id)||(this.byId.has(row.id)&&this.byId.get(row.id)!==item.index)||(this.identityReady&&this.catalog.items[item.index].downloadFingerprint!==row.downloadFingerprint))fail('目标资料与当前身份不同版');ids.add(row.id);
    for(const id of [row.asset,...row.files])if(!own(packet.assets,id))fail('目标原件闭包不完整');
    if(row.preview?.asset&&!own(packet.assets,row.preview.asset))fail('目标预览闭包不完整');provided.add(item.index);
   }
   for(let i=packet.start;i<packet.end;i++)if(!provided.has(i))fail('目标资料缺失');
   for(const field of ['assets','models','textures','mcItems']){
    if(!object(packet[field]))fail('预览上下文无效');
    for(const [key,value]of Object.entries(packet[field])){
     if(own(this.catalog[field],key)&&JSON.stringify(this.catalog[field][key])!==JSON.stringify(value))fail('预览上下文发生混版');
     const asset=field==='models'||field==='textures'?value:field==='mcItems'?value.asset:null;if(asset&&!own(packet.assets,asset))fail('预览查找关系缺少原件描述');
    }
   }
   for(const field of ['assets','models','textures','mcItems'])Object.assign(this.catalog[field],packet[field]);
   for(const item of packet.items){this.merge(item.index,item.row);this.details.add(item.index);}
  }catch(error){if(error.name!=='AbortError')this.invalidate(path);throw error;}
  }));this.check(signal);return indices.map(index=>this.rows.get(index));
 }
 async ensureItems(ids,signal,priority=0){
  const indices=ids.map(id=>{if(!this.byId.has(id))fail(this.identityReady?'此范围有已缺失资源，请核对分组成员。':'资源身份尚未准备完成');return this.byId.get(id);});
  await this.detail(indices,signal,priority);return this.catalog;
 }
 context(){return{models:this.catalog.models,textures:this.catalog.textures,mcItems:this.catalog.mcItems,items:[...this.details].sort((a,b)=>a-b).map(i=>this.rows.get(i))};}
 async search(query,scope,signal,onProgress=()=>{},priority=()=>0){
  this.check(signal);const tokens=normal(query).trim().split(/\s+/).filter(Boolean);if(!tokens.length)return scope;
  const selected=[];for(const token of [...tokens].sort((a,b)=>Array.from(b).length-Array.from(a).length)){
   const chars=Array.from(token),width=Math.min(3,chars.length);for(const offset of new Set([0,Math.max(0,Math.floor((chars.length-width)/2)),chars.length-width])){
    const gram=chars.slice(offset,offset+width).join('');if(!selected.some(x=>x.gram===gram))selected.push({gram,width});if(selected.length===4)break;
   }if(selected.length===4)break;
  }
  let candidates=new Set(scope);
  const terms=await Promise.all(selected.map(async term=>{
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(term.gram)));this.check(signal);
   const bucket=digest[0].toString(16).padStart(2,'0'),path='search/'+term.width+'/'+bucket+'.json';try{const packet=await this.json(path,'search',signal,priority);
   if(packet.width!==term.width||packet.bucket!==bucket||!object(packet.postings))fail('检索倒排版本无效');
   const values=packet.postings[term.gram]||[];if(!Array.isArray(values)||values.some((i,j)=>!Number.isSafeInteger(i)||i<0||i>=this.total||(j>0&&i<=values[j-1])))fail('检索成员无效');return new Set(values);
   }catch(error){if(error.name!=='AbortError')this.invalidate(path);throw error;}
  }));
  for(const values of terms)candidates=new Set([...candidates].filter(i=>values.has(i)));
  const ordered=[...candidates].sort((a,b)=>a-b),exact=tokens.length<=selected.length&&tokens.every(token=>Array.from(token).length<=3&&selected.some(v=>v.gram===token));
  if(exact){onProgress(ordered,true);return ordered;}
  const pages=new Map();for(const index of ordered){const page=Math.floor(index/this.seed.headerSize);if(!pages.has(page))pages.set(page,[]);pages.get(page).push(index);}
  const result=[],entries=[...pages.values()];let nextPromise=null;
  for(let j=0;j<entries.length;j++){
   this.check(signal);const current=nextPromise||this.header(entries[j][0],signal,priority);
   nextPromise=j+1<entries.length?this.header(entries[j+1][0],signal,priority):null;if(nextPromise)nextPromise.catch(()=>{});
   await current;this.check(signal);for(const index of entries[j])if(tokens.every(token=>this.rows.get(index).search.includes(token)))result.push(index);
   onProgress([...result],j===entries.length-1);await yieldTask();
  }
  if(!entries.length)onProgress([],true);return result;
 }
 identity(priority=3,signal){
  this.check(signal);const consumer={priority};this.identityConsumers.add(consumer);resourceQueue.refresh();
  const operation=this.loadIdentity();let promise=operation;
  if(signal)promise=new Promise((resolve,reject)=>{const abort=()=>reject(aborted());signal.addEventListener('abort',abort,{once:true});operation.then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(aborted()):resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});if(signal.aborted)abort();});
  return promise.finally(()=>{this.identityConsumers.delete(consumer);resourceQueue.refresh();});
 }
 loadIdentity(){
  if(this.identityPromise)return this.identityPromise;
  this.identityPromise=(async()=>{
   const getter=()=>Math.min(3,...[...this.identityConsumers].map(v=>typeof v.priority==='function'?v.priority():v.priority));
   const [identity,structure]=await Promise.all([this.json('identity.json','identity',null,getter),this.json('structure.json','structure',null,getter)]);
   if(!Array.isArray(identity.items)||identity.items.length!==this.total||!Array.isArray(structure.nodes)||!object(structure.roots)||!object(structure.aliases))fail('完整选择身份不完整');
   const ids=new Set(),items=[];
   for(let i=0;i<this.total;i++){
    const pair=identity.items[i];if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!/^[a-f0-9]{64}$/.test(pair[1])||ids.has(pair[0]))fail('完整选择身份无效');ids.add(pair[0]);
    const current=this.rows.get(i);if(current&&(current.id!==pair[0]||(current.downloadFingerprint&&current.downloadFingerprint!==pair[1])))fail('资料与完整原件身份不同版');
    if(i%512===511)await yieldTask();
   }
   this.check();for(let i=0;i<this.total;i++){const pair=identity.items[i];items.push(this.merge(i,{id:pair[0],downloadFingerprint:pair[1],...this.kinds[i]}));}
   const keys=structure.nodes.map(v=>text(v?.[0],'分组ID'));if(new Set(keys).size!==keys.length)fail('分组身份重复');
   const ref=(values,i)=>{if(!Number.isSafeInteger(i)||i<0||i>=values.length)fail('目录引用无效');return values[i];};
   const nodes=Object.fromEntries(structure.nodes.map(v=>{
    if(!Array.isArray(v)||v.length!==7||!Array.isArray(v[4])||!Array.isArray(v[5]))fail('目录结构无效');
    return[v[0],{id:v[0],parentId:v[1]===null?null:ref(keys,v[1]),label:v[2],kind:v[3],children:v[4].map(i=>ref(keys,i)),directItems:v[5].map(i=>ref(items,i).id),count:v[6]}];
   }));
   this.check();this.catalog.items=items;this.catalog.hierarchy={nodes,roots:Object.fromEntries(Object.entries(structure.roots).map(([k,i])=>[k,ref(keys,i)])),aliases:Object.fromEntries(Object.entries(structure.aliases).map(([k,i])=>[k,ref(keys,i)]))};
   this.identityReady=true;this.catalog.identityReady=true;return this.catalog;
  })().catch(error=>{this.resetIdentity();throw error;});return this.identityPromise;
 }
 dispose(){this.controller.abort();}
}
