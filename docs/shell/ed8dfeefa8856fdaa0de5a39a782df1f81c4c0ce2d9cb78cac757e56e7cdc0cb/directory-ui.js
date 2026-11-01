const $=id=>document.getElementById(id);
const element=(tag,classes='',text='')=>{const value=document.createElement(tag);value.className=classes;value.textContent=text;return value;};
const button=(label,action,classes='')=>{const value=element('button',classes,label);value.type='button';value.addEventListener('click',action);return value;};

// Browsing owns real directory packets; it does not construct persistent models.
export class DirectoryUI{
 constructor(loader,callbacks){
  this.loader=loader;this.callbacks=callbacks;this.view='semantic';this.group=loader.seed.roots.semantic;this.current=loader.groups.get(this.group);this.expanded=new Set([this.group,...this.current.children.map(v=>v.id)]);this.controller=new AbortController();this.expanding=new Map();this.hydrating=new Map();this.promotedTreeWork=false;this.install();this.renderNavigation();
 }
 install(){
  const sidebar=$('groupSidebar');sidebar.replaceChildren();const title=element('div','section-heading');title.append(element('span','','分组导航'),button('×',()=>{document.body.classList.remove('groups-open');this.callbacks.onLayout?.();},'close-groups'));sidebar.append(title);
  this.viewSelect=element('select','group-view');this.viewSelect.setAttribute('aria-label','分组视图');this.viewSelect.append(new Option('资源分组','semantic'),new Option('原目录','directory'),new Option('我的分组','collections'));this.viewSelect.addEventListener('change',()=>{if(this.viewSelect.value==='collections'){this.callbacks.onCollections();return;}this.callbacks.onNavigate(this.loader.seed.roots[this.viewSelect.value],this.viewSelect.value,true);});sidebar.append(this.viewSelect);
  this.tree=element('div','group-tree');this.tree.setAttribute('aria-label','分组树');sidebar.append(this.tree);sidebar.append(element('p','group-note','目录可直接浏览；预览随当前页面按需准备。'));
  this.openHandler=()=>{document.body.classList.toggle('groups-open');this.callbacks.onLayout?.();};$('openGroups').onclick=null;$('openGroups').addEventListener('click',this.openHandler);
 }
 setGroup(group,view,expandCurrent=true){
  this.current=group;this.group=group.id;this.view=view;this.viewSelect.value=view;
  for(const node of group.breadcrumbs.slice(0,-1))this.expanded.add(node.id);if(expandCurrent)this.expanded.add(group.id);this.renderNavigation();
  for(const node of group.breadcrumbs)if(!this.loader.groups.has(node.id))void this.hydrate(node.id);
 }
 directoryPriority(){if(document.hidden)return 3;return innerWidth>900||document.body.classList.contains('groups-open')?2:3;}
 async hydrate(id){
  if(this.controller.signal.aborted||this.loader.groups.has(id)||this.hydrating.has(id))return;
  const controller=new AbortController();this.hydrating.set(id,controller);
  const cancel=()=>controller.abort();this.controller.signal.addEventListener('abort',cancel,{once:true});
  try{await this.loader.group(id,controller.signal,()=>this.directoryPriority());if(!controller.signal.aborted&&!this.controller.signal.aborted)this.renderNavigation();}
  catch(error){if(error.name!=='AbortError')this.callbacks.onError(error);}
  finally{this.controller.signal.removeEventListener('abort',cancel);if(this.hydrating.get(id)===controller)this.hydrating.delete(id);}
 }
 retireExpansions(exceptId=null){
  // Pure automatic hydration is already bounded to one low-priority body.
  if(exceptId===null&&!this.expanding.size&&!this.promotedTreeWork)return;
  let changed=false;
  for(const pending of [this.expanding,this.hydrating])for(const [id,controller]of pending){
   if(id===exceptId)continue;
   pending.delete(id);controller.abort();
   if(!this.loader.groups.has(id)){this.expanded.delete(id);changed=true;}
  }
  this.promotedTreeWork=exceptId!==null&&(this.expanding.has(exceptId)||this.hydrating.has(exceptId));
  // Keep the current path discoverable, with fresh low-priority owners after
  // retiring any transfer that had been promoted by a superseded tree intent.
  if(exceptId===null)for(const node of this.current.breadcrumbs.slice(0,-1)){
   this.expanded.add(node.id);if(!this.loader.groups.has(node.id))void this.hydrate(node.id);
  }
  if(changed)this.renderNavigation();
 }
 async toggle(node){
  if(this.expanded.has(node.id)){this.expanded.delete(node.id);this.expanding.get(node.id)?.abort();this.expanding.delete(node.id);this.renderNavigation();return;}
  this.expanded.add(node.id);this.renderNavigation();
  if(this.loader.groups.has(node.id)){this.renderNavigation();return;}
  const controller=new AbortController();this.promotedTreeWork=true;this.expanding.set(node.id,controller);
  const cancel=()=>controller.abort();this.controller.signal.addEventListener('abort',cancel,{once:true});
  try{await this.loader.group(node.id,controller.signal,0);if(this.expanded.has(node.id)&&!this.controller.signal.aborted)this.renderNavigation();}
  catch(error){if(error.name!=='AbortError')this.callbacks.onError(error);}
  finally{this.controller.signal.removeEventListener('abort',cancel);if(this.expanding.get(node.id)===controller)this.expanding.delete(node.id);}
 }
 renderNavigation(){
  const root=this.loader.groups.get(this.loader.seed.roots[this.view]);if(!root)return;this.tree.replaceChildren();
  const draw=(summary,depth)=>{
   const node=this.loader.groups.get(summary.id)||summary,line=element('div','tree-line');line.dataset.groupId=node.id;line.setAttribute('role','treeitem');line.setAttribute('aria-level',String(depth+1));line.setAttribute('aria-selected',String(this.group===node.id));line.style.setProperty('--depth',depth);line.dataset.level=depth;line.dataset.game=node.game||'all';line.classList.toggle('tree-branch',node.childCount>0);line.classList.toggle('tree-leaf',!node.childCount);
   const palette=node.game==='MC'?['#92d99b','#9dcde6','#79b9b1','#bbd99a','#9bbbf0','#84d9c6']:node.game==='PVZ'?['#edc37d','#d4afe7','#f0b59b','#e1d58f','#bfb8f0','#e9b4c6']:['#e4ba6a','#8dc6f4','#b6a5ed','#7dd8bd','#f0b28f','#91cce6'];line.style.setProperty('--folder',palette[depth%palette.length]);
   const toggle=button(node.childCount?(this.expanded.has(node.id)?'▾':'▸'):'·',()=>void this.toggle(node),'tree-toggle');toggle.disabled=!node.childCount;toggle.setAttribute('aria-label',(this.expanded.has(node.id)?'折叠 ':'展开 ')+node.label);toggle.setAttribute('aria-expanded',String(this.expanded.has(node.id)));
   const label=button('',()=>{if(node.childCount)void this.toggle(node);if(this.group!==node.id)this.callbacks.onNavigate(node.id,this.view,true,false);},'tree-label');label.title=node.label;label.dataset.groupId=node.id;label.append(element('span','folder-icon'),document.createTextNode(node.label),element('span','tree-count',node.count.toLocaleString()));label.classList.toggle('active',this.group===node.id);const spacer=element('span','tree-select-spacer');spacer.setAttribute('aria-hidden','true');line.append(toggle,spacer,label);this.tree.append(line);
   if(node.childCount&&this.expanded.has(node.id)){
    if(node.children)for(const child of node.children)draw(child,depth+1);
    else this.tree.append(element('p','tree-loading','正在读取子分类…'));
   }
  };draw(root,0);
  const crumbs=$('breadcrumbs');crumbs.replaceChildren();this.current.breadcrumbs.forEach((node,i)=>{if(i)crumbs.append(element('span','crumb-divider','›'));crumbs.append(button(node.label,()=>this.callbacks.onNavigate(node.id,this.view,false),'crumb'));});crumbs.scrollLeft=crumbs.scrollWidth;
  const children=$('childGroups');children.replaceChildren();for(const child of this.current.children)children.append(button(child.label+'  '+child.count.toLocaleString(),()=>this.callbacks.onNavigate(child.id,this.view,true),'child-group'));
  children.hidden=!this.current.children.length||this.current.children.length>12;
  const parent=this.current.parentId;$('parentGroup').disabled=!parent;$('parentGroup').onclick=parent?()=>this.callbacks.onNavigate(parent,this.view,false):null;
  $('currentGroupCount').textContent=this.current.count.toLocaleString()+' 项';document.body.dataset.game=this.current.game||'all';this.callbacks.onLayout?.();
 }
 dispose(){this.controller.abort();for(const controller of this.expanding.values())controller.abort();$('openGroups').removeEventListener('click',this.openHandler);$('parentGroup').onclick=null;}
}
