// Existing newsroom collector remains the ingestion authority. This command probes EVERY
// enabled registry source and records observability; it never invents or publishes articles.
import {createClient} from '@supabase/supabase-js';
import {boundedFetch} from './source-evidence.mjs';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const probe=process.argv.includes('--probe');
let scanned=0,failed=0;
for(let start=0;;start+=100) {
  const {data:rows,error}=await db.from('news_sources').select('id,name,feed_url,enabled,kill_switch,last_probe_at,last_probe_status').eq('enabled',true).eq('kill_switch',false).order('id').range(start,start+99);
  if(error)throw new Error('Source registry unavailable: '+error.message);
  if(!rows?.length)break;
  for(const source of rows) {
    scanned++;
    if(!probe){console.log(JSON.stringify({name:source.name,last_probe_at:source.last_probe_at,status:source.last_probe_status}));continue;}
    let values;
    try {
      const result=await boundedFetch(source.feed_url,{maxBytes:4000000,headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'}});
      const text=result.bytes.toString('utf8');
      if(!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(text))throw new Error('Response is not RSS/Atom');
      const items=(text.match(/<(?:item|entry)[\s>]/gi)||[]).length;
      values={last_probe_at:new Date().toISOString(),last_probe_status:'ok',last_probe_http_status:200,last_probe_items:items,last_probe_error:null};
    } catch(error) {failed++;values={last_probe_at:new Date().toISOString(),last_probe_status:'error',last_probe_error:error.message.slice(0,200)};}
    const {error:updateError}=await db.from('news_sources').update(values).eq('id',source.id);
    if(updateError)throw new Error('Source observability write failed: '+updateError.message);
    console.log(JSON.stringify({name:source.name,...values}));
  }
  if(rows.length<100)break;
}
console.log(`Sources scanned=${scanned}; failures=${failed}; mode=${probe?'fresh_probe':'stored_health'}. A healthy feed is not claim verification.`);
if(failed)process.exitCode=1;
