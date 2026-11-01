import {resourceQueue,viewPriority} from './request-queue.js';

// View-creation leases and complete network-transfer slots have separate owners.
export class PreviewQueue{
 constructor(root,signal,onError){
  this.root=root;this.signal=signal;this.onError=onError;this.jobs=new Map();this.running=[0,0,0];this.paused=false;this.scheduled=false;
  this.refreshHandler=()=>this.refresh();root.addEventListener('scroll',this.refreshHandler,{passive:true});window.addEventListener('resize',this.refreshHandler,{passive:true});
  this.observer=typeof IntersectionObserver==='function'?new IntersectionObserver(()=>this.refresh(),{root,rootMargin:'64px 0px',threshold:0}):null;
  signal.addEventListener('abort',()=>{this.observer?.disconnect();root.removeEventListener('scroll',this.refreshHandler);window.removeEventListener('resize',this.refreshHandler);for(const job of this.jobs.values())job.controller?.abort();this.jobs.clear();},{once:true});
 }
 add(host,load,heavy=false){if(this.signal.aborted)return;this.jobs.set(host,{host,load,lane:heavy==='spine'?2:heavy?1:0,state:'waiting',attempt:0,controller:null});this.observer?.observe(host);this.refresh();}
 rank(job){return viewPriority(job.host,false);}
 ready(job){return ['ready','empty','unsupported','error'].includes(job.host.dataset.phase);}
 retry(host){const job=this.jobs.get(host);if(!job||this.signal.aborted)return;job.controller?.abort();job.state='waiting';this.refresh();}
 prioritize(host){const job=this.jobs.get(host);if(job){job.host.dataset.urgent='true';this.refresh();}}
 cancel(job){
  if(job.state!=='running'||this.ready(job))return;
  job.state='waiting';job.controller?.abort();
  if(job.host.isConnected){job.host.dataset.phase='queued';const status=document.createElement('span');status.className='preview-status';status.textContent='等待可见时准备';job.host.replaceChildren(status);}
 }
 refresh(){
  if(this.signal.aborted)return;
  for(const job of this.jobs.values())if(job.state==='running'&&!this.ready(job)&&(this.paused||this.rank(job)>2||!job.host.isConnected))this.cancel(job);
  for(const lane of [0,1,2]){
   const waiting=[...this.jobs.values()].filter(job=>job.lane===lane&&job.state==='waiting'&&job.host.isConnected&&this.rank(job)<3),best=Math.min(...waiting.map(job=>this.rank(job)));
   for(const job of this.jobs.values())if(job.lane===lane&&job.state==='running'&&!this.ready(job)&&this.rank(job)>best)this.cancel(job);
  }
  resourceQueue.refresh();if(!this.scheduled){this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}
 }
 pump(){
  if(this.signal.aborted||this.paused)return;
  for(const lane of [0,1,2]){
   const limit=lane?1:3;
   while(this.running[lane]<limit){
    const job=[...this.jobs.values()].filter(j=>j.lane===lane&&j.state==='waiting'&&j.host.isConnected&&this.rank(j)<3).sort((a,b)=>this.rank(a)-this.rank(b))[0];if(!job)break;
    const ticket=++job.attempt,controller=new AbortController();job.controller=controller;job.state='running';this.running[lane]++;let lease=true;
    const release=()=>{if(!lease)return;lease=false;this.running[lane]--;this.refresh();};controller.signal.addEventListener('abort',release,{once:true});
    Promise.resolve().then(()=>{if(!controller.signal.aborted&&!this.signal.aborted)return job.load(controller.signal);})
     .catch(error=>{if(!controller.signal.aborted&&!this.signal.aborted&&ticket===job.attempt&&error.name!=='AbortError')this.onError(job.host,error);})
     .finally(()=>{controller.signal.removeEventListener('abort',release);if(ticket===job.attempt)job.state=controller.signal.aborted?'waiting':'done';release();});
   }
  }
 }
 pause(){if(!this.paused){this.paused=true;setTimeout(()=>{if(this.paused&&!this.signal.aborted)for(const job of this.jobs.values())this.cancel(job);},0);}resourceQueue.refresh();}
 resume(){this.paused=false;this.refresh();}
}
