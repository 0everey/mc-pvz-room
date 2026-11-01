import {imageElementsReady} from './engines/lifecycle.js';
import {createDefinitionPreview} from './definition-preview.js';
import {recipePreview} from './recipe-preview.js';
import {installToolMenus} from './tool-menus.js';
import {createAudioPlayer} from './audio-player.js';
import {BrowseLoader} from './browse-loader.js';
import {DirectoryUI} from './directory-ui.js';
import {resourceQueue,viewPriority} from './request-queue.js';
import {PreviewQueue} from './preview-queue.js';
import {createPreview,invalidatePreviews} from './preview-engines.js';
import {createImagePreview,invalidateImages} from './frame-player.js';

const $=id=>document.getElementById(id),normal=x=>String(x||'').normalize('NFKC').toLocaleLowerCase(),kindLabels={'featured':'精选入口','all':'全部类型','animated':'动作与动画','image':'图片与贴图','spine':'骨骼角色','mc-model':'我的世界模型','audio':'音效文件','sound-event':'声音事件','recipe':'合成与配方','definition':'定义与资料'};
const toolMenus=installToolMenus();
const caption=row=>row.displayName||row.name;
let workspaceUI=null,retainedWorkspace=null,browseLoader=null,directoryUI=null,workspacePromise=null,catalog=null,catalogEpoch=0,catalogError=null;
let seedRequest=0,desiredRoute=null,pendingPrivateRestore=null,filterEpoch=0,routeEpoch=0,routeAbort=new AbortController(),navigationPending=false,currentView='semantic',activeGroup=null;
let headerAbort=new AbortController(),firstVisibleReady=false,identityAutoRequested=false,searchState=null,filteredIndices=[],paintedIndices=[],gridQueue=null,renderVersion=0,earlyExportTicket=0,earlyExportController=null;
let detailTrigger=null,pageSize=12,selected=null,selectedAsset=null,detailController=null,gridGeneration=0,detailGeneration=0,gridAbort=new AbortController(),detailAbort=new AbortController(),gridControllers=new Map(),detailDownload=null,lastQueryTimer=null;
const state={game:'all',kind:'all',source:'',query:'',density:'medium',page:0,playing:true,light:false};
const url=id=>{const asset=catalog.assets[id];if(!asset)throw Error('资源不在当前目录中。');return new URL(asset.url,document.baseURI).href;};
const sourceName=key=>catalog.sources.find(x=>x.key===key)?.displayLabel||catalog.sources.find(x=>x.key===key)?.label||key;
const size=value=>value>=1048576?(value/1048576).toFixed(1)+' MiB':value>=1024?(value/1024).toFixed(1)+' KiB':value+' B';
const noController=()=>({duration:0,time:0,playing:false,animations:[],skins:[],play:()=>false,pause:()=>true,seek:()=>false,setSpeed:()=>false,dispose:()=>true});
function hint(message){$('loadStatus').textContent=message;}
function matchesKind(row,kind){if(kind==='all')return true;if(kind==='featured')return row.featured;if(kind==='animated')return row.kind==='spine'||row.kind==='gif'||(row.preview?.frames.length>1);if(kind==='image')return ['image','texture'].includes(row.kind);return row.kind===kind;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,2200);}
function cleanupGrid(){headerAbort.abort();headerAbort=new AbortController();gridAbort.abort();for(const controller of gridControllers.values())controller.dispose();gridControllers.clear();gridAbort=new AbortController();gridGeneration++;gridQueue=null;paintedIndices=[];}
function context(signal,detail,onStatus,host){return{url,...browseLoader.context(),signal,autoPlay:detail?true:state.playing,detail,onStatus,priority:()=>viewPriority(host,detail)};}
const previewAttempts=new WeakMap();
function pageReadiness(){
 const bounds=$('gridWrap').getBoundingClientRect(),hosts=[...document.querySelectorAll('#grid .preview')].filter(host=>{const r=host.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom&&r.right>bounds.left&&r.left<bounds.right;}),total=hosts.length;
 if(navigationPending){hint('正在打开当前分类…');return;}
 if(!total){hint(searchState&&!searchState.complete?'正在查找当前目标…':filteredIndices.length?'正在读取当前页资料…':'当前范围没有匹配资源');return;}
 const pending=hosts.filter(h=>!['ready','empty','unsupported','error'].includes(h.dataset.phase)).length,failed=hosts.filter(h=>h.dataset.phase==='error').length,limited=hosts.filter(h=>['empty','unsupported'].includes(h.dataset.phase)).length;
 hint((pending?`准备当前可见预览 ${total-pending}/${total}`:failed?`${failed} 项未就绪 · 可单独重试`:limited?`可见预览已就绪 · ${limited} 项有说明`:'当前可见预览已就绪')+(searchState&&!searchState.complete?' · 继续查找中':''));
}
async function mount(host,row,parentSignal,detail=false,retry=null){
 previewAttempts.get(host)?.abort();
 const attempt=new AbortController(),signal=attempt.signal;
 let controller=null;
 const cancel=()=>attempt.abort(),live=()=>!signal.aborted&&previewAttempts.get(host)===attempt;
 previewAttempts.set(host,attempt);parentSignal.addEventListener('abort',cancel,{once:true});
 signal.addEventListener('abort',()=>{parentSignal.removeEventListener('abort',cancel);controller?.dispose();if(previewAttempts.get(host)===attempt)previewAttempts.delete(host);},{once:true});
 if(parentSignal.aborted){cancel();return noController();}
 host.replaceChildren();host.dataset.phase='loading';host.classList.toggle('light',state.light);
 const status=document.createElement('span');status.className='preview-status';status.textContent='准备预览…';host.append(status);
 const report=({phase,message})=>{
  if(!live())return;host.dataset.phase=phase;host.classList.toggle('preview-failed',phase==='error');
  if(phase==='ready')status.remove();
  else {if(!status.isConnected)host.append(status);const messageNode=document.createElement('span');messageNode.className='preview-message';messageNode.textContent=message||'准备预览…';messageNode.title=message||'';status.replaceChildren(messageNode);
   if(phase==='error'&&retry){const button=document.createElement('button');button.type='button';button.className='preview-retry';button.textContent=detail?'重试此项':'重试';button.addEventListener('click',event=>{event.stopPropagation();if(live())retry();});status.append(button);}
  }
  if(detail)$('detailStatus').textContent=message||'';else{if(phase==='ready'&&!firstVisibleReady){const a=host.getBoundingClientRect(),b=$('gridWrap').getBoundingClientRect();if(a.bottom>b.top&&a.top<b.bottom&&a.right>b.left&&a.left<b.right){firstVisibleReady=true;scheduleIdentity();}}pageReadiness();}
 };
 report({phase:'loading',message:'准备预览…'});
 try{
  await browseLoader.detail([row.index],signal,()=>viewPriority(host,detail));if(!live())return noController();
  if(row.kind==='mc-model'||row.kind==='spine')controller=await createPreview(host,row,context(signal,detail,report,host));
  else if(['texture','image','gif'].includes(row.kind))controller=await createImagePreview(host,row,context(signal,detail,report,host));
  else if(row.kind==='audio'||row.kind==='sound-event'){
   const asset=row.kind==='sound-event'?row.event.files[0]:row.asset;
   if(!asset){controller=noController();report({phase:'empty',message:'空事件 · 无音频变体'});}
   else {controller=createAudioPlayer(host,{src:url(asset),label:caption(row),signal,preload:detail?'metadata':'none'});report({phase:'ready',message:'可点击试听'});}
  }else if(row.kind==='recipe'){
   const recipe=recipePreview(row,context(signal,detail,report,host));host.append(recipe);await imageElementsReady(recipe,signal,()=>viewPriority(host,detail));
   controller=noController();report({phase:'ready',message:row.recipe.dynamic?'动态规则与原定义保留可查':''});
  }else if(row.kind==='definition')controller=await createDefinitionPreview(host,row,context(signal,detail,report,host));
  else{const glyph=document.createElement('span');glyph.className='file-glyph';glyph.textContent=row.relativePath.endsWith('.json')?'{ }':'≡';host.append(glyph);controller=noController();report({phase:'ready',message:'源文件可取用'});}
  if(!live()){controller?.dispose();return noController();}
 }catch(error){if(error.name!=='AbortError'&&live()){report({phase:'error',message:error.message||'此项暂不可预览。'});if(error.reloadBootstrap)showCatalogError(error,'seed');}}
 const wrapped=Object.create(controller||noController());wrapped.dispose=()=>{cancel();return true;};return wrapped;
}
// Stable round-robin of the existing featured members; catalog identity stays intact.
function mixedFeatured(rows){
 const kinds=['spine','mc-model','recipe','texture','gif'],groups=kinds.map(kind=>rows.filter(row=>row.kind===kind)),known=new Set(kinds),result=[],seen=new Set();
 while(groups.some(group=>group.length))for(const group of groups){if(!group.length)continue;const fresh=group.findIndex(row=>!seen.has(row.character||row.name)),row=group.splice(fresh<0?0:fresh,1)[0];result.push(row);seen.add(row.character||row.name);}
 return result.concat(rows.filter(row=>!known.has(row.kind)));
}
function rebuildNavigation(){if(workspaceUI)workspaceUI.renderNavigation();else directoryUI?.renderNavigation();$('typeFilter').value=state.kind;}
function gridMetrics(bounds){
 const profiles={small:{minWidth:124,minHeight:104,maxHeight:120,gap:6},medium:{minWidth:148,minHeight:124,maxHeight:180,gap:8},large:{minWidth:220,minHeight:236,maxHeight:300,gap:16}};
 const profile=profiles[state.density]||profiles.medium,compact=state.density!=='large',width=Math.max(1,bounds.width),height=Math.max(1,bounds.height);
 const minWidth=width<375&&compact?Math.min(136,profile.minWidth):profile.minWidth;
 const columns=Math.max(1,Math.floor((width+profile.gap)/(minWidth+profile.gap)));
 const rows=Math.max(1,Math.floor((Math.max(profile.minHeight,height)+profile.gap)/(profile.minHeight+profile.gap)));
 const cardHeight=Math.min(profile.maxHeight,Math.max(profile.minHeight,(height-profile.gap*(rows-1))/rows));
 return {compact,columns,rows,cardHeight,gap:profile.gap};
}
function captureGridPlayback(){return new Map([...gridControllers].map(([host,controller])=>{const id=host.closest('.resource-card')?.dataset.id;return id&&controller.mediaKind==='audio'?[id,{time:Number(controller.time)||0,playing:Boolean(controller.playing)}]:null}).filter(Boolean));}
function resizeGrid(){const metrics=gridMetrics($('gridWrap').getBoundingClientRect()),newSize=metrics.columns*metrics.rows;$('grid').style.gap=metrics.gap+'px';$('grid').style.gridTemplateColumns=`repeat(${metrics.columns},minmax(0,1fr))`;$('grid').style.gridTemplateRows=`repeat(${metrics.rows},${metrics.cardHeight}px)`;document.body.classList.toggle('workspace-ui-compact',metrics.compact);document.body.classList.toggle('density-small',state.density==='small');document.body.classList.toggle('density-large',state.density==='large');$('density').value=state.density;if($('densityValue'))$('densityValue').textContent=state.density==='small'?'小 · 手机多看':state.density==='large'?'大 · 细看主体':'中 · 平衡阅读';if(pageSize!==newSize){const playback=captureGridPlayback(),focus=selected?filteredIndices.indexOf(selected.index):-1,anchor=focus>=0?focus:state.page*pageSize;pageSize=newSize;state.page=Math.floor(Math.max(0,anchor)/pageSize);if(catalog)render(playback);}}

function currentScope(){
 if(workspaceUI){const ids=workspaceUI.onlySelected?[...workspaceUI.selection.ids]:[...workspaceUI.members()],indices=ids.filter(id=>browseLoader.byId.has(id)).map(id=>browseLoader.byId.get(id)).sort((a,b)=>a-b);return{view:workspaceUI.view,group:workspaceUI.group,onlySelected:workspaceUI.onlySelected,indices};}
 return{view:currentView,group:activeGroup?.id,onlySelected:false,indices:activeGroup?browseLoader.memberIndices(activeGroup):[]};
}
function stopSearch(){searchState?.controller.abort();searchState=null;}
function render(playback=new Map()){
 if(!browseLoader||!activeGroup||navigationPending)return;
 const scope=currentScope(),query=normal(state.query).trim(),key=JSON.stringify([catalogEpoch,scope.view,scope.group,scope.onlySelected,state.kind,query,state.game,state.source,scope.onlySelected||scope.view==='collections'?scope.indices:'']);
 if(searchState?.key===key&&(searchState.complete||!searchState.controller.signal.aborted)){paintPage(playback);return;}
 stopSearch();cleanupGrid();$('grid').replaceChildren();filteredIndices=[];
 const controller=new AbortController(),search={key,controller,indices:[],complete:!query,intent:filterEpoch};searchState=search;
 const candidates=browseLoader.filter(scope.indices,state),overview=!query&&state.kind==='all'&&!scope.onlySelected&&scope.view==='semantic'&&scope.group===browseLoader.seed.roots.semantic;
 if(!query){search.indices=browseLoader.order(candidates,state.kind==='featured',overview);filteredIndices=search.indices;paintPage(playback);if(!filteredIndices.length)scheduleIdentity();return;}
 let supplied=false;
 const accept=(indices,complete)=>{if(searchState!==search||search.intent!==filterEpoch||controller.signal.aborted)return;search.indices=indices;search.complete=complete;filteredIndices=indices;paintPage(supplied?new Map():playback);supplied=true;if(complete&&!indices.length)scheduleIdentity();};
 browseLoader.search(query,candidates,controller.signal,accept,()=>document.hidden||document.querySelector('dialog[open]')||search.indices.length>=pageSize?3:0).then(indices=>accept(indices,true)).catch(error=>{if(searchState===search&&error.name!=='AbortError')showCatalogError(error,'search');});finishRender();
}
function paintPage(playback=new Map()){
 if(!browseLoader||navigationPending)return;
 const total=filteredIndices.length,pages=Math.max(1,Math.ceil(total/pageSize));state.page=Math.max(0,Math.min(state.page,pages-1));const start=state.page*pageSize,indices=filteredIndices.slice(start,start+pageSize);
 const extendsCurrent=paintedIndices.length<=indices.length&&paintedIndices.every((v,i)=>v===indices[i])&&gridQueue&&!gridAbort.signal.aborted;
 if(!extendsCurrent){cleanupGrid();$('grid').replaceChildren();gridQueue=new PreviewQueue($('gridWrap'),gridAbort.signal,(host,error)=>{host.dataset.phase='error';host.textContent='预览未能载入：'+error.message;pageReadiness();});}
 const signal=gridAbort.signal,ticket=gridGeneration,queue=gridQueue;
 for(const index of indices.slice(paintedIndices.length)){
  const placeholder=document.createElement('article');placeholder.className='resource-card pending-card';placeholder.dataset.index=index;const status=document.createElement('span');status.className='preview-status';status.textContent='读取当前页资料…';placeholder.append(status);$('grid').append(placeholder);
  const fill=()=>{browseLoader.header(index,headerAbort.signal,()=>{const rank=viewPriority(placeholder,false);return rank<2?1:rank;}).then(row=>{if(signal.aborted||ticket!==gridGeneration||!placeholder.isConnected)return;const card=makeCard(row,ticket,signal,playback,queue);placeholder.replaceWith(card);pageReadiness();}).catch(error=>{if(signal.aborted||ticket!==gridGeneration||error.name==='AbortError')return;placeholder.replaceChildren();const text=document.createElement('p');text.textContent='当前资源资料暂未就绪';const retry=document.createElement('button');retry.textContent='重试';retry.addEventListener('click',fill);placeholder.append(text,retry);placeholder.title=error.message;pageReadiness();});};fill();
 }
 paintedIndices=indices;
 if(workspaceUI)for(const card of $('grid').querySelectorAll('.resource-card[data-id]'))if(!card.querySelector('.card-select'))workspaceUI.bindCard(card,browseLoader.rows.get(Number(card.dataset.index)));
 syncViewPriority();finishRender();
}
function makeCard(row,ticket,signal,playback,queue){
 const card=document.createElement('article');card.className='resource-card';card.dataset.game=row.game;card.dataset.id=row.id;card.dataset.index=row.index;card.dataset.kind=row.kind;card.tabIndex=0;const isAudio=['audio','sound-event'].includes(row.kind);let player=null;
 card.setAttribute('aria-label',(isAudio?'试听 ':'预览 ')+caption(row)+' · '+sourceName(row.source));card.classList.toggle('selected',row.id===selected?.id);
 const preview=document.createElement('div');preview.className='preview card-preview';const body=document.createElement('div');body.className='card-body';const line=document.createElement('div');line.className='card-line';const game=document.createElement('span');game.textContent=row.game==='MC'?'我的世界':'植物大战僵尸';const edition=document.createElement('span');edition.className='edition';edition.textContent='· '+(row.source==='replanted'?'重植版':row.category);line.append(game,edition);
 const name=document.createElement('div');name.className='card-name';name.textContent=caption(row);name.title=caption(row);const path=document.createElement('div');path.className='card-path';path.textContent=row.relativePath;path.title=row.relativePath;
 const detail=document.createElement('button');detail.type='button';detail.className='card-detail';detail.textContent='详情';detail.setAttribute('aria-label','查看详情 '+caption(row));detail.addEventListener('click',event=>{event.stopPropagation();if(isAudio)player?.pause();detailTrigger=detail;void openDetail(row);});
 const description=document.createElement('div');description.className='card-description';description.append(line,name,path);body.append(description,detail);card.append(preview,body);
 const activate=()=>{if(isAudio){if(player?.toggle)void player.toggle();else{queue.prioritize?.(preview);hint('正在优先准备此项音效，可打开详情。');}}else{detailTrigger=card;void openDetail(row);}};
 card.addEventListener('click',event=>{if(event.target.closest('button,input,label,select,audio,a'))return;activate();});card.addEventListener('keydown',event=>{if(event.target!==card)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
 workspaceUI?.bindCard(card,row);preview.dataset.phase='queued';const queued=document.createElement('span');queued.className='preview-status';queued.textContent='等待准备当前预览';preview.append(queued);let loadGeneration=0;
 const loadPreview=loadSignal=>{const loadTicket=++loadGeneration;gridControllers.get(preview)?.dispose();gridControllers.delete(preview);return mount(preview,row,loadSignal,false,()=>queue.retry(preview)).then(controller=>{if(loadTicket!==loadGeneration||ticket!==gridGeneration||signal.aborted||loadSignal.aborted){controller.dispose();return;}player=controller;delete preview.dataset.urgent;gridControllers.set(preview,controller);const resume=playback.get(row.id);playback.delete(row.id);if(resume&&controller.mediaKind==='audio'){if(resume.time>0)controller.seek?.(resume.time);if(resume.playing)void controller.play();else controller.pause();}else if(!isAudio)state.playing?controller.play():controller.pause();});};
 queueMicrotask(()=>{if(card.isConnected&&!signal.aborted)queue.add(preview,loadPreview,['mc-model','spine'].includes(row.kind)?row.kind:false);});return card;
}
function finishRender(){
 const count=filteredIndices.length,pages=Math.max(1,Math.ceil(count/pageSize)),start=state.page*pageSize,complete=Boolean(searchState?.complete);
 $('empty').hidden=count!==0||!complete||navigationPending;$('empty').querySelector('h2').textContent='没有找到匹配资源';$('empty').querySelector('p').textContent='试试更短的词，或重置筛选条件。';
 if(workspaceUI){const result=filteredIndices.map(i=>catalog.items[i]),visible=filteredIndices.slice(start,start+pageSize).map(i=>catalog.items[i]);workspaceUI.resultsComplete=complete;workspaceUI.updateScope(result,visible);}
 const missing=workspaceUI&&!workspaceUI.onlySelected?[...workspaceUI.members()].filter(id=>!workspaceUI.rows.has(id)).length:0;
 $('resultCount').textContent=(complete?'':'查找中 · 已找到 ')+count.toLocaleString()+' 项'+(missing?' · '+missing+' 缺失':'');$('viewHint').textContent=(kindLabels[state.kind]||state.kind)+' · 当前范围';$('pageInfo').textContent=(state.page+1)+' / '+(complete?pages:'…');$('pageRange').textContent=count?`${start+1}—${Math.min(start+pageSize,count)} / ${complete?count.toLocaleString():'查找中'}`:complete?'0 项':'查找中';$('previous').disabled=state.page===0;$('next').disabled=state.page===pages-1;
 rangeActions();pageReadiness();
}
function reset(){filterEpoch++;clearTimeout(lastQueryTimer);state.game='all';state.kind='all';state.source='';state.query='';state.page=0;$('query').value='';if(workspaceUI){workspaceUI.resetGroup();stopSearch();rebuildNavigation();render();}else void navigateGroup(browseLoader.seed.roots[currentView],currentView,false,true);}
function changeAsset(asset){selectedAsset=asset;const item=catalog.assets[asset];$('sourcePath').value=item.sourceRelative;$('download').textContent='↓ '+(selected.kind==='sound-event'?(selected.event.files.includes(asset)?'下载音效':'下载源定义'):'下载原件');$('download').disabled=false;}
function renderSkinGroups(controller){
 const groups=controller.skinGroups||[];$('skinGroups').replaceChildren();$('skinGroups').hidden=!groups.length;$('detail').classList.toggle('has-skin-groups',Boolean(groups.length));
 for(const group of groups){const label=document.createElement('label'),caption=document.createElement('span'),select=document.createElement('select');caption.textContent=group.name;select.setAttribute('aria-label',group.name);for(const option of group.options)select.append(new Option(option.name,option.value));select.value=group.selected;select.addEventListener('change',()=>{if(controller!==detailController)return;if(controller.setSkinGroup(group.id,select.value)===false){$('actionStatus').textContent='该部件状态不可用。';return;}for(const current of controller.skinGroups||[]){const control=$('skinGroups').querySelector('[data-group='+CSS.escape(current.id)+']');if(control)control.value=current.selected;}});select.dataset.group=group.id;label.append(caption,select);$('skinGroups').append(label);}
 if(groups.length)$('skin').hidden=true;
}
async function openDetail(row){toolMenus.closeAll();detailGeneration++;const ticket=detailGeneration;detailAbort.abort();detailDownload?.abort();detailController?.dispose();detailController=null;detailAbort=new AbortController();const signal=detailAbort.signal;selected=row;selectedAsset=null;$('detail').dataset.game=row.game;document.body.classList.add('detail-open','has-detail');document.querySelector('.workspace').inert=true;document.querySelector('.topbar').inert=true;$('detailBackdrop').hidden=false;if(!$('detail').open)$('detail').show();if('CloseWatcher' in window){const watcher=new CloseWatcher({signal});watcher.addEventListener('close',closeDetail,{once:true});}$('closeDetail').focus();$('viewButtons').hidden=$('resetView').hidden=!['mc-model','spine'].includes(row.kind);$('zoomIn').disabled=$('zoomOut').disabled=$('resetView').disabled=true;$('viewGesture').textContent=row.kind==='mc-model'?'拖动旋转 · 按钮／滚轮缩放':row.kind==='spine'?'拖动 · 按钮／滚轮缩放':'';$('detail').classList.add('open');$('detailEmpty').hidden=true;$('detailBody').hidden=false;$('detailName').textContent=caption(row);$('detailBadge').textContent=(row.game==='MC'?'我的世界':'植物大战僵尸')+' · '+sourceName(row.source);$('detailBadge').className='badge'+(row.game==='MC'?' mc':'');$('detailPreview').replaceChildren();$('skinGroups').replaceChildren();$('skinGroups').hidden=true;$('detail').classList.remove('has-skin-groups');$('detailStatus').textContent='';$('actionStatus').textContent='';$('specialDetails').replaceChildren();$('animationControls').hidden=true;$('animation').hidden=true;$('skin').hidden=true;$('speed').value='1';$('definitionDetails').hidden=true;$('definitionDetails').open=false;$('definition').textContent='';$('copyFull').disabled=catalog.mode!=='local';$('copyFull').title=catalog.mode==='local'?'复制此文件的完整本地路径':'静态副本保留原库相对路径';$('downloadBundle').hidden=row.kind!=='spine';$('downloadBundle').disabled=true;$('download').disabled=true;$('copyRelative').disabled=true;$('copyFull').disabled=true;$('fileSelectLabel').hidden=true;$('resourceMeta').replaceChildren();$('sourcePath').value='';$('detailPreview').dataset.phase='loading';$('detailStatus').textContent='读取当前资源资料…';const preparation=browseLoader.detail([row.index],signal,0);syncViewPriority();
 try{await preparation;}catch(error){if(ticket===detailGeneration&&!signal.aborted){$('detailStatus').textContent='当前资源资料读取失败，可重试。';$('actionStatus').textContent=error.message;const retry=document.createElement('button');retry.textContent='重试当前资源';retry.addEventListener('click',()=>void openDetail(row));$('specialDetails').append(retry);}return;}
 if(ticket!==detailGeneration||signal.aborted)return;$('copyRelative').disabled=false;$('copyFull').disabled=catalog.mode!=='local';$('downloadBundle').disabled=false;$('detailStatus').textContent='';const files=row.kind==='spine'?row.files:row.kind==='sound-event'&&row.event.files.length?row.event.files:[row.asset];$('fileSelect').replaceChildren();for(const asset of files)$('fileSelect').append(new Option(catalog.assets[asset].name,asset));$('fileSelectLabel').hidden=files.length<=1;changeAsset(files[0]);const meta=[row.category,size(row.bytes)];if(row.width)meta.push(row.width+' × '+row.height);if(row.preview?.frames.length>1)meta.push(row.preview.frames.length+' 帧');if(row.spine)meta.push('Spine 4.2');$('resourceMeta').replaceChildren(...meta.map(label=>{const span=document.createElement('span');span.textContent=label;return span;}));for(const card of document.querySelectorAll('.resource-card'))card.classList.toggle('selected',card.dataset.id===row.id);
 if(row.kind==='sound-event'){const label=document.createElement('p');label.className='recipe-info';label.textContent=row.event.files.length+' 个文件变体 · 原事件权重、音量与音调见源定义';$('specialDetails').append(label);$('definitionDetails').hidden=false;$('definition').textContent=JSON.stringify(row.event.definition,null,2);}
 if(['definition','mc-model','recipe'].includes(row.kind)){const source=row.kind==='recipe'?Promise.resolve(JSON.stringify(row.recipe.raw,null,2)):fetch(url(row.asset),{signal}).then(r=>{if(!r.ok)throw Error('源定义读取失败');return r.text();});source.then(text=>{if(ticket===detailGeneration&&!signal.aborted){$('definitionDetails').hidden=false;$('definition').textContent=text.slice(0,200000);if(row.kind==='definition')$('definitionDetails').open=true;}}).catch(error=>{if(error.name!=='AbortError'&&ticket===detailGeneration)$('actionStatus').textContent=error.message;});}
 invalidatePreviews();invalidateImages();const controller=await mount($('detailPreview'),row,signal,true,()=>void openDetail(row));if(ticket!==detailGeneration||signal.aborted){controller.dispose();return;}detailController=controller;$('zoomIn').disabled=$('zoomOut').disabled=$('resetView').disabled=!controller.canZoom;const animate=controller.duration>0||controller.animations?.length;$('animationControls').hidden=!animate;if(animate){$('timeline').max=String(controller.duration||1);$('timeline').value='0';$('detailPlay').textContent=controller.playing?'Ⅱ':'▶';}if(controller.animations?.length){$('animation').hidden=false;$('animation').replaceChildren(...controller.animations.map(a=>new Option(a.name,a.name)));$('animation').value=controller.animation||controller.animations[0].name;}if(controller.skins?.length){$('skin').hidden=false;$('skin').replaceChildren(...controller.skins.map(name=>new Option(name,name)));$('skin').value=controller.skin||controller.skins[0];}renderSkinGroups(controller);}
function closeDetail(){detailGeneration++;detailAbort.abort();detailDownload?.abort();detailController?.dispose();detailController=null;selected=null;selectedAsset=null;document.body.classList.remove('detail-open','has-detail');if($('detail').open)$('detail').close();document.querySelector('.workspace').inert=false;document.querySelector('.topbar').inert=false;$('detailBackdrop').hidden=true;$('detail').classList.remove('open');invalidatePreviews();invalidateImages();$('detailBody').hidden=true;$('detailEmpty').hidden=false;$('detailPreview').replaceChildren();for(const card of document.querySelectorAll('.selected'))card.classList.remove('selected');if(detailTrigger?.isConnected)detailTrigger.focus({preventScroll:true});syncViewPriority();}
function saveBlob(blob,name){const object=URL.createObjectURL(blob),link=document.createElement('a');link.href=object;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(object),30000);}
async function verifiedBytes(asset,signal){const descriptor=catalog.assets[asset];let bytes;try{bytes=await resourceQueue.bytes(url(asset),{signal,priority:0,cache:false});}catch(error){if(error.status===409)throw Error('原件变化，请重扫目录后重试。');throw error;}if(bytes.byteLength!==descriptor.bytes)throw Error('原件大小不匹配，请重扫资源。');const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==descriptor.sha256)throw Error('原件内容已变化，请重扫资源。');return new Uint8Array(bytes);}
async function download(bundle=false){if(!selected||!selectedAsset)return;const row=selected,ticket=detailGeneration;detailDownload?.abort();detailDownload=new AbortController();const signal=detailDownload.signal;$('download').disabled=true;$('downloadBundle').disabled=true;$('actionStatus').textContent=bundle?'读取并校验整套依赖…':'读取并校验原件…';try{if(bundle){const entries=[];for(const asset of row.files){const bytes=await verifiedBytes(asset,signal);entries.push({name:catalog.assets[asset].sourceRelative,bytes});}entries.push({name:'SOURCE.json',bytes:new TextEncoder().encode(JSON.stringify({name:caption(row),files:row.files.map(id=>catalog.assets[id])},null,2))});if(ticket!==detailGeneration||signal.aborted)return;const {makeZip}=await import('./zip-store.js');if(ticket!==detailGeneration||signal.aborted)return;saveBlob(makeZip(entries),caption(row)+'-原件.zip');}else{const asset=selectedAsset,bytes=await verifiedBytes(asset,signal);if(ticket!==detailGeneration||signal.aborted)return;saveBlob(new Blob([bytes]),catalog.assets[asset].name);}$('actionStatus').textContent='SHA-256 校验通过，已开始保存。';}catch(error){if(error.name!=='AbortError'&&ticket===detailGeneration)$('actionStatus').textContent=error.message;}finally{if(ticket===detailGeneration){$('download').disabled=false;$('downloadBundle').disabled=false;}}}
async function copy(full=false){if(!selectedAsset)return;const ticket=detailGeneration;let text=catalog.assets[selectedAsset].sourceRelative;try{if(full){const response=await fetch('api/path/'+selectedAsset);const data=await response.json();if(!response.ok)throw Error(data.error);text=data.path;}if(ticket!==detailGeneration)return;try{await navigator.clipboard.writeText(text);$('actionStatus').textContent=full?'本机路径已复制。':'相对路径已复制。';}catch{$('sourcePath').value=text;$('sourcePath').focus();$('sourcePath').select();$('actionStatus').textContent='路径已选中，请复制。';}}catch(error){if(ticket===detailGeneration)$('actionStatus').textContent=error.message;}}
function rangeActions(){const ready=Boolean(browseLoader&&activeGroup&&!navigationPending),complete=Boolean(searchState?.complete);$('openExport').disabled=!ready;$('selectGroup').disabled=!ready;$('selectPage').disabled=!ready||!complete;$('selectResults').disabled=!ready||!complete;}
function syncViewPriority(){rangeActions();const covered=navigationPending||Boolean(document.querySelector('dialog[open]'))||(innerWidth<=900&&document.body.classList.contains('groups-open'));if(covered)gridQueue?.pause();else gridQueue?.resume();resourceQueue.refresh();invalidatePreviews();invalidateImages();}
function showCatalogError(error,scope='identity'){if(error.name==='AbortError')return;catalogError={error,scope};$('retryCatalog').hidden=false;$('retryCatalog').title=error.message;hint(scope==='identity'?'目录仍可用 · 选择记录准备失败，可重试':error.message);}
function scheduleIdentity(){if(identityAutoRequested||!browseLoader)return;identityAutoRequested=true;const epoch=catalogEpoch,begin=()=>{if(epoch===catalogEpoch)void ensureWorkspace(3).catch(error=>showCatalogError(error,'identity'));};if(globalThis.scheduler?.postTask)void scheduler.postTask(begin,{priority:'background'});else setTimeout(begin,0);}
function workspaceCallbacks(){return{
 getFilter:()=>({kind:state.kind,query:state.query,label:kindLabels[state.kind]||state.kind}),
 ensureItems:(ids,signal,priority=2)=>browseLoader.ensureItems(ids,signal,priority),hasDetails:ids=>ids.every(id=>browseLoader.details.has(browseLoader.byId.get(id))),
 onModal:()=>{toolMenus.closeAll();if($('detail').open)closeDetail();queueMicrotask(syncViewPriority);},
 onNavigate:clear=>{filterEpoch++;routeEpoch++;routeAbort.abort();clearTimeout(lastQueryTimer);navigationPending=false;desiredRoute=workspaceUI&&['semantic','directory'].includes(workspaceUI.view)?{id:workspaceUI.group,view:workspaceUI.view}:null;state.kind='all';$('typeFilter').value='all';state.page=0;if(clear){state.query='';$('query').value='';}stopSearch();render();},onLayout:syncViewPriority
};}
function ensureWorkspace(priority=0,signal){
 if(signal?.aborted)return Promise.reject(new DOMException('准备已取消','AbortError'));if(workspaceUI)return Promise.resolve(workspaceUI);if(!browseLoader)return Promise.reject(Error('目录尚未准备好'));const provider=browseLoader,epoch=catalogEpoch,demand=provider.identity(priority,signal);if(workspacePromise){const build=workspacePromise;return demand.then(()=>build);}
 workspacePromise=(async()=>{
  const next=await provider.identity(3);const {WorkspaceUI}=await import('./workspace-ui.js');if(epoch!==catalogEpoch||provider!==browseLoader)throw new DOMException('目录已替换','AbortError');
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));if(epoch!==catalogEpoch)throw new DOMException('目录已替换','AbortError');
  const restore=pendingPrivateRestore?.libraryId===next.libraryId?pendingPrivateRestore:null,expanded=new Set([...(retainedWorkspace?.catalog?.libraryId===next.libraryId?retainedWorkspace.expanded:[]),...(directoryUI?.expanded||[])]),view=restore?.view||currentView,group=restore?restore.group:activeGroup?.id;directoryUI?.dispose();directoryUI=null;
  const current=retainedWorkspace;if(current){current.callbacks=workspaceCallbacks();current.replaceCatalog(next);current.install();workspaceUI=current;}else workspaceUI=new WorkspaceUI(next,workspaceCallbacks());retainedWorkspace=workspaceUI;
  workspaceUI.view=view;workspaceUI.viewSelect.value=view;workspaceUI.group=group||next.hierarchy.roots[view];workspaceUI.onlySelected=Boolean(restore?.onlySelected);pendingPrivateRestore=null;if(restore)navigationPending=false;for(const id of expanded)workspaceUI.expanded.add(id);workspaceUI.seedExpansion();workspaceUI.renderNavigation();document.body.dataset.catalogStage='complete';$('retryCatalog').hidden=true;catalogError=null;render();return workspaceUI;
 })().catch(error=>{workspacePromise=null;if(epoch===catalogEpoch){provider.resetIdentity();if(!directoryUI&&!workspaceUI){directoryUI=new DirectoryUI(provider,directoryCallbacks());if(activeGroup)directoryUI.setGroup(activeGroup,currentView);}}throw error;});const build=workspacePromise;build.catch(()=>{});return demand.then(()=>build);
}
function directoryCallbacks(){return{onNavigate:(id,view,clear,expand=true)=>void navigateGroup(id,view,clear,false,expand),onCollections:()=>{const epoch=++filterEpoch;routeEpoch++;routeAbort.abort();stopSearch();pendingPrivateRestore={libraryId:catalog.libraryId,view:'collections',group:null,onlySelected:false};navigationPending=true;hint('目录可用 · 正在恢复我的分组…');syncViewPriority();void ensureWorkspace(()=>pendingPrivateRestore?0:3).then(ui=>{if(epoch===filterEpoch)ui.switchView('collections');}).catch(error=>showCatalogError(error,'identity'));},onLayout:syncViewPriority,onError:error=>showCatalogError(error,'route')};}
async function navigateGroup(id,view='semantic',clear=true,preserveKind=false,expandCurrent=true){
 pendingPrivateRestore=null;desiredRoute={id,view};const ticket=++routeEpoch,epoch=catalogEpoch;filterEpoch++;clearTimeout(lastQueryTimer);routeAbort.abort();routeAbort=new AbortController();stopSearch();gridQueue?.pause();state.page=0;
 if(!preserveKind)state.kind='all';if(clear){state.query='';$('query').value='';}navigationPending=true;headerAbort.abort();for(const id of ['openExport','selectPage','selectGroup','selectResults'])$(id).disabled=true;pageReadiness();
 try{
  let group;try{group=await browseLoader.group(id,routeAbort.signal,0);}catch(error){if(error.status!==404)throw error;toast('分类链接已失效，已返回资源目录。');group=await browseLoader.group(browseLoader.seed.roots[view],routeAbort.signal,0);}
  if(ticket!==routeEpoch||epoch!==catalogEpoch||routeAbort.signal.aborted)return;
  if(group.breadcrumbs[0].id!==browseLoader.seed.roots[view]){toast('分类链接范围无效，已返回资源目录。');group=await browseLoader.group(browseLoader.seed.roots[view],routeAbort.signal,0);}
  if(ticket!==routeEpoch||epoch!==catalogEpoch)return;activeGroup=group;currentView=view;desiredRoute={id:group.id,view};navigationPending=false;
  if(workspaceUI){workspaceUI.view=view;workspaceUI.viewSelect.value=view;workspaceUI.group=group.id;workspaceUI.onlySelected=false;for(const node of group.breadcrumbs)workspaceUI.expanded.add(node.id);workspaceUI.renderNavigation();}else directoryUI.setGroup(group,view,expandCurrent);
  document.body.classList.remove('groups-open');syncViewPriority();render();
 }catch(error){if(ticket===routeEpoch&&epoch===catalogEpoch&&error.name!=='AbortError'){navigationPending=false;showCatalogError(error,'route');}}
}
function restorePublicRoute(){
 const route=new URLSearchParams(location.hash.slice(1)),view=['semantic','directory'].includes(route.get('view'))?route.get('view'):'semantic',kind=route.get('kind')||'all';
 if($('detail').open)closeDetail();if($('exportDialog').open)$('exportDialog').close();state.kind=Object.hasOwn(kindLabels,kind)?kind:'all';state.query=(route.get('q')||'').slice(0,2000);$('query').value=state.query;$('typeFilter').value=state.kind;
 return navigateGroup(route.get('group')||browseLoader.seed.roots[view],view,false,true);
}
async function loadCatalog(refresh=false){
 const request=++seedRequest,fieldEpoch=filterEpoch;let seed;const embedded=document.getElementById('browseSeed');
 if(!refresh&&embedded)seed=JSON.parse(embedded.textContent);else{const bytes=await resourceQueue.bytes(new URL('data/navigation.json',document.baseURI),{priority:0,cache:false});seed=JSON.parse(new TextDecoder().decode(bytes));}
 const provider=new BrowseLoader(seed);if(request!==seedRequest){provider.dispose();return;}
 const previous=refresh&&browseLoader?currentScope():null,previousLibrary=catalog?.libraryId,wasNavigationPending=navigationPending,goal=navigationPending&&desiredRoute?desiredRoute:previous?{id:previous.group,view:previous.view}:null;
 const epoch=++catalogEpoch;routeEpoch++;routeAbort.abort();stopSearch();clearTimeout(lastQueryTimer);closeDetail();cleanupGrid();workspaceUI?.suspendNavigation?.();retainedWorkspace=workspaceUI||retainedWorkspace;workspaceUI=null;workspacePromise=null;directoryUI?.dispose();directoryUI=null;browseLoader?.dispose();identityAutoRequested=false;firstVisibleReady=false;catalogError=null;pendingPrivateRestore=null;
 browseLoader=provider;catalog=provider.catalog;activeGroup=provider.groups.get(seed.roots.semantic);currentView='semantic';navigationPending=true;directoryUI=new DirectoryUI(provider,directoryCallbacks());document.body.dataset.catalogStage='directory';
 $('typeFilter').replaceChildren(...Object.entries(kindLabels).map(([value,label])=>new Option(label,value)));$('typeFilter').value=state.kind;$('modeLabel').textContent=catalog.mode==='local'?'本机按需':'在线按需';$('rescan').hidden=catalog.mode!=='local';$('retryCatalog').hidden=true;$('libraryStat').textContent=seed.rowCount.toLocaleString()+' 项资源 · 目录可用';
 for(const id of ['openGroups','openExport','selectPage'])$(id).disabled=false;resizeGrid();
 if(previous&&previousLibrary===seed.libraryId&&(previous.onlySelected||previous.view==='collections')&&!wasNavigationPending){
  pendingPrivateRestore={libraryId:seed.libraryId,view:previous.view,group:previous.group,onlySelected:previous.onlySelected};hint('目录可用 · 正在恢复先前选择范围…');syncViewPriority();void ensureWorkspace(()=>pendingPrivateRestore?0:3).catch(error=>showCatalogError(error,'identity'));return;
 }
 if(previous&&previousLibrary===seed.libraryId&&goal&&['semantic','directory'].includes(goal.view)){await navigateGroup(goal.id||seed.roots[goal.view],goal.view,false,true);return;}
 if(fieldEpoch!==filterEpoch){const route=new URLSearchParams(location.hash.slice(1)),view=['semantic','directory'].includes(route.get('view'))?route.get('view'):'semantic';await navigateGroup(desiredRoute?.id||route.get('group')||seed.roots[view],desiredRoute?.view||view,false,true);}
 else await restorePublicRoute();
}
function frozenBrowseSnapshot(){const scope=currentScope();return{epoch:catalogEpoch,view:scope.view,group:scope.group,onlySelected:scope.onlySelected,category:[...scope.indices],results:[...filteredIndices],complete:Boolean(searchState?.complete),filter:{kind:state.kind,query:state.query,label:kindLabels[state.kind]||state.kind}};}
for(const id of ['selectPage','selectResults','selectGroup','showSelection','clearSelection','batchDownload','batchStream','openExport'])$(id).addEventListener('click',event=>{
 if(navigationPending&&['selectPage','selectResults','selectGroup','openExport'].includes(id)){event.preventDefault();event.stopImmediatePropagation();hint('当前目标范围正在准备，请就绪后选择。');return;}if(workspaceUI)return;event.preventDefault();event.stopImmediatePropagation();const captured=frozenBrowseSnapshot(),visible=filteredIndices.slice(state.page*pageSize,(state.page+1)*pageSize),exportTicket=++earlyExportTicket;
 if(id==='openExport'){earlyExportController?.abort();earlyExportController=new AbortController();toolMenus.closeAll();$('exportTitle').textContent='按范围下载';$('exportPath').textContent=activeGroup?.breadcrumbs.map(v=>v.label).join(' › ')||'当前范围';$('exportSummary').textContent=captured.category.length.toLocaleString()+' 项资源 · 正在准备取用';$('exportProgress').textContent='准备当前范围的原件身份…';$('exportDownload').disabled=true;$('exportCancel').hidden=true;for(const input of document.querySelectorAll('[name=exportScope]'))input.disabled=true;if(!$('exportDialog').open)$('exportDialog').showModal();syncViewPriority();}
 else $('batchStatus').textContent='正在准备选择记录，目录和预览仍可使用…';
 void ensureWorkspace(0,id==='openExport'?earlyExportController.signal:undefined).then(ui=>{
  if(captured.epoch!==catalogEpoch)return;const ids=values=>values.map(i=>catalog.items[i].id);
  if(id==='openExport'){
   if(exportTicket!==earlyExportTicket||!$('exportDialog').open)return;
   ui.openExport({catalog,view:captured.view,group:captured.group,onlySelected:captured.onlySelected,categoryIds:ids(captured.category),resultIds:ids(captured.results),selectionIds:[...ui.selection.ids],filter:captured.filter,resultsComplete:captured.complete});
  }else if(id==='selectPage')ui.mutate(()=>ui.selection.add(ids(visible)));
  else if(id==='selectResults'&&captured.complete)ui.mutate(()=>ui.selection.add(ids(captured.results)));
  else if(id==='selectGroup')ui.mutate(()=>ui.selection.add(ids(captured.category)));
  else if(id==='showSelection')$('showSelection').click();
  else if(id==='clearSelection')ui.mutate(()=>ui.selection.clear());
  else if(id==='batchDownload')ui.message('选择记录已恢复，请核对后再次点击下载。');
  else if(id==='batchStream')ui.message('原件清单准备好后，请再次点击流式保存。');
 }).catch(error=>showCatalogError(error,'identity'));
},{capture:true});
$('closeExport').addEventListener('click',()=>{if(!workspaceUI)$('exportDialog').close();});$('exportDialog').addEventListener('close',()=>{earlyExportTicket++;earlyExportController?.abort();earlyExportController=null;syncViewPriority();});
$('retryCatalog').addEventListener('click',()=>{const scope=catalogError?.scope,reload=catalogError?.error?.reloadBootstrap;$('retryCatalog').hidden=true;catalogError=null;if(!browseLoader||scope==='seed'||reload)void loadCatalog(true).catch(error=>showCatalogError(error,'seed'));else if(scope==='identity')void ensureWorkspace(0).catch(error=>showCatalogError(error,'identity'));else if(scope==='route'&&desiredRoute)void navigateGroup(desiredRoute.id,desiredRoute.view,false,true);else{stopSearch();render();}});
$('gridWrap').addEventListener('scroll',pageReadiness,{passive:true});
$('query').addEventListener('input',()=>{const value=$('query').value,changed=normal(value).trim()!==normal(state.query).trim()||state.kind!=='all',intent=++filterEpoch;state.query=value;state.kind='all';state.page=0;if(changed){searchState?.controller.abort();headerAbort.abort();gridQueue?.pause();}clearTimeout(lastQueryTimer);lastQueryTimer=setTimeout(()=>{if(intent===filterEpoch)render();},90);});
for(const button of document.querySelectorAll('[data-game]'))button.addEventListener('click',()=>{filterEpoch++;state.game=button.dataset.game;state.page=0;stopSearch();rebuildNavigation();render();});
for(const button of document.querySelectorAll('[data-query]'))button.addEventListener('click',()=>{filterEpoch++;clearTimeout(lastQueryTimer);state.query=button.dataset.query;state.kind='all';state.game='all';state.source='';state.page=0;$('query').value=state.query;workspaceUI?.resetGroup();stopSearch();render();});
$('typeFilter').addEventListener('change',()=>{filterEpoch++;clearTimeout(lastQueryTimer);state.kind=$('typeFilter').value;state.page=0;stopSearch();render();});$('reset').addEventListener('click',reset);$('emptyReset').addEventListener('click',reset);
function paginate(delta){clearTimeout(lastQueryTimer);if(!searchState||searchState.intent!==filterEpoch){state.page=0;render();}else{state.page+=delta;paintPage();}}$('previous').addEventListener('click',()=>paginate(-1));$('next').addEventListener('click',()=>paginate(1));$('density').addEventListener('change',()=>{state.density=$('density').value;resizeGrid();});
$('playGrid').addEventListener('click',()=>{state.playing=!state.playing;$('playGrid').textContent=state.playing?'Ⅱ 列表动画':'▶ 播放动画';$('playGrid').setAttribute('aria-pressed',String(state.playing));for(const controller of gridControllers.values())if(controller.mediaKind!=='audio')state.playing?controller.play():controller.pause();});$('background').addEventListener('click',()=>{state.light=!state.light;for(const host of document.querySelectorAll('.preview'))host.classList.toggle('light',state.light);});
$('closeDetail').addEventListener('click',closeDetail);$('zoomIn').addEventListener('click',()=>detailController?.zoomBy?.(1.25));$('zoomOut').addEventListener('click',()=>detailController?.zoomBy?.(.8));$('resetView').addEventListener('click',()=>{if(detailController?.resetView?.()===false)$('actionStatus').textContent='此预览没有可复位的视角。';});
$('fileSelect').addEventListener('change',()=>{changeAsset($('fileSelect').value);if(selected?.kind==='sound-event')detailController?.setSource?.(url(selectedAsset),catalog.assets[selectedAsset].name);});$('detailPlay').addEventListener('click',()=>{if(detailController){detailController.playing?detailController.pause():detailController.play();$('detailPlay').textContent=detailController.playing?'Ⅱ':'▶';}});
$('timeline').addEventListener('input',()=>detailController?.seek(Number($('timeline').value)));$('speed').addEventListener('change',()=>detailController?.setSpeed(Number($('speed').value)));$('animation').addEventListener('change',()=>{detailController?.setAnimation($('animation').value);$('timeline').max=String(detailController?.duration||1);});$('skin').addEventListener('change',()=>detailController?.setSkin($('skin').value));$('copyRelative').addEventListener('click',()=>copy(false));$('copyFull').addEventListener('click',()=>copy(true));$('download').addEventListener('click',()=>download(false));$('downloadBundle').addEventListener('click',()=>download(true));
$('rescan').addEventListener('click',async()=>{if(catalog?.mode!=='local'||$('rescan').disabled)return;$('rescan').disabled=true;$('rescan').textContent='后台重扫…';try{const response=await fetch('api/reindex',{method:'POST'}),data=await response.json();if(!response.ok)throw Error(data.error);await loadCatalog(true);toast('目录已更新，原件保持在原处。');}catch(error){toast(error.message);}finally{$('rescan').disabled=false;$('rescan').textContent='重扫资源';}});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();$('query').focus();}if(event.key==='Escape')closeDetail();});new ResizeObserver(resizeGrid).observe($('gridWrap'));
setInterval(()=>{if(detailController&&$('animationControls').hidden===false){const time=Number(detailController.time)||0,duration=Number(detailController.duration)||0;if(document.activeElement!==$('timeline'))$('timeline').value=String(time);$('timeLabel').textContent=time.toFixed(1)+' / '+duration.toFixed(1)+'s';}},80);
document.addEventListener('close',()=>queueMicrotask(syncViewPriority),true);document.addEventListener('visibilitychange',syncViewPriority);
window.addEventListener('hashchange',()=>{if(browseLoader)void restorePublicRoute();});
try{await loadCatalog();}catch(error){showCatalogError(error,'seed');$('resultCount').textContent='目录暂不可读取';}
window.addEventListener('pagehide',event=>{workspaceUI?.task?.abort();if(event.persisted)return;browseLoader?.dispose();routeAbort.abort();stopSearch();gridAbort.abort();detailAbort.abort();resourceQueue.dispose();});

$('detail').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('detail').addEventListener('click',event=>{if(event.target!==$('detail'))return;const r=$('detail').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDetail();});


$('detailBackdrop').addEventListener('click',closeDetail);
document.addEventListener('keydown',event=>{if(!$('detail').open||event.key!=='Tab')return;const controls=[...$('detail').querySelectorAll('button,input,select,summary,a[href],[tabindex="0"]')].filter(e=>!e.disabled&&e.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});

// Fallback for browsers without platform close requests; shared GPU canvas stays outside top layer.
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('detail').open){event.preventDefault();event.stopImmediatePropagation();closeDetail();}},true);
