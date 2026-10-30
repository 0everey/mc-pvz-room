const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = message => { throw new Error(message); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, label) => { if (typeof value !== 'string' || !value.trim()) fail(`${label}必须是非空字符串`); return value; };
const uniqueStrings = (values, label) => {
  if (!Array.isArray(values)) fail(`${label}必须是数组`);
  const result = new Set();
  for (const value of values) { text(value, label); if (result.has(value)) fail(`${label}有重复 ID：${value}`); result.add(value); }
  return result;
};
function itemIndex(catalog) {
  text(catalog?.libraryId, 'libraryId');
  if (!Array.isArray(catalog.items)) fail('catalog.items 必须是数组');
  const map = new Map();
  for (const item of catalog.items) {
    text(item?.id, 'item.id');
    if (map.has(item.id)) fail(`重复 item ID：${item.id}`);
    map.set(item.id, item);
  }
  return map;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

export class Hierarchy {
  #nodes = new Map(); #members = new Map();
  constructor(catalog) {
    const items = itemIndex(catalog), hierarchy = catalog.hierarchy;
    if (!record(hierarchy?.nodes) || !record(hierarchy.roots)) fail('hierarchy.nodes/roots 缺失');
    for (const [key, raw] of Object.entries(hierarchy.nodes)) {
      if (!record(raw) || raw.id !== key) fail(`分组 ID 不匹配：${key}`);
      text(raw.label, '分组 label'); text(raw.kind, '分组 kind');
      if (raw.parentId !== null) text(raw.parentId, 'parentId');
      const children = [...uniqueStrings(raw.children, `${key}.children`)];
      const directItems = [...uniqueStrings(raw.directItems, `${key}.directItems`)];
      for (const id of directItems) if (!items.has(id)) fail(`分组引用未知 item：${id}`);
      if (!Number.isSafeInteger(raw.count) || raw.count < 0) fail(`分组 count 无效：${key}`);
      this.#nodes.set(key, freeze({ id:key, parentId:raw.parentId, label:raw.label, kind:raw.kind, children, directItems, count:raw.count }));
    }
    for (const node of this.#nodes.values()) {
      if (node.parentId !== null) {
        const parent = this.#nodes.get(node.parentId);
        if (!parent || !parent.children.includes(node.id)) fail(`分组父关系不完整：${node.id}`);
      }
      for (const id of node.children) if (this.#nodes.get(id)?.parentId !== node.id) fail(`分组子关系不匹配：${node.id} → ${id}`);
    }
    for (const [kind,id] of Object.entries(hierarchy.roots)) if (!this.#nodes.has(id) || this.#nodes.get(id).parentId !== null) fail(`根分组无效：${kind}`);
    const visiting = new Set();
    const collect = id => {
      if (visiting.has(id)) fail(`分组存在循环：${id}`);
      if (this.#members.has(id)) return this.#members.get(id);
      visiting.add(id); const node=this.#nodes.get(id), members=new Set(node.directItems);
      for (const child of node.children) for (const item of collect(child)) members.add(item);
      visiting.delete(id);
      if (members.size !== node.count) fail(`分组 count 不符：${id}，应为 ${members.size}`);
      this.#members.set(id,members); return members;
    };
    for (const id of this.#nodes.keys()) collect(id);
  }
  node(id) { return this.#nodes.get(id) || null; }
  children(id) { const node=this.node(id); if (!node) fail(`未知分组：${id}`); return node.children.map(id=>this.#nodes.get(id)); }
  members(id) { if (!this.#members.has(id)) fail(`未知分组：${id}`); return new Set(this.#members.get(id)); }
  breadcrumbs(id) { const path=[]; for (let node=this.node(id); node; node=node.parentId===null?null:this.node(node.parentId)) path.unshift(node); if (!path.length) fail(`未知分组：${id}`); return path; }
}

function readStorage(storage,key) {
  if (!storage) return null;
  let raw;
  try { raw=storage.getItem(key); } catch (error) { throw new Error(`storage 读取失败：${error.message}`,{cause:error}); }
  if (raw===null || raw===undefined) return null;
  try { return JSON.parse(raw); } catch (error) { throw new Error('storage 内容不是有效 JSON',{cause:error}); }
}
function persist(storage,key,value) {
  if (!storage) return;
  try { storage.setItem(key,JSON.stringify(value)); } catch (error) { throw new Error(`storage 写入失败：${error.message}`,{cause:error}); }
}
function selectionCatalog(catalog) {
  const items=itemIndex(catalog), fingerprints=new Map();
  for (const item of items.values()) fingerprints.set(item.id,text(item.downloadFingerprint,`item ${item.id} downloadFingerprint`));
  return {libraryId:catalog.libraryId,items,fingerprints};
}

export class SelectionModel {
  #catalog; #selected=new Map(); #storage; #key; #busy=false;
  lastReconciliation={removed:[],changed:[]};
  constructor(catalog,storage,storageKey) {
    this.#catalog=selectionCatalog(catalog); this.#storage=storage;
    this.#key=storageKey||`resource-selection.v1:${catalog.libraryId}`;
    const saved=readStorage(storage,this.#key);
    if (saved!==null) {
      if (!record(saved) || saved.libraryId!==catalog.libraryId || !record(saved.fingerprints)) fail('选择记录的 libraryId 或 fingerprints 无效');
      const next=new Map(); const removed=[],changed=[];
      for (const [id,fingerprint] of Object.entries(saved.fingerprints)) {
        text(id,'选择 ID'); text(fingerprint,'选择 fingerprint');
        if (!this.#catalog.items.has(id)) removed.push(id);
        else if (this.#catalog.fingerprints.get(id)!==fingerprint) changed.push(id);
        else next.set(id,fingerprint);
      }
      if(removed.length||changed.length)persist(this.#storage,this.#key,this.#encoded(next)); this.#selected=next;
      this.lastReconciliation={removed,changed};
    }
  }
  #encoded(selected, catalog=this.#catalog) { return {libraryId:catalog.libraryId,fingerprints:Object.fromEntries(selected)}; }
  #mutate(fn) {
    if (this.#busy) fail('选择状态不允许重入修改'); this.#busy=true;
    try { const next=new Map(this.#selected); const result=fn(next); persist(this.#storage,this.#key,this.#encoded(next)); this.#selected=next; return result; }
    finally { this.#busy=false; }
  }
  #known(ids) { return [...new Set(ids)].map(id=>{if (!this.#catalog.items.has(id)) fail(`未知 item：${id}`); return id;}); }
  get ids() { return new Set(this.#selected.keys()); }
  has(id) { return this.#selected.has(id); }
  toggle(id,force) {
    this.#known([id]); if (force!==undefined && typeof force!=='boolean') fail('force 必须是布尔值');
    return this.#mutate(next=>{const selected=force===undefined?!next.has(id):force;if(selected)next.set(id,this.#catalog.fingerprints.get(id));else next.delete(id);return selected;});
  }
  add(ids) { const known=this.#known(ids); return this.#mutate(next=>{for(const id of known)next.set(id,this.#catalog.fingerprints.get(id));return next.size;}); }
  remove(ids) { const values=[...new Set(ids)]; return this.#mutate(next=>{for(const id of values)next.delete(id);return next.size;}); }
  clear() { return this.#mutate(next=>{next.clear();return true;}); }
  coverage(ids) { const unique=new Set(ids);let selected=0;for(const id of unique)if(this.#selected.has(id))selected++;return {total:unique.size,selected,all:unique.size>0&&selected===unique.size,some:selected>0&&selected<unique.size}; }
  reconcile(catalog) {
    if(this.#busy)fail('选择状态不允许重入修改'); const current=selectionCatalog(catalog);
    if(current.libraryId!==this.#catalog.libraryId)fail('不能 reconcile 另一 libraryId');
    this.#busy=true;
    try {
      const next=new Map(),removed=[],changed=[];
      for(const [id,fp]of this.#selected)if(!current.items.has(id))removed.push(id);else if(current.fingerprints.get(id)!==fp)changed.push(id);else next.set(id,fp);
      persist(this.#storage,this.#key,this.#encoded(next,current));this.#catalog=current;this.#selected=next;this.lastReconciliation={removed,changed};return {removed:[...removed],changed:[...changed]};
    }finally{this.#busy=false;}
  }
}

const COLLECTION_SCHEMA='resource-collections.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function groupName(name) { text(name,'分组名称'); const clean=name.trim();if(clean.length>120||/[\x00-\x1f\x7f]/.test(clean))fail('分组名称过长或含控制字符');return clean; }
function validateCollections(value,libraryId) {
  if(!record(value)||value.schema!==COLLECTION_SCHEMA||value.libraryId!==libraryId||!Array.isArray(value.groups))fail('分组配方 schema/libraryId/groups 无效');
  const map=new Map();
  for(const raw of value.groups){
    if(!record(raw)||typeof raw.id!=='string'||!UUID.test(raw.id)||map.has(raw.id))fail('分组 UUID 无效或重复');
    if(raw.parentId!==null&&(typeof raw.parentId!=='string'||!UUID.test(raw.parentId)))fail('分组 parentId 无效');
    map.set(raw.id,{id:raw.id,parentId:raw.parentId,name:groupName(raw.name),members:[...uniqueStrings(raw.members,'合集 members')]});
  }
  const done=new Set(),visiting=new Set();
  const walk=id=>{if(done.has(id))return;if(visiting.has(id))fail('我的分组存在循环');visiting.add(id);const p=map.get(id).parentId;if(p!==null){if(!map.has(p))fail('我的分组 parent 不存在');walk(p);}visiting.delete(id);done.add(id);};
  for(const id of map.keys())walk(id);return map;
}

export class CollectionStore {
  #catalog; #storage; #key; #groups=new Map(); #busy=false;
  constructor(catalog,storage,storageKey){this.#catalog={libraryId:text(catalog?.libraryId,'libraryId'),items:itemIndex(catalog)};this.#storage=storage;this.#key=storageKey||`resource-collections.v1:${catalog.libraryId}`;const saved=readStorage(storage,this.#key);if(saved!==null)this.#groups=validateCollections(saved,catalog.libraryId);}
  #encoded(groups=this.#groups){return{schema:COLLECTION_SCHEMA,libraryId:this.#catalog.libraryId,groups:[...groups.values()].map(group=>({...group,members:[...group.members]}))};}
  #mutate(fn){if(this.#busy)fail('分组状态不允许重入修改');this.#busy=true;try{const next=new Map([...this.#groups].map(([id,g])=>[id,{...g,members:[...g.members]}]));const result=fn(next);const validated=validateCollections(this.#encoded(next),this.#catalog.libraryId);persist(this.#storage,this.#key,this.#encoded(validated));this.#groups=validated;return result;}finally{this.#busy=false;}}
  #group(map,id){const group=map.get(id);if(!group)fail(`未知我的分组：${id}`);return group;}
  get groups(){return this.#encoded().groups;}
  create(name,parentId=null){name=groupName(name);if(parentId!==null)this.#group(this.#groups,parentId);const id=crypto.randomUUID();return this.#mutate(next=>{next.set(id,{id,parentId,name,members:[]});return id;});}
  rename(id,name){name=groupName(name);return this.#mutate(next=>{this.#group(next,id).name=name;return true;});}
  remove(id){return this.#mutate(next=>{this.#group(next,id);const remove=new Set([id]);let more=true;while(more){more=false;for(const group of next.values())if(remove.has(group.parentId)&&!remove.has(group.id)){remove.add(group.id);more=true;}}for(const key of remove)next.delete(key);return true;});}
  addItems(id,ids){const values=[...new Set(ids)];for(const value of values)text(value,'成员 ID');return this.#mutate(next=>{const group=this.#group(next,id);group.members=[...new Set([...group.members,...values])];return group.members.length;});}
  removeItems(id,ids){const values=new Set(ids);return this.#mutate(next=>{const group=this.#group(next,id);group.members=group.members.filter(value=>!values.has(value));return group.members.length;});}
  members(id,recursive=true){this.#group(this.#groups,id);const result=new Set(),walk=key=>{const group=this.#groups.get(key);for(const member of group.members)result.add(member);if(recursive)for(const child of this.#groups.values())if(child.parentId===key)walk(child.id);};walk(id);return result;}
  children(id=null){if(id!==null)this.#group(this.#groups,id);return this.groups.filter(group=>group.parentId===id);}
  exportJSON(){return JSON.stringify(this.#encoded(),null,2)+'\n';}
  importJSON(raw){let value;try{value=JSON.parse(raw);}catch(error){throw new Error('分组配方不是有效 JSON',{cause:error});}const validated=validateCollections(value,this.#catalog.libraryId);return this.#mutate(next=>{next.clear();for(const [id,group]of validated)next.set(id,group);return true;});}
  reconcile(catalog){if(this.#busy)fail('分组状态不允许重入修改');const items=itemIndex(catalog);if(catalog.libraryId!==this.#catalog.libraryId)fail('不能 reconcile 另一 libraryId');this.#catalog={libraryId:catalog.libraryId,items};return true;}
}

export function safeArchivePath(path) {
  if(typeof path!=='string'||!path||/[\\:\x00-\x1f\x7f]/.test(path)||path.startsWith('/')||path.endsWith('/'))fail(`不安全的归档相对路径：${String(path)}`);
  for(const part of path.split('/'))if(!part||part==='.'||part==='..'||/[. ]$/.test(part)||/[<>"|?*]/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))fail(`不安全的归档路径段：${part}`);
  return path;
}

export function checkArchiveNames(paths) {
  const folded=new Map();
  for(const path of paths){safeArchivePath(path);const key=path.normalize('NFC').toLowerCase();if(folded.has(key))fail(`归档路径大小写或字符规范冲突：${path}`);folded.set(key,path);}
  for(const [key,path]of folded){const parts=key.split('/');for(let n=1;n<parts.length;n++)if(folded.has(parts.slice(0,n).join('/')))fail(`归档文件与目录冲突：${path}`);}
}

export function batchPlan(catalog,ids) {
  const items=itemIndex(catalog);text(catalog.revision,'revision');if(!record(catalog.assets))fail('catalog.assets 缺失');
  const selected=[...uniqueStrings([...ids],'选中 item IDs')];if(!selected.length)fail('请先选择资源');
  const outputItems=[],files=[],byId=new Map(),byPath=new Map(),spelling=new Map([['batch-manifest.json','BATCH-MANIFEST.json']]);let totalBytes=0;
  for(const id of selected){const item=items.get(id);if(!item)fail(`选中项已不存在：${id}`);text(item.name,'item.name');text(item.downloadFingerprint,'downloadFingerprint');
    if(item.dependencyErrors!==undefined&&(!Array.isArray(item.dependencyErrors)||item.dependencyErrors.length))fail(`资源依赖异常：${id}`);
    const dependencies=[...uniqueStrings(item.files,`${id}.files`)];if(!dependencies.length)fail(`资源没有完整原件 files：${id}`);
    const mapped=[];
    for(const assetId of dependencies){
      if(byId.has(assetId)){mapped.push(byId.get(assetId));continue;}
      const asset=own(catalog.assets,assetId)?catalog.assets[assetId]:null;
      if(!record(asset))fail(`缺少依赖 descriptor：${assetId}`);
      const path=safeArchivePath(asset.sourceRelative);text(asset.url,'asset.url');text(asset.name,'asset.name');
      if(!Number.isSafeInteger(asset.bytes)||asset.bytes<0||typeof asset.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(asset.sha256))fail(`依赖身份无效：${assetId}`);
      const fold=path.normalize('NFC').toLowerCase();if(spelling.has(fold)&&spelling.get(fold)!==path)fail(`归档路径大小写冲突：${path}`);
      if(fold==='batch-manifest.json')fail('原件路径与 BATCH-MANIFEST.json 冲突');spelling.set(fold,path);
      const existing=byPath.get(path);let canonical;
      if(existing){if(existing.sha256!==asset.sha256.toLowerCase()||existing.bytes!==asset.bytes)fail(`同路径依赖内容冲突：${path}`);canonical=existing.id;}
      else{const file={id:assetId,path,url:asset.url,bytes:asset.bytes,sha256:asset.sha256.toLowerCase(),name:asset.name};files.push(file);byPath.set(path,file);canonical=assetId;totalBytes+=asset.bytes;if(!Number.isSafeInteger(totalBytes))fail('原件总量超过安全整数范围');}
      byId.set(assetId,canonical);mapped.push(canonical);
    }
    outputItems.push({id,name:item.name,fingerprint:item.downloadFingerprint,files:[...new Set(mapped)]});
  }
  checkArchiveNames([...files.map(file=>file.path),'BATCH-MANIFEST.json']);
  return freeze({schema:'resource-batch.v1',libraryId:catalog.libraryId,revision:catalog.revision,items:outputItems,files,totalBytes,itemCount:outputItems.length,fileCount:files.length});
}
