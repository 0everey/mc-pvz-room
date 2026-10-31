// Ordinary HTML controls may enter the top layer; shared preview canvases stay put.
export function installToolMenus(){
 const native='showPopover' in HTMLElement.prototype,entries=[];let current=null;
 const isOpen=e=>native?e.panel.matches(':popover-open'):!e.panel.hidden;
 function place(e){
  const r=e.button.getBoundingClientRect(),margin=8,width=Math.min(264,innerWidth-margin*2);
  e.panel.style.width=width+'px';e.panel.style.maxHeight=Math.max(80,innerHeight-margin*2)+'px';
  const height=Math.min(e.panel.scrollHeight||250,innerHeight-margin*2),below=innerHeight-r.bottom-margin,above=r.top-margin;
  const top=below>=height||below>=above?r.bottom+5:Math.max(margin,r.top-height-5);
  e.panel.style.left=Math.max(margin,Math.min(innerWidth-width-margin,r.right-width))+'px';
  e.panel.style.top=Math.max(margin,Math.min(innerHeight-height-margin,top))+'px';
 }
 function close(e,focus=false){if(!e)return;if(isOpen(e)){if(native)e.panel.hidePopover();else e.panel.hidden=true;}e.button.setAttribute('aria-expanded','false');if(current===e)current=null;if(focus)e.button.focus({preventScroll:true});}
 function closeAll(){for(const e of entries)close(e);}
 for(const [index,details] of [...document.querySelectorAll('.tool-menu')].entries()){
  const summary=details.querySelector('summary'),panel=details.querySelector('.tool-menu-items');if(!summary||!panel)continue;
  const button=document.createElement('button');button.type='button';button.className='tool-trigger '+(details.classList.contains('display-menu')?'display-trigger':'selection-trigger');button.textContent=summary.textContent+' ▾';button.setAttribute('aria-expanded','false');
  panel.id='tool-popover-'+index;panel.className='tool-popover';panel.setAttribute('role','group');panel.setAttribute('aria-label',summary.textContent);button.setAttribute('aria-controls',panel.id);
  details.replaceWith(button);document.body.append(panel);const e={button,panel};entries.push(e);
  if(native){panel.popover='auto';button.popoverTargetElement=panel;button.popoverTargetAction='toggle';panel.addEventListener('toggle',event=>{const open=event.newState==='open';button.setAttribute('aria-expanded',String(open));if(open){current=e;place(e);}else if(current===e)current=null;});button.addEventListener('click',()=>place(e));}
  else{panel.hidden=true;button.addEventListener('click',()=>{if(isOpen(e)){close(e,true);return;}closeAll();panel.hidden=false;current=e;button.setAttribute('aria-expanded','true');place(e);});}
  panel.addEventListener('click',event=>{if(event.target.closest('button'))close(e,true);});
  panel.addEventListener('change',()=>close(e,true));
 }
 document.addEventListener('pointerdown',event=>{if(!native&&current&&!current.panel.contains(event.target)&&event.target!==current.button)close(current);},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&current){event.preventDefault();event.stopImmediatePropagation();close(current,true);}},true);
 document.addEventListener('focusin',event=>{if(current&&!current.panel.contains(event.target)&&event.target!==current.button)close(current);});
 window.addEventListener('resize',()=>{if(current)place(current);});
 window.addEventListener('pagehide',closeAll);
 return {closeAll};
}
