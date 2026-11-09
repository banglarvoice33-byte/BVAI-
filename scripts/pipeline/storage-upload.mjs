// Minimal TUS 1.0 uploader with persisted session, fixed 6 MiB chunks, no overwrite.
import fs from 'node:fs';
import {providerUrl} from './delivery-providers.mjs';
export async function uploadResumable({supabaseUrl,key,storagePath,bytes,stateFile}) {
  const base=new URL(supabaseUrl);
  if(base.protocol!=='https:')throw new Error('HTTPS Supabase URL required');
  const endpoint=new URL('/storage/v1/upload/resumable',base).href;
  const headers={Authorization:`Bearer ${key}`,'Tus-Resumable':'1.0.0'};
  let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  if(state && (state.path!==storagePath || state.size!==bytes.length))throw new Error('TUS state asset mismatch');
  if(!state) {
    const meta={bucketName:'reels',objectName:storagePath,contentType:'video/mp4',cacheControl:'3600'};
    const created=await fetch(endpoint,{method:'POST',headers:{...headers,'Upload-Length':String(bytes.length),'Upload-Metadata':Object.entries(meta).map(([k,v])=>`${k} ${Buffer.from(v).toString('base64')}`).join(',')},signal:AbortSignal.timeout(30000),redirect:'manual'});
    if(!created.ok || !created.headers.get('location'))throw new Error(`TUS creation HTTP ${created.status}`);
    const url=providerUrl(new URL(created.headers.get('location'),endpoint).href,[base.hostname]);
    state={url,path:storagePath,size:bytes.length};
    fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
  }
  const url=providerUrl(state.url,[base.hostname]);
  for(let attempt=0;attempt<5;attempt++) {
    try {
      const head=await fetch(url,{method:'HEAD',headers,signal:AbortSignal.timeout(30000),redirect:'manual'});
      if(!head.ok)throw new Error(`TUS status HTTP ${head.status}`);
      let offset=Number(head.headers.get('Upload-Offset'));
      if(!Number.isSafeInteger(offset) || offset<0 || offset>bytes.length)throw new Error('Invalid TUS offset');
      while(offset<bytes.length) {
        const chunk=bytes.subarray(offset,Math.min(bytes.length,offset+6*1024*1024));
        const response=await fetch(url,{method:'PATCH',headers:{...headers,'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},body:chunk,signal:AbortSignal.timeout(120000),redirect:'manual'});
        if(response.status!==204)throw new Error(`TUS chunk HTTP ${response.status}`);
        const next=Number(response.headers.get('Upload-Offset'));
        if(next!==offset+chunk.length)throw new Error('TUS unexpected offset');
        offset=next;
      }
      return;
    } catch(error) {if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,500*2**attempt));}
  }
}
