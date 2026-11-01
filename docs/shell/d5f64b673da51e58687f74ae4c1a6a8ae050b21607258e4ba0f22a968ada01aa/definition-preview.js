import {makeScope,assetText,imageElementsReady} from './engines/lifecycle.js';
import {createPreview} from './preview-engines.js';
import {createImagePreview} from './frame-player.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const key=value=>String(value||'').replace(/^minecraft:/,'');

// These are previews of the actual definition, never simulations of game rules.
export async function createDefinitionPreview(host,row,context){
  const scope=makeScope(host,context),root=el('div','definition-preview'+(context.detail?' definition-full':' definition-mini'));
  scope.own(()=>root.remove());
  try{
    const text=await assetText(scope,row.asset);scope.check();
    let data;try{data=JSON.parse(text);}catch{data=null;}
    const heading=el('strong','definition-kind'),art=el('div','definition-art'),summary=el('div','definition-summary'),list=el('div','definition-entries');
    root.append(heading,art,summary,list);host.append(root);
    const entry=value=>list.append(el('div','',String(value)));
    const image=(asset,label)=>{if(!asset)return;const img=el('img');img.dataset.resourceUrl=context.url(asset);img.alt=label;img.title=label;art.append(img);};
    let child=null;
    if(data?.variants||data?.multipart){
      heading.textContent='状态 → 模型';
      const entries=data.variants?Object.entries(data.variants):data.multipart.map((part,i)=>[part.when?JSON.stringify(part.when):'无条件 '+(i+1),part.apply]);
      summary.textContent=entries.length+(data.variants?' 种状态':' 条组合规则');
      for(const [state,model] of entries.slice(0,context.detail?12:2))entry((state||'默认')+' → '+(Array.isArray(model)?model.map(m=>key(m.model)).join(' / '):key(model?.model)));
      const binding=Array.isArray(entries[0]?.[1])?entries[0][1][0]:entries[0]?.[1],modelKey=key(binding?.model),asset=context.models[modelKey];
      if(asset){root.classList.add('definition-with-model');const sample=el('div','definition-model');art.append(sample);entry('首个绑定模型 · 原姿态');child=await createPreview(sample,{id:row.id+'/sample',kind:'mc-model',asset,modelKey},{...context,signal:scope.signal,onStatus:({phase,message})=>{if(scope.active&&phase==='unsupported')sample.append(el('span','',message));}});scope.check();}
    }else if(Array.isArray(data?.values)){
      heading.textContent='标签成员';summary.textContent=data.values.length+' 个条目'+(data.replace?' · 替换旧标签':'');
      for(const value of data.values.slice(0,context.detail?80:3)){const id=key(typeof value==='string'?value:value.id),item=context.mcItems[id];entry(item?.name||id);if(art.childElementCount<3)image(item?.asset,item?.name||id);}
    }else if(Array.isArray(data?.textures)){
      heading.textContent='粒子贴图序列';summary.textContent=data.textures.length+' 张贴图';
      for(const value of data.textures.slice(0,context.detail?32:3)){const id=key(value);entry(id);if(art.childElementCount<3)image(context.textures['particle/'+id],id);}
    }else if(data?.animation){
      heading.textContent='纹理动画定义';const a=data.animation;summary.textContent=(a.frames?.length?a.frames.length+' 个指定帧':'顺序帧')+' · '+(a.frametime||1)+' 游戏刻 / 默认帧';
      entry(a.interpolate?'帧间插值':'逐帧播放');
      const textureKey=row.relativePath.split('/textures/')[1]?.replace(/\.png\.mcmeta$/,''),asset=context.textures[textureKey],textureRow=context.items.find(r=>r.asset===asset&&r.kind==='texture');
      if(textureRow){root.classList.add('definition-with-model');const sample=el('div','definition-model');art.append(sample);child=await createImagePreview(sample,textureRow,{...context,signal:scope.signal,onStatus:()=>{}});scope.check();}
    }else if(Array.isArray(data?.sources)){
      heading.textContent='图集来源';summary.textContent=data.sources.length+' 条来源规则';
      const typeName={directory:'目录',single:'单项',paletted_permutations:'调色板变体',filter:'过滤',unstitch:'分图'};
      for(const source of data.sources.slice(0,context.detail?32:3)){
        entry((typeName[key(source.type)]||key(source.type))+' · '+(source.source||source.resource||source.textures?.join(', ')||'原定义规则'));
        if(art.childElementCount<3){
          if(Array.isArray(source.textures)){
            for(const name of source.textures){if(art.childElementCount>=3)break;image(context.textures[key(name)],key(name)+' · 原模板');}
            if(key(source.type)==='paletted_permutations')entry('原模板样图 · 未模拟调色变体');
          }else{const prefix=source.source||key(source.resource),candidate=source.resource?context.textures[key(source.resource)]:Object.entries(context.textures).find(([name])=>name.startsWith(prefix+'/'))?.[1];image(candidate,prefix);}
        }
      }
    }else{
      const keys=data&&typeof data==='object'?Object.keys(data):[];
      heading.textContent=data?'结构化资料':'文本文档';summary.textContent=keys.length?keys.length+' 个顶层字段':'内容摘要';
      const snippet=el('pre','definition-snippet',data?JSON.stringify(data,null,2).slice(0,context.detail?4000:500):text.slice(0,context.detail?4000:500));list.append(snippet);
    }
    if(!art.childElementCount)art.remove();
    if(child)scope.own(()=>child.dispose());
    await imageElementsReady(root,scope.signal,context.priority||1);scope.check();scope.status('ready','定义预览 · 原数据和完整源文件可查');
    return {get duration(){return child?.duration||0;},get time(){return child?.time||0;},get playing(){return child?.playing||false;},play:()=>child?.play?.()||false,pause:()=>child?.pause?.()??true,seek:t=>child?.seek?.(t)||false,setSpeed:v=>child?.setSpeed?.(v)||false,dispose:()=>scope.dispose(),animations:[],skins:[]};
  }catch(error){scope.dispose();throw error;}
}
