import {visibleImageBounds,fitImage} from './preview-fit.js';
const active=new Set();let frameRequest=0,last=performance.now();
function visible(host){const r=host.getBoundingClientRect();return host.isConnected&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&getComputedStyle(host).visibility!=='hidden';}
function requestTick(){if(!frameRequest&&!document.hidden&&[...active].some(p=>p.needsFrame())){last=performance.now();frameRequest=requestAnimationFrame(tick);}}
function tick(now){frameRequest=0;const delta=document.hidden?0:Math.min(.1,(now-last)/1000);last=now;for(const player of active)player.update(delta);if(!document.hidden&&[...active].some(p=>p.needsFrame()))frameRequest=requestAnimationFrame(tick);}
export function invalidateImages(){for(const player of active)player.draw();requestTick();}
document.addEventListener('visibilitychange',requestTick);window.addEventListener('scroll',requestTick,{passive:true,capture:true});

export async function createImagePreview(host,row,context){
  const preview=row.preview,descriptor=preview?.asset||row.asset,image=new Image(),canvas=document.createElement('canvas');canvas.className='media-canvas';canvas.setAttribute('aria-label',(row.displayName||row.name));let closed=false,time=0,speed=1,playing=Boolean(context.autoPlay),ready=false;
  const frames=preview?.frames||[{rect:row.crop||[0,0,row.width||1,row.height||1],ms:1000}],duration=preview?.duration||0;
  const ctx=canvas.getContext('2d'),reader=document.createElement('div'),overview=document.createElement('canvas'),note=document.createElement('span');
  reader.className='image-reader';reader.append(canvas);overview.className='strip-overview';overview.hidden=true;note.className='image-note';note.hidden=true;host.append(reader,overview,note);let bounds=null;
  overview.addEventListener('click',event=>{event.stopPropagation();reader.scrollLeft=Math.max(0,(event.offsetX/overview.clientWidth)*(reader.scrollWidth-reader.clientWidth));});
  function draw(){
    if(closed||!ready||!visible(host))return;
    const rect=host.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2),strip=!duration&&bounds.width/bounds.height>rect.width/rect.height*3;
    host.classList.toggle('has-strip',strip);overview.hidden=!strip;note.hidden=!strip&&!bounds.empty;note.textContent=bounds.empty?'原图为透明内容':strip?'长图 · 下方总览定位':'';
    const cssHeight=Math.max(1,rect.height-(strip?26:0)),height=Math.max(1,Math.round(cssHeight*ratio));
    const width=Math.max(1,Math.round((strip?Math.max(rect.width,bounds.width/bounds.height*cssHeight):rect.width)*ratio));
    canvas.style.width=width/ratio+'px';canvas.style.height=cssHeight+'px';
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=row.game!=='MC';
    let t=Math.min(time*1000,Math.max(0,duration*1000-.001)),index=0;
    while(index<frames.length-1&&t>=frames[index].ms){t-=frames[index].ms;index++;}
    const fit=fitImage(bounds,width,height),source=frames[index].rect;
    const paint=frame=>ctx.drawImage(image,...frame.rect,fit.x,fit.y,frame.rect[2]*fit.scale,frame.rect[3]*fit.scale);
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    if(preview?.interpolate&&frames.length>1){const blend=t/frames[index].ms;ctx.globalAlpha=1-blend;paint(frames[index]);ctx.globalCompositeOperation='lighter';ctx.globalAlpha=blend;paint(frames[(index+1)%frames.length]);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';}else paint(frames[index]);
    if(strip){overview.width=Math.round(rect.width*ratio);overview.height=18*ratio;const m=overview.getContext('2d'),f=fitImage(bounds,overview.width,overview.height,.95);m.imageSmoothingEnabled=row.game!=='MC';m.drawImage(image,...source,f.x,f.y,source[2]*f.scale,source[3]*f.scale);}
  }
  const controller={get time(){return time},get duration(){return duration},get playing(){return playing},animations:[],skins:[],play(){if(closed)return false;playing=true;requestTick();return true},pause(){if(closed)return false;playing=false;return true},seek(value){if(closed)return false;time=Math.max(0,Math.min(Number(value)||0,duration));draw();return true},setSpeed(value){if(closed||!Number.isFinite(value)||value<=0)return false;speed=value;return true},draw,needsFrame(){return !closed&&ready&&playing&&duration>0&&visible(host)},update(delta){if(playing&&duration>0&&ready&&visible(host)){time=(time+delta*speed)%duration;draw();}},dispose(){if(closed)return true;closed=true;active.delete(controller);observer.disconnect();context.signal?.removeEventListener('abort',abort);image.onload=null;image.onerror=null;image.src='';reader.remove();overview.remove();note.remove();host.classList.remove('has-strip');if(!active.size&&frameRequest){cancelAnimationFrame(frameRequest);frameRequest=0;}return true}};
  const observer=new ResizeObserver(()=>{draw();requestTick();});observer.observe(host);const abort=()=>controller.dispose();context.signal?.addEventListener('abort',abort,{once:true});
  if(context.signal?.aborted){controller.dispose();throw new DOMException('Preview cancelled','AbortError');}
  try{await new Promise((resolve,reject)=>{const cancelled=()=>reject(new DOMException('Preview cancelled','AbortError'));const finish=callback=>()=>{context.signal?.removeEventListener('abort',cancelled);callback();};context.signal?.addEventListener('abort',cancelled,{once:true});image.onload=finish(resolve);image.onerror=finish(()=>reject(Error('图像读取失败，请重试或重扫资源。')));image.src=context.url(descriptor);});}catch(error){controller.dispose();throw error;}
  if(closed||context.signal?.aborted){controller.dispose();throw new DOMException('Preview cancelled','AbortError');}
  try{bounds=visibleImageBounds(image,frames.map(frame=>frame.rect));}catch(error){controller.dispose();throw error;}
  ready=true;draw();active.add(controller);requestTick();context.onStatus?.({phase:'ready',message:bounds.empty?'原图没有非透明像素':row.crop?'图集首格 · 原件保留完整布局':''});return controller;
}
