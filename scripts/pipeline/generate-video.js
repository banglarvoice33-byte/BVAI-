import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import { synthesizeVoiceRouted } from './tts-router.js';
import { loadVaultEnv } from './load-vault-env.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', '..', 'temp_assets');
let supabase;

function db() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
}

async function fetchArticle() {
  const { data: candidates, error } = await db()
    .from('articles')
    .select('id, title_bn, content_bn, excerpt_bn, category, category_key, thumbnail_url, published_at, status')
    .eq('status', 'published')
    .not('content_bn', 'is', null)
    .order('published_at', { ascending: false })
    .limit(20);
  if (error) throw new Error('Article fetch: ' + error.message);
  if (!candidates?.length) return null;

  for (const a of candidates) {
    if (!a.content_bn || a.content_bn.length < 80) continue;
    const { data: existing } = await db()
      .from('videos')
      .select('id')
      .eq('article_id', a.id)
      .limit(1);
    if (!existing?.length) return a;
  }
  return null;
}

async function synthesizeVoice(text, audioPath, subPath) {
  const textPath = path.join(TMP, 'script.txt');
  fs.writeFileSync(textPath, text, 'utf8');
  let routerDur = null;
  let routerOk = false;
  try {
    const r = await synthesizeVoiceRouted(text, { outFile: audioPath });
    console.log('   ✅ Voice via router: ' + r.provider);
    routerOk = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1024;
    if (routerOk) {
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync('python3', ['scripts/pipeline/whisper-caption.py', audioPath, subPath, text], { timeout: 120000, stdio: 'pipe' });
        if (fs.existsSync(subPath) && fs.statSync(subPath).size > 100) { console.log('   ✅ VTT via Groq Whisper (permanent)'); return; }
      } catch(e) { console.log('   ⚠️  Groq Whisper failed, fallback to edge'); }
    }
    if (routerOk) {
      try {
        const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath], { encoding: 'utf8' });
        routerDur = parseFloat(d.trim());
      } catch {}
    }
  } catch (e) {
    console.log('   ⚠️  Router failed, edge-tts fallback: ' + e.message);
  }
  const tmpAudio = path.join(TMP, 'edge_tmp.mp3');
  const tmpVtt = path.join(TMP, 'edge_tmp.vtt');
  let edgeOk = false;
  for (const voice of ['bn-BD-PradeepNeural', 'bn-BD-NabanitaNeural']) {
    try {
      execFileSync('python3', ['-m', 'edge_tts', '--voice', voice, '--rate', '-8%', '--pitch', '-2Hz', '--volume', '+5%', '--file', textPath, '--write-media', tmpAudio, '--write-subtitles', tmpVtt], { timeout: 180000, stdio: 'pipe' });
      if (fs.existsSync(tmpVtt) && fs.statSync(tmpVtt).size > 100) { edgeOk = true; console.log('   ✅ VTT via edge: ' + voice); break; }
    } catch (e) { console.log('   ⚠️  ' + voice + ' VTT failed: ' + (e.stderr?.toString() || e.message)); }
  }
  if (!routerOk) {
    if (fs.existsSync(tmpAudio) && fs.statSync(tmpAudio).size > 1024 && edgeOk) {
      fs.copyFileSync(tmpAudio, audioPath);
      fs.copyFileSync(tmpVtt, subPath);
      console.log('   ✅ Voice: edge-tts fallback');
      return;
    }
    throw new Error('All TTS voices failed');
  }
  if (edgeOk) {
    let edgeDur = null;
    try {
      const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', tmpAudio], { encoding: 'utf8' });
      edgeDur = parseFloat(d.trim());
    } catch {}
    if (edgeDur && routerDur) {
      const scale = routerDur / edgeDur;
      let vtt = fs.readFileSync(tmpVtt, 'utf8');
      vtt = vtt.replace(/(\d+):(\d+):(\d+\.\d+)/g, (m, h, mi, s) => {
        const total = parseInt(h) * 3600 + parseInt(mi) * 60 + parseFloat(s);
        const sc = total * scale;
        const hh = String(Math.floor(sc / 3600)).padStart(2, '0');
        const mm = String(Math.floor((sc % 3600) / 60)).padStart(2, '0');
        const ss = (sc % 60).toFixed(3).padStart(6, '0');
        return hh + ':' + mm + ':' + ss;
      });
      fs.writeFileSync(subPath, vtt, 'utf8');
      console.log('   ✅ VTT scaled x' + scale.toFixed(2));
    } else {
      fs.copyFileSync(tmpVtt, subPath);
    }
  } else {
    const sentences = text.match(/[^।!?\.\n]+[।!?\.]?/g) || [text];
    const total = routerDur || 50;
    const per = total / Math.max(1, sentences.length);
    let out = 'WEBVTT\n\n';
    sentences.forEach((s, i) => {
      const st = i * per, en = (i + 1) * per;
      const fmt = (x) => {
        const hh = String(Math.floor(x / 3600)).padStart(2, '0');
        const mm = String(Math.floor((x % 3600) / 60)).padStart(2, '0');
        const ss = (x % 60).toFixed(3).padStart(6, '0');
        return hh + ':' + mm + ':' + ss;
      };
      out += fmt(st) + ' --> ' + fmt(en) + '\n' + s.trim() + '\n\n';
    });
    fs.writeFileSync(subPath, out, 'utf8');
    console.log('   ✅ Estimated VTT: ' + sentences.length + ' sentences');
  }
  try { fs.unlinkSync(tmpAudio); fs.unlinkSync(tmpVtt); } catch {}
}

async function fetchMedia(article, count = 3) {
  const PIXABAY_KEY = process.env.PIXABAY_API_KEY;
  const key = article.category_key || article.category || '';
  const QUERIES = {
    sports: 'cricket stadium', খেলা: 'cricket stadium',
    politics: 'parliament building', রাজনীতি: 'parliament building',
    economy: 'stock market', অর্থনীতি: 'stock market',
    international: 'world city skyline', আন্তর্জাতিক: 'world city skyline',
    entertainment: 'cinema theater', বিনোদন: 'cinema theater',
    technology: 'technology computer', প্রযুক্তি: 'technology computer',
    national: 'dhaka bangladesh', জাতীয়: 'dhaka bangladesh', জাতীয়: 'dhaka bangladesh',
  };
  const q = QUERIES[key] || 'bangladesh news';

  const fallback = async (reason) => {
    if (!article.thumbnail_url) throw new Error(reason + '; no thumbnail');
    console.log('   ⚠️  Fallback: ' + reason);
    const r = await fetch(article.thumbnail_url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'BVAI/1.0 (https://bvai-chi.vercel.app; contact@bvai.local)', 'Accept': 'image/*,*/*' }, redirect: 'follow' });
    if (!r.ok) throw new Error('Thumbnail HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const p = path.join(TMP, 'thumb.jpg');
    fs.writeFileSync(p, buf);
    return Array(count).fill(p);
  };

  if (!PIXABAY_KEY) return fallback('PIXABAY_API_KEY missing');

  try {
    const url = 'https://pixabay.com/api/videos/?key=' + encodeURIComponent(PIXABAY_KEY) +
      '&q=' + encodeURIComponent(q) + '&per_page=' + (count + 2) +
      '&video_type=film&safesearch=true&order=popular';
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const hits = data.hits || [];
    if (!hits.length) throw new Error('No results');

    const paths = [];
    for (let i = 0; i < hits.length && paths.length < count; i++) {
      const v = hits[i].videos || {};
      const dl = ['large', 'medium', 'small', 'tiny'].map(k => v[k]?.url).find(Boolean);
      if (!dl) continue;
      try {
        const vr = await fetch(dl, { signal: AbortSignal.timeout(60000) });
        if (!vr.ok) continue;
        const buf = Buffer.from(await vr.arrayBuffer());
        if (buf.length < 50000) continue;
        const p = path.join(TMP, 'bg-' + paths.length + '.mp4');
        fs.writeFileSync(p, buf);
        paths.push(p);
        console.log('   ✅ Clip ' + paths.length + ': ' + (buf.length / 1e6).toFixed(2) + ' MB');
      } catch (_) {}
    }
    if (!paths.length) throw new Error('No downloads');
    while (paths.length < count) paths.push(paths[paths.length - 1]);
    return paths;
  } catch (e) {
    return fallback('Pixabay: ' + e.message);
  }
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

function renderOverlay(title, outPath) {
  const esc = s => String(s).replace(/&/g,'&').replace(/</g,'<')
    .replace(/>/g,'>').replace(/"/g,'"').replace(/'/g,''');
  const lines = wrapTitle(title);
  const font = "'Noto Sans Bengali','Lohit Bengali','SolaimanLipi',sans-serif";
  const boxTop = 120;
  const boxH = 200 + lines.length * 62;
  const tspans = lines.map((l, i) =>
    '<tspan x="90" dy="' + (i === 0 ? 0 : 62) + '">' + esc(l) + '</tspan>'
  ).join('');
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="50" y="' + boxTop + '" width="980" height="' + boxH + '" rx="20" fill="#000" fill-opacity="0.85"/>' +
    '<text x="90" y="' + (boxTop + 50) + '" font-family="' + font + '" font-size="34" font-weight="bold" fill="#FF1744">বাংলার ভয়েস | BREAKING NEWS</text>' +
    '<text x="90" y="' + (boxTop + 110) + '" font-family="' + font + '" font-size="44" font-weight="bold" fill="#FFFFFF">' + tspans + '</text>' +
    '</svg>';
  const svgPath = path.join(TMP, 'overlay.svg');
  fs.writeFileSync(svgPath, svg, 'utf8');
  try {
    execFileSync('rsvg-convert', ['-f', 'png', '-o', outPath, svgPath], { timeout: 60000 });
    console.log('   ✅ rsvg-convert OK');
  } catch (e) {
    console.log('   ⚠️  rsvg-convert failed → ffmpeg fallback');
    execFileSync('ffmpeg', ['-y', '-i', svgPath, outPath], { timeout: 60000, stdio: 'inherit' });
  }
}

function composeVideo(images, audioPath, subPath, overlayPath, outPath) {
  const audioDur = Number(execFileSync('ffprobe', [
    '-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1', audioPath
  ]).toString().trim());
  if (!Number.isFinite(audioDur) || audioDur < 1) throw new Error('Bad audio duration');

  const totalDur = Math.ceil((audioDur + 1.25) * 100) / 100;
  const per = totalDur / images.length;
  const args = [];
  for (const img of images) {
    if (/\.mp4$/i.test(img)) args.push('-stream_loop','-1','-t',per.toFixed(3),'-i',img);
    else args.push('-loop','1','-framerate','25','-t',per.toFixed(3),'-i',img);
  }
  args.push('-i', audioPath);
  args.push('-loop','1','-framerate','25','-t',totalDur.toFixed(3),'-i',overlayPath);

  const parts = images.map((_, i) =>
    '[' + i + ':v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v' + i + ']'
  ).join(';');
  const concat = images.map((_, i) => '[v' + i + ']').join('');
  const ovIdx = images.length + 1;
  const assPath = subPath.replace(/\.vtt$/i, '.ass');
  try { if (fs.existsSync(subPath) && fs.statSync(subPath).size > 50) execFileSync('python3', [path.join(__dirname, 'vtt-to-karaoke.py'), subPath, assPath], { timeout: 60000, stdio: 'pipe' }); } catch (e) { console.log('   ⚠️  karaoke convert failed: ' + e.message); }
  const hasSubs = fs.existsSync(assPath) && fs.statSync(assPath).size > 50;
  const subStep = hasSubs
    ? ';[withov]subtitles=filename=' + assPath.replace(/([:\\'])/g, '\\$1') +
      "[outv]"
    : ';[withov]null[outv]';

  const filter = parts + ';' + concat + 'concat=n=' + images.length + ':v=1:a=0[base];' +
    '[base][' + ovIdx + ':v]overlay=0:0:enable=\'between(t,0,2.5)\'[withov]' + subStep;
  args.push('-filter_complex', filter);
  args.push('-map', '[outv]', '-map', images.length + ':a');
  args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=1.25');
  args.push('-t', totalDur.toFixed(2));
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '26');
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  args.push('-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2', outPath);

  execFileSync('ffmpeg', args, { timeout: 900000, stdio: 'pipe' });
  const renderDur = Number(execFileSync('ffprobe', [
    '-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1', outPath
  ]).toString().trim());
  if (renderDur + 0.5 < audioDur) throw new Error('Render ' + renderDur + 's < audio ' + audioDur + 's');
  return { audioDur, renderDur };
}

function buildVoiceScript(article) {
  const bnDigits = (s) => String(s).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[+d]);
  const clean = (s) => (s||'').replace(/https?:\/\/\S+/g,'').replace(/[\(\)\[\]\{\}<>"'“”‘’]/g,'').replace(/\s+/g,' ').trim();
  const title = clean(article.title_bn);
  const body = clean(article.content_bn || article.excerpt_bn || '');
  const cat = (article.category_key || article.category || '').toLowerCase();
  const isWar = /war|যুদ্ধ|international|আন্তর্জাতিক|politics|রাজনীতি/.test(cat + title + body);
  const isSport = /sport|খেলা|cricket|football/.test(cat + title + body);
  const isDisaster = /দুর্যোগ|মৃত্যু|দুর্ঘটনা|ভূমিকম্প|বন্যা/.test(title + body);
  const rawSent = body.split(/(?<=[।!?])\s*/).map(s=>s.trim()).filter(Boolean);
  const short = [];
  for (const s of rawSent) {
    const words = s.split(/\s+/);
    if (words.length <= 14) short.push(s);
    else {
      const parts = s.split(/,\s*/);
      for (const pt of parts) if (pt.trim()) short.push(pt.trim() + '।');
    }
    if (short.length >= 6) break;
  }
  const hook = `আজ ${bnDigits(new Date().toLocaleDateString('bn-BD',{day:'numeric', month:'long'}))}, ${title.split('।')[0]}।`;
  const lead = short[0] || title;
  const body2 = short.slice(1,4).join(' ');
  const impact = isDisaster ? 'এর ফলে সাধারণ মানুষের উপর বড় প্রভাব পড়েছে।' : isWar ? 'এর ফলে পরিস্থিতি আরও জটিল হয়েছে।' : isSport ? 'এই ফলাফল নিয়ে সমর্থকদের মধ্যে আনন্দ ছড়িয়ে পড়েছে।' : 'এই ঘটনা নিয়ে আলোচনা চলছে।';
  const next = 'পরবর্তী আপডেটের জন্য চোখ রাখুন বাংলার ভয়েসে।';
  let script = [hook, lead, body2, impact, next, 'বিস্তারিত দেখুন বাংলার ভয়েস ওয়েবসাইটে।'].join(' ');
  script = bnDigits(script);
  if (script.length > 780) {
    script = script.slice(0,780);
    const last = script.lastIndexOf('।');
    if (last > 400) script = script.slice(0, last+1);
  }
  console.log('   🎙️ Script v2: ' + script.length + ' chars, tone=' + (isWar?'গম্ভীর':isSport?'উজ্জীবিত':isDisaster?'উদ্বেগ':'দৃঢ়'));
  return script;
}

async function main() {
  console.log('🎬 BVAI Termux Render Pipeline\n');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY missing');

  // Supabase Vault is the primary secret store; GitHub env is optional override.
  await loadVaultEnv();

  if (!process.env.PIXABAY_API_KEY)
    console.log('⚠️  PIXABAY_API_KEY missing → thumbnail fallback');
  if (!process.env.GROQ_API_KEY)
    console.log('⚠️  GROQ_API_KEY missing after vault hydrate → Whisper caption may fall back');

  fs.mkdirSync(TMP, { recursive: true });

  const article = await fetchArticle();
  if (!article) { console.log('ℹ️  No pending published articles without video.'); return; }
  console.log('📰 ' + (article.title_bn || '').slice(0, 60));

  const audioPath = path.join(TMP, 'voice.mp3');
  const subPath = path.join(TMP, 'voice.vtt');
  const overlayPath = path.join(TMP, 'overlay.png');
  const videoPath = path.join(TMP, 'final_output.mp4');

  const cleanText = buildVoiceScript(article);
  if (cleanText.length < 20) throw new Error('Script too short');

  console.log('\n🎙️  Voice...');
  await synthesizeVoice(cleanText, audioPath, subPath);

  console.log('\n🎞️  Media...');
  const media = await fetchMedia(article, 3);

  console.log('\n🎨 Overlay...');
  renderOverlay(article.title_bn || '', overlayPath);

  console.log('\n🎬 Compose...');
  const { audioDur, renderDur } = composeVideo(media, audioPath, subPath, overlayPath, videoPath);

  const size = fs.statSync(videoPath).size;
  console.log('\n✅ Video: ' + (size / 1e6).toFixed(2) + ' MB, ' + renderDur + 's');

  const manifest = {
    article_id: article.id,
    video_path: videoPath,
    audio_duration: audioDur,
    render_duration: renderDur,
    size_bytes: size,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(TMP, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('📄 Manifest written');
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
