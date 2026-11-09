// Explicit operator recovery ONLY; does not generate a new video or publish by itself.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {inspectRender} from './upload-supabase-video.mjs';
if(!process.argv.includes('--renew-upload-lease'))throw new Error('Inspect recovery assets first, then pass --renew-upload-lease explicitly');
const file=new URL('../../temp_assets/manifest.json',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(manifest.job_id || ''))throw new Error('Version-2 job UUID required');
// Recovery may move from Actions to Termux. Rebase only the fixed job-relative output.
const local=path.join(fileURLToPath(new URL('../../temp_assets/',import.meta.url)),manifest.job_id,'final_output.mp4');
if(!fs.existsSync(local))throw new Error('Recovered job output is missing');
manifest.video_path=local;
inspectRender(manifest);
fs.writeFileSync(file,JSON.stringify(manifest,null,2),{mode:0o600});
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {error}=await db.rpc('renew_media_upload_claim',{p_job_id:manifest.job_id,p_claim_token:manifest.claim_token});
if(error){console.error('Recovery refused:',error.message);process.exitCode=1;}
else console.log('Original job lease renewed. Now retry bash run-bvai.sh --upload-only; never rerender this manifest.');
