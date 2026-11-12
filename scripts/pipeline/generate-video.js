import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeVoice, audioDuration } from './voice-captions.js';
import { normalizeAudio } from './audio-qc.mjs';
import { assertEditorial, refreshEvidence } from './source-evidence.mjs';
import { collectCommonsVideo } from './commons-media.mjs';
import { archiveTerminalClaim } from './local-recovery.mjs';
import { loadVaultEnv } from './load-vault-env.mjs';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const TMP=path.resolve(__dirname,'../../temp_assets');
const hash=text=>createHash('sha256').update(text).digest('hex');
export const CLOSING_CTA='বিস্তারিত দেখতে বাংলার ভয়েস ওয়েবসাইট ভিজিট করুন।';
/** Extract complete source sentences. No render-date hook or invented impacts. */
export function buildVoiceScript(article) {
  const clean=value=>String(value || '').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().replace(/[0-9]/g,d=>'০১২৩৪৫৬৭৮৯'[Number(d)]);
  const title=clean(article.title_bn).replace(/[।!?]+$/,'');
  if(!title)throw new Error('Source headline required');
  const body=clean(article.content_bn || article.excerpt_bn);
  const sentences=body.match(/[^।!?]+[।!?]/g) || [];
  const parts=[title+'।'];
  for(const raw of sentences) {
    const sentence=raw.trim();
    if(parts.includes(sentence))continue;
    if([...parts,sentence,CLOSING_CTA].join(' ').length>1200)break;
    parts.push(sentence);
  }
  if(parts.length<2)throw new Error('Need complete source sentences within narration bound');
  return [...parts,CLOSING_CTA].join(' ');
}
function visualLen(s) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const seg = new Intl.Segmenter('bn', { granularity: 'grapheme' });
      return [...seg.segment(s)].length;
    } catch (_) {}
  }
  return [...String(s).normalize('NFC')].length;
}

function wrapTitle(title, maxLen = 22, maxLines = 3) {
  const words = String(title || '').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const c = line ? line + ' ' + w : w;
    if (visualLen(c) > maxLen && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = c;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [String(title || '')];
}

export const isMotionMedia=filename=>/\.(mp4|webm|ogv)$/i.test(filename);
export function renderOverlay(title, outPath, {sourceName='',media=[]}={}) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const lines = wrapTitle(title);
  const font = "'Noto Sans Bengali','Lohit Bengali','SolaimanLipi',sans-serif";
  const boxTop = 120;
  const boxH = 200 + lines.length * 62;
  const tspans = lines.map((l, i) =>
    '<tspan x="90" dy="' + (i === 0 ? 0 : 62) + '">' + esc(l) + '</tspan>'
  ).join('');
  const credits=[sourceName ? `সংবাদসূত্র: ${sourceName}` : '',...media.map(m=>`${m.author} | ${m.license}`)].filter(Boolean).flatMap(line=>wrapTitle(line,45,30));
  if(credits.length>18)throw new Error('On-screen attribution exceeds safe area; select a smaller media plan');
  const creditSvg=credits.length?'<rect x="50" y="680" width="980" height="'+(40+credits.length*34)+'" rx="12" fill="#111827" fill-opacity="0.88"/>'+credits.map((line,i)=>'<text x="70" y="'+(720+i*34)+'" font-family="'+font+'" font-size="28" fill="#FFFFFF">'+esc(line)+'</text>').join(''):'';
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="50" y="' + boxTop + '" width="980" height="' + boxH + '" rx="20" fill="#000" fill-opacity="0.85"/>' +
    '<text x="90" y="' + (boxTop + 50) + '" font-family="' + font + '" font-size="34" font-weight="bold" fill="#FF1744">বাংলার ভয়েস | সংবাদ</text>' +
    '<text x="90" y="' + (boxTop + 110) + '" font-family="' + font + '" font-size="44" font-weight="bold" fill="#FFFFFF">' + tspans + '</text>' +
    '<rect x="48" y="570" width="360" height="74" rx="12" fill="#111827"/>' +
    '<text x="70" y="621" font-family="' + font + '" font-size="40" fill="#FFFFFF">প্রতীকী ভিডিও</text>' +
    creditSvg + '</svg>';
  const svgPath = outPath.replace(/\.png$/i,'.svg');
  fs.writeFileSync(svgPath, svg, 'utf8');
  try {
    execFileSync('rsvg-convert', ['-f', 'png', '-o', outPath, svgPath], { timeout: 60000 });
    console.log('   ✅ rsvg-convert OK');
  } catch (e) {
    console.log('   ⚠️  rsvg-convert failed → ffmpeg fallback');
    execFileSync('ffmpeg', ['-y', '-i', svgPath, outPath], { timeout: 60000, stdio: 'inherit' });
  }
}

export function composeVideo(images, audioPath, subPath, overlayPath, outPath) {
  const audioDur = Number(execFileSync('ffprobe', [
    '-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1', audioPath
  ]).toString().trim());
  if (!Number.isFinite(audioDur) || audioDur < 1) throw new Error('Bad audio duration');

  const totalDur = Math.ceil((audioDur + 1.25) * 100) / 100;
  if (totalDur < 40 || totalDur > 120) throw new Error('Narration/render must be 40–120 seconds; do not pad invented claims');
  if (!images.length) throw new Error('Licensed media required');
  const normalized=path.join(path.dirname(audioPath),'normalized.wav');
  normalizeAudio(audioPath,normalized);
  const per = totalDur / images.length;
  const args = ['-y','-hide_banner','-loglevel','error','-filter_complex_threads','1'];
  for (const img of images) {
    if (isMotionMedia(img)) args.push('-stream_loop','-1','-t',per.toFixed(3),'-i',img);
    else args.push('-loop','1','-framerate','25','-t',per.toFixed(3),'-i',img);
  }
  args.push('-i', normalized);
  args.push('-loop','1','-framerate','25','-t',totalDur.toFixed(3),'-i',overlayPath);

  const parts = images.map((_, i) =>
    '[' + i + ':v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v' + i + ']'
  ).join(';');
  const concat = images.map((_, i) => '[v' + i + ']').join('');
  const ovIdx = images.length + 1;
  const assPath = subPath.replace(/\.vtt$/i, '.ass');
  try { if (fs.existsSync(subPath) && fs.statSync(subPath).size > 50) execFileSync('python3', [path.join(__dirname, 'vtt-to-karaoke.py'), subPath, assPath], { timeout: 60000, stdio: 'pipe' }); } catch (e) { console.log('   ⚠️  karaoke convert failed: ' + e.message); }
  const hasSubs = fs.existsSync(assPath) && fs.statSync(assPath).size > 50;
  if (!hasSubs) throw new Error('Burned-in Bengali captions required');
  const subStep = hasSubs
    ? ';[withov]subtitles=filename=' + assPath.replace(/([:\\'])/g, '\\$1') +
      "[outv]"
    : ';[withov]null[outv]';

  const filter = parts + ';' + concat + 'concat=n=' + images.length + ':v=1:a=0[base];' +
    '[base][' + ovIdx + ':v]overlay=0:0[withov]' + subStep;
  args.push('-filter_complex', filter);
  args.push('-map', '[outv]', '-map', images.length + ':a');
  args.push('-af', 'apad=pad_dur=1.25');
  args.push('-t', totalDur.toFixed(2));
  args.push('-c:v', 'libx264', '-preset', process.env.VIDEO_ENCODER_PRESET || process.env.VIDEO_PRESET || 'veryfast', '-crf', '26');
  args.push('-threads','2','-filter_complex_threads','1','-r','30','-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  args.push('-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2', outPath);

  execFileSync('ffmpeg', args, { timeout: 900000, stdio: 'pipe' });
  const renderDur = Number(execFileSync('ffprobe', [
    '-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1', outPath
  ]).toString().trim());
  if (renderDur + 0.5 < audioDur) throw new Error('Render ' + renderDur + 's < audio ' + audioDur + 's');
  return { audioDur, renderDur };
}


export async function main() {
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Server credentials missing');
  fs.mkdirSync(TMP,{recursive:true});
  if(fs.existsSync(path.join(TMP,'manifest.json')))throw new Error('Unfinished render manifest: recover/upload it before creating a new job');
  await loadVaultEnv();
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  await archiveTerminalClaim(db,{root:TMP,backupRoot:path.resolve(TMP,'../.local-backups')});
  const mode=process.env.VIDEO_PUBLISH_MODE || 'review';
  if(!['review','website','distribute'].includes(mode))throw new Error('Invalid publish mode');
  const requested=process.env.ARTICLE_ID || null;
  if(requested && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested))throw new Error('Invalid article UUID');
  const {data:rows,error}=await db.rpc('claim_reviewed_video_job',{p_article_id:requested});
  if(error)throw new Error('Video claim failed: '+error.message);
  const claim=rows?.[0];
  if(!claim){console.log('No eligible unprocessed article or daily attempt budget exhausted; no publication claimed.');return;}
  if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+claim.claim_token);
  fs.writeFileSync(path.join(TMP,'claim.json'),JSON.stringify(claim),{mode:0o600});
  const folder=path.join(TMP,claim.job_id);
  fs.mkdirSync(folder,{recursive:true});
  try {
    const {data:article,error:articleError}=await db.from('articles').select('*').eq('id',claim.article_id).single();
    if(articleError)throw new Error('Claimed article missing');
    assertEditorial(article,mode);
    const script=buildVoiceScript(article);
    const contentKey=hash(article.content_bn.normalize('NFC').replace(/\s+/g,' ').trim());
    const story=await db.rpc('reserve_video_story',{p_job_id:claim.job_id,p_claim_token:claim.claim_token,p_content_key:contentKey,p_script_hash:hash(script),p_content_text:article.content_bn});
    if(story.error)throw new Error('Story reservation failed: '+story.error.message);
    const evidence=await refreshEvidence(article,mode);
    fs.writeFileSync(path.join(folder,'script.txt'),script,{mode:0o600});
    const audioPath=path.join(folder,'voice.mp3'),subPath=path.join(folder,'voice.vtt');
    const caption=await synthesizeVoice(script,audioPath,subPath);
    const duration=audioDuration(audioPath);
    if(duration+1.25<40 || duration+1.25>120)throw new Error('Factual narration outside 40–120s; do not invent filler');
    const media=await collectCommonsVideo(article,{folder,db,jobId:claim.job_id,claimToken:claim.claim_token});
    const overlay=path.join(folder,'overlay.png'),videoPath=path.join(folder,'final_output.mp4');
    renderOverlay(article.title_bn,overlay,{sourceName:article.source_name,media});
    const result=composeVideo(media.map(m=>m.path),audioPath,subPath,overlay,videoPath);
    const manifest={...claim,video_path:videoPath,audio_duration:result.audioDur,render_duration:result.renderDur,size_bytes:fs.statSync(videoPath).size,caption_method:caption.method,publish_mode:mode,evidence,media,content_key:contentKey,script_hash:hash(script),script_sha256:hash(script),closing_cta:CLOSING_CTA,synthetic_realistic:false,generated_at:new Date().toISOString()};
    const pending=path.join(TMP,'manifest.json.pending');
    fs.writeFileSync(pending,JSON.stringify(manifest,null,2),{mode:0o600});
    fs.renameSync(pending,path.join(TMP,'manifest.json'));
    console.log('Verified claim manifest ready for uploader; not yet published.');
  } catch(error) {
    // Keep claim + files for inspection/recovery; fence the failed attempt in DB.
    const failure=await db.rpc('fail_video_generation_job',{p_job_id:claim.job_id,p_claim_token:claim.claim_token,p_reason:String(error.message).slice(0,1000)});
    if(failure.error)console.error('Failed claim release; inspect lease in DB');
    throw error;
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
