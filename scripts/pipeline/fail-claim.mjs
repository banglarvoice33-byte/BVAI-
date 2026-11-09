import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const file = new URL('../../temp_assets/claim.json', import.meta.url);
if (fs.existsSync(file)) {
  const claim = JSON.parse(fs.readFileSync(file,'utf8'));
  const db = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const { error } = await db.rpc('fail_video_generation_job', {p_job_id:claim.job_id,p_claim_token:claim.claim_token,p_reason:'GitHub Actions pipeline failed; see diagnostics'});
  if (error) { console.error('Could not fail claim:',error.message);process.exitCode=1; }
}
