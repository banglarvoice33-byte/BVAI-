// Additive migration deployer. Default is READ-ONLY contract preflight.
// Usage: node --env-file=.env scripts/pipeline/apply-media-migration.mjs [--apply]
import fs from 'node:fs';
import {Client} from 'pg';
const connection=process.env.SUPABASE_DB_URL;
if(!connection)throw new Error('SUPABASE_DB_URL required for migration preflight/deployment only');
const ca=process.env.SUPABASE_DB_CA_FILE?fs.readFileSync(process.env.SUPABASE_DB_CA_FILE,'utf8'):undefined;
const client=new Client({connectionString:connection,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},connectionTimeoutMillis:15000});
try {
  await client.connect();
  const {rows:[r]}=await client.query(`SELECT
    to_regprocedure('public.finalize_website_video(uuid,uuid,uuid,text,text,integer,text,bigint,boolean)') IS NOT NULL AS website_contract,
    to_regprocedure('public.claim_video_generation_job(uuid)') IS NOT NULL AS generation_claim,
    to_regprocedure('public.recover_expired_video_generation_jobs()') IS NOT NULL AS generation_recovery,
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name IN ('human_verified','verification_status','source_published_at','video_generated_at'))=4 AS editorial_columns,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='video_id' AND data_type='text') AS external_youtube_text,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='platform_posted' AND data_type='jsonb') AS platform_receipts`);
  console.log('Schema contract preflight:',JSON.stringify(r));
  if(Object.values(r).some(value=>value!==true))throw new Error('Schema drift: stop, compare Nov-9 prerequisites, do not replay all old migrations blindly');
  if(!process.argv.includes('--apply'))console.log('READ-ONLY preflight passed. Backup database first; use --apply only after review.');
  else {
    const file=new URL('../../supabase/migrations/20261110000000_media_delivery_reliability.sql',import.meta.url);
    await client.query(fs.readFileSync(file,'utf8'));
    console.log('Additive media migration committed. No cron activated and no provider called.');
  }
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error(error.code?'Migration/preflight stopped: '+error.code:'Migration/preflight stopped: '+error.message);
  process.exitCode=1;
} finally {await client.end().catch(()=>{});}
