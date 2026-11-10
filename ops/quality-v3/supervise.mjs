// NOT installed/enabled by the package installer. Existing DB claims remain authority.
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
let stopping=false,child;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;child?.kill(sig);});
if(process.env.VIDEO_DELIVERY_ENABLED!=='true'||process.env.VIDEO_DISTRIBUTION_WORKER_ENABLED==='true'){
 console.error('Worker disabled or conflicting legacy worker flag.');process.exit(1);
}
while(!stopping){
 let ok=false;
 try{ok=await new Promise((resolve,reject)=>{
  child=spawn(process.execPath,['scripts/pipeline/delivery-worker.mjs'],{stdio:'ignore',env:process.env});
  child.once('error',reject);child.once('exit',code=>resolve(code===0));
 });}catch{}finally{child=undefined;}
 // Child output suppressed: provider/session/error payloads must not reach journal.
 console.log(JSON.stringify({event:ok?'delivery_tick_ok':'delivery_tick_failed',at:new Date().toISOString()}));
 // A process exit of zero is NOT evidence of any publication.
 for(let i=0;i<60&&!stopping;i++)await sleep(1000);
}
