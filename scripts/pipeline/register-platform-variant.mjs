// Register a HUMAN-MADE, human-approved Facebook cut (3–90 s) of an already published master.
//   node --env-file=.env scripts/pipeline/register-platform-variant.mjs VIDEO_UUID /path/fb-cut.mp4 --approved-by "Name" [--note "..."]
// The file is probed, hashed, uploaded to the private `reels` bucket under variants/ (no overwrite) via the existing TUS
// uploader, then registered. Nothing is truncated automatically; a master >90 s stays dead-lettered until this is run.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {uploadResumable} from './storage-upload.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function probeVariant(file,probe=execFileSync) {
  const j=JSON.parse(probe('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height:format=duration','-of','json',file],{encoding:'utf8',timeout:30000}));
  const v=j.streams?.find(s=>s.codec_type==='video'),a=j.streams?.find(s=>s.codec_type==='audio'),d=Number(j.format?.duration);
  if(!v||!a)throw new Error('variant needs video and audio streams');
  if(v.codec_name!=='h264'||a.codec_name!=='aac')throw new Error('variant must be H.264 + AAC');
  if(v.width!==1080||v.height!==1920)throw new Error('variant must be 1080x1920');
  if(!(d>=3&&d<=90))throw new Error('variant duration must be 3–90 s, got '+d.toFixed(2));
  return Math.round(d*1000)/1000;
}
export async function registerVariant({db,videoId,file,approvedBy,note,supabaseUrl,key,upload=uploadResumable,probe=probeVariant}) {
  if(!UUID.test(videoId||''))throw new Error('video id must be a UUID');
  if(!approvedBy||!approvedBy.trim())throw new Error('--approved-by is required');
  const duration=probe(file);
  const bytes=fs.readFileSync(file);
  if(bytes.length>100*1024*1024)throw new Error('variant exceeds the 100 MB bucket limit');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const storagePath=`variants/${videoId}/facebook-${sha.slice(0,16)}.mp4`;
  const state=`${file}.tus.json`;
  await upload({supabaseUrl,key,storagePath,bytes,stateFile:state});
  fs.rmSync(state,{force:true});
  const {data,error}=await db.rpc('register_platform_variant',{p_video_id:videoId,p_platform:'facebook',p_path:storagePath,p_sha256:sha,p_size:bytes.length,p_duration:duration,p_approved_by:approvedBy,p_note:note||null});
  if(error)throw new Error('register failed: '+String(error.message).slice(0,200));
  return {storagePath,sha256:sha,duration,requeued:data===true};
}
if(process.argv[1] && import.meta.url===new URL(process.argv[1],'file:').href) {
  const [videoId,file]=process.argv.slice(2);
  const arg=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:undefined;};
  const {createClient}=await import('@supabase/supabase-js');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  try{console.log(JSON.stringify(await registerVariant({db,videoId,file,approvedBy:arg('--approved-by'),note:arg('--note'),supabaseUrl:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY})));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
