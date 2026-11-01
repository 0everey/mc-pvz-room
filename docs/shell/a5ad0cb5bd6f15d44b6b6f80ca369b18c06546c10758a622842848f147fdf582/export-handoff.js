// Project-specific optional handoff contract. Catalog membership and originals
// remain owned by library-state; the vendored generic Skill is unchanged.
export const HANDOFF_FILE='使用说明.txt';
export const PUBLIC_SITE='https://0everey.github.io/mc-pvz-room/';
const fields=['schema','title','scope','view','group','breadcrumbs','query','kind','instructions','site'];
const scopeNames={category:'当前分类（含全部子分类）',results:'当前筛选结果（全部页）',selection:'已有选集'};
function line(value,max,label){if(typeof value!=='string'||[...value].length>max||/[\u0000-\u001f]/u.test(value))throw Error(label+'无效');return value;}
export function validateHandoff(value){
 if(value==null)return undefined;
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!fields.includes(key)))throw Error('交接说明字段无效');
 if(value.schema!=='resource-handoff.v1'||!['category','results','selection'].includes(value.scope)||!['semantic','directory','collections'].includes(value.view))throw Error('交接说明版本或范围无效');
 const title=line(value.title,600,'分类标题');if(!title.trim())throw Error('分类标题为空');
 const group=line(value.group,240,'分类标识'),query=line(value.query,2000,'筛选词'),kind=line(value.kind,100,'类型说明');
 if(!Array.isArray(value.breadcrumbs)||value.breadcrumbs.length>32||!Array.isArray(value.instructions)||value.instructions.length>20)throw Error('交接说明列表无效');
 const breadcrumbs=value.breadcrumbs.map(text=>line(text,240,'分类路径')),instructions=value.instructions.map(text=>line(text,1600,'使用说明'));
 const site=line(value.site,1000,'来源站点');let address;try{address=new URL(site);}catch{throw Error('来源站点无效');}if(address.protocol!=='https:'||address.username||address.password||address.search||address.hash||['localhost','127.0.0.1','[::1]'].includes(address.hostname))throw Error('交接站点须为公开HTTPS地址');
 const result={schema:value.schema,title,scope:value.scope,view:value.view,group,breadcrumbs:Object.freeze(breadcrumbs),query,kind,instructions:Object.freeze(instructions),site};
 if(new TextEncoder().encode(JSON.stringify(result)).length>65536)throw Error('交接说明过大');return Object.freeze(result);
}
export function publicManifest(plan){
 const record={schema:plan.schema,libraryId:plan.libraryId,revision:plan.revision,itemCount:plan.itemCount,fileCount:plan.fileCount,totalBytes:plan.totalBytes,items:plan.items.map(item=>({id:item.id,name:item.name,fingerprint:item.fingerprint,files:[...item.files]})),files:plan.files.map(file=>({id:file.id,path:file.path,name:file.name,bytes:file.bytes,sha256:file.sha256}))};
 if(plan.handoff!==undefined)record.handoff=validateHandoff(plan.handoff);return record;
}
export function handoffText(plan){
 const h=validateHandoff(plan.handoff);if(!h)return '';
 return [h.title,'下载范围：'+scopeNames[h.scope],'分类路径：'+h.breadcrumbs.join(' / '),...(h.scope==='results'?['筛选类型：'+h.kind,'搜索词：'+(h.query||'无')]:[]),`资源：${plan.itemCount} 项；去重原件：${plan.fileCount} 个；原件字节：${plan.totalBytes}`,'目录版本：'+plan.revision,'原站：'+h.site,'','如何使用',...h.instructions.map((text,index)=>(index+1)+'. '+text),'','完整资源名称、原文件相对路径、依赖映射和SHA-256见 BATCH-MANIFEST.json。','保留目录结构；同名的不同路径不能合并。原件数包含已登记依赖，不等于逻辑资源项数。','原素材权利仍属原权利人；本包不授予新的使用或商业分发许可。',''].join('\n');
}
export function makeHandoff(catalog,plan,{scope,view,group,breadcrumbs,filter}){
 const rows=new Map(catalog.items.map(row=>[row.id,row])),kinds=new Set(plan.items.map(item=>rows.get(item.id)?.kind));
 const instructions=['先阅读本说明，再按清单找到原件；文件保留原库相对目录，可从中文资源名查到对应的全部文件。'];
 if(kinds.has('mc-model'))instructions.push('我的世界模型保留JSON父模型链和贴图；在对应Java 1.21.1命名空间结构下消费。此包是原件素材，不是可直接安装的资源包。');
 if(kinds.has('recipe'))instructions.push('配方为Minecraft Java 1.21.1原JSON定义；标签、条件产物和运行规则由对应游戏环境解析，不等同配方图片或完整数据包。');
 if(kinds.has('spine'))instructions.push('骨骼二进制、同目录atlas和全部贴图页须成套保留；使用兼容原Spine 4.2格式的工具或运行库，不等同可编辑Spine工程。运行库条款与原素材权利分别处理。');
 if(kinds.has('audio')||kinds.has('sound-event'))instructions.push('音频按原OGG/WAV等格式导入。声音事件须同时保留源定义及其音频变体，事件权重/音量/音调按原定义消费。');
 if(kinds.has('texture')||kinds.has('image')||kinds.has('gif'))instructions.push('图片/动画保持原格式；竖向纹理条和附带mcmeta按其帧定义使用，不把整条误当单帧。');
 if(kinds.has('definition'))instructions.push('定义资料保留原数据；网页中的模型/标签/粒子等图是用途预览，原件不等同已经运行的游戏效果。');
 if(catalog.mode==='local')instructions.push('本包由本机目录导出；原站用于浏览同一资源库，不保证本机后加内容已在站内公开。');
 instructions.push('来源与运行库条款入口：'+PUBLIC_SITE+'RESOURCE-SOURCES.md');
 const title=scope==='selection'?'已有选集':breadcrumbs.join(' · ')+(scope==='results'?' · 筛选结果':'');
 return validateHandoff({schema:'resource-handoff.v1',title,scope,view,group:scope==='selection'?'':group||'',breadcrumbs:scope==='selection'?['已有选集']:breadcrumbs,query:scope==='results'?filter.query:'',kind:scope==='results'?filter.label:'全部类型',instructions,site:PUBLIC_SITE});
}
export function withHandoff(plan,handoff){return Object.freeze({...plan,handoff:validateHandoff(handoff)});}
export function exportFilename(plan){
 const h=validateHandoff(plan.handoff);let title=(h?.title||'资源原件').replace(/[\\/:*?"<>|\u0000-\u001f]/gu,'-').replace(/[. ]+$/u,'');const chars=[...title];if(chars.length>88)title=chars.slice(0,42).join('')+'…'+chars.slice(-36).join('');return '资源-'+title+'-'+plan.itemCount+'项.zip';
}
export function usageListing(plan,publicBase=''){
 const files=new Map(plan.files.map(file=>[file.id,file]));return handoffText(plan)+'\n资源与文件\n'+plan.items.map((item,index)=>`${index+1}. ${item.name}\n`+item.files.map(id=>{const file=files.get(id);return '   '+file.path+(publicBase?'\n   下载：'+new URL(file.url,publicBase).href:'');}).join('\n')).join('\n')+'\n';
}
export function publicRoute({view,group,scope,filter,onlySelected},baseURL){
 const address=new URL(baseURL),canonical=new URL(PUBLIC_SITE);if(address.origin!==canonical.origin||!address.pathname.startsWith(canonical.pathname)||!['semantic','directory'].includes(view)||(onlySelected&&scope==='results')||scope==='selection')return null;
 address.hash=new URLSearchParams({view,group,kind:scope==='results'?filter.kind:'all',q:scope==='results'?filter.query:''}).toString();address.search='';return address.href;
}
