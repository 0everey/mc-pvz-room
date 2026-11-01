import {specialRules} from './recipe-rules.js';
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const labels={crafting_shaped:'有序合成',crafting_shapeless:'无序合成',smelting:'熔炉',blasting:'高炉',smoking:'烟熏炉',campfire_cooking:'营火烹饪',stonecutting:'切石机',smithing_transform:'锻造升级',smithing_trim:'盔甲纹饰'};

// Both surfaces consume the same slots and original recipe semantics. The card
// is a diagram, while the detail has actual buttons for alternatives inspection.
export function recipePreview(row,context){
  const r=row.recipe,rule=specialRules[r.type],detail=Boolean(context.detail),root=node('div','recipe-preview'+(detail?' recipe-full':' recipe-mini'));
  root.dataset.recipeType=r.type;
  const title=node('div','recipe-method',labels[r.type]||'动态规则');
  const flow=node('div','recipe-flow'),inputs=node('div','recipe-inputs'),options=node('p','recipe-alternatives');options.hidden=true;
  const itemName=id=>context.mcItems[id]?.name||id;
  function slot(ingredient,role='',output=false){
    const ids=ingredient?.items||[],box=node(detail&&ingredient?'button':'div','recipe-slot'+(ingredient?'':' slot-empty')+(output?' slot-output':''));
    if(box.tagName==='BUTTON')box.type='button';
    const names=ids.map(itemName),label=names.join(' / ')||role;box.title=label;
    box.setAttribute('aria-label',role?(role+'：'+label):label||'空格');
    const first=context.mcItems[ids[0]];
    if(first?.asset){const img=node('img');img.dataset.resourceUrl=context.url(first.asset);img.alt=first.name;img.draggable=false;box.append(img);}
    else if(ingredient)box.append(node('span','slot-fallback',label||'按规则'));
    if(ids.length>1)box.append(node('small','slot-options','+'+(ids.length-1)));
    if(detail&&ingredient)box.addEventListener('click',()=>{options.hidden=false;options.textContent=(ingredient.tag?'#'+ingredient.tag+'：':role?role+'：':'材料：')+names.join('、');});
    if(role)box.dataset.role=role;
    if(output&&r.count>1)box.append(node('b','slot-count',String(r.count)));
    return box;
  }
  const fixed=Boolean(r.output);
  if(r.type==='crafting_shaped'||r.type==='crafting_shapeless'){
    inputs.classList.add('recipe-grid');if(r.type==='crafting_shapeless')inputs.classList.add('recipe-unordered');
    const grid=r.type==='crafting_shaped'?r.grid:r.ingredients;
    for(let i=0;i<9;i++)inputs.append(slot(grid?.[i]));
  }else if(r.type.startsWith('smithing_')){
    inputs.classList.add('recipe-smithing');
    ['模板','基底','添加物'].forEach((role,i)=>{const part=node('div','recipe-part');part.append(slot(r.ingredients[i],role),node('span','recipe-role',!detail&&role==='添加物'?'添加':role));inputs.append(part);});
  }else if(r.ingredients.length){
    inputs.append(slot(r.ingredients[0],'材料'));
  }else{
    inputs.classList.add('recipe-dynamic-input');inputs.append(node('strong','',rule?.[0]||'输入随规则变化'),node('span','','用途示意'));
  }
  const arrow=node('div','recipe-arrow','→');arrow.setAttribute('aria-hidden','true');
  const result=fixed?slot({items:[r.output]},'产物',true):node('div','recipe-variable-result');
  if(!fixed){
    const icon=context.mcItems[rule?.[3]];
    if(icon?.asset){const img=node('img');img.dataset.resourceUrl=context.url(icon.asset);img.alt='物品图标示意：'+icon.name;result.append(img);}
    result.append(node('strong','',rule?.[1]||(r.type==='smithing_trim'?'纹饰装备':'条件产物')),node('small','','随输入变化'));
  }
  flow.append(inputs,arrow,result);root.append(title,flow);
  const notes=[];
  if(r.seconds)notes.push(r.seconds+' 秒');
  if(r.experience!==null&&r.experience!==undefined&&detail)notes.push('经验 '+r.experience);
  if(!fixed)notes.push(rule?'用途示意 · 产物可变':'动态配方 · 非固定产物');
  if(r.type==='crafting_shapeless')notes.push('材料位置不限');
  if(notes.length)root.append(node('div','recipe-caption',notes.join(' · ')));
  if(detail&&fixed)root.append(node('p','recipe-product-name',itemName(r.output)+(r.count>1?' × '+r.count:'')));
  if(detail&&rule){root.append(node('p','recipe-rule-note',rule[2]+'。图标仅示意物品类别；具体材料、数量和数据按游戏规则处理。'));const source=node('a','recipe-rule-source','规则用途来源 · 1.21–1.21.1');source.href='https://docs.neoforged.net/docs/1.21.1/resources/server/recipes/builtin/#special-crafting';source.target='_blank';source.rel='noopener noreferrer';root.append(source);}
  if(detail)root.append(options);
  return root;
}
