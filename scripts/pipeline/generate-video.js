import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', '..', 'temp_assets');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

async function fetchArticle() {
  // published + বাংলা কন্টেন্ট আছে + এখনো videos টেবিলে নেই
  const { data: candidates, error } = await supabase
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
    const { data: existing } = await supabase
      .from('videos')
      .select('id')
      .eq('article_id', a.id)
      .limit(1);
    if (!existing?.length) return a;
  }
  return null;
}

function synthesizeVoice(text, audioPath, subPath) {
  const textPath = path.join(TMP, 'script.txt');
  fs.writeFileSync(textPath, text, 'utf8');
  for (const voice of ['bn-BD-PradeepNeural', 'bn-BD-NabanitaNeural']) {
    try {
      execFileSync('python3', ['-m', 'edge_tts',
        '--voice', voice, '--rate', '+5%',
        '--file', textPath,
        '--write-media', audioPath,
        '--write-subtitles', subPath,
      ], { timeout: 180000, stdio: 'pipe' });
      if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1024) {
        console.log('   ✅ Voice: ' + voice);
        return;
      }
    } catch (e) {
      console.log('   ⚠️  ' + voice + ' failed: ' + (e.stderr?.toString() || e.message));
    }
  }
  throw new Error('All TTS voices failed');
}

async function fetchMedia(article, count = 3) {
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
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const lines = wrapTitle(title);
  const font = "'Noto Sans Bengali','Lohit Bengali','SolaimanLipi',sans-serif";
  const boxTop = 1320 - (lines.length - 1) * 62;
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
    '[' + i + ':v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v' + i + ']'
  ).join(';');
  const concat = images.map((_, i) => '[v' + i + ']').join('');
  const ovIdx = images.length + 1;
  const hasSubs = fs.existsSync(subPath) && fs.statSync(subPath).size > 50;
  const subStep = hasSubs
    ? ';[withov]subtitles=filename=' + subPath.replace(/([:\\'])/g, '\\$1') +
      ":force_style='FontName=Noto Sans Bengali,FontSize=22,Outline=2,Shadow=1,Alignment=2,MarginV=140'[outv]"
    : ';[withov]null[outv]';

  const filter = parts + ';' + concat + 'concat=n=' + images.length + ':v=1:a=0[base];' +
    '[base][' + ovIdx + ':v]overlay=0:0:shortest=1[withov]' + subStep;
  args.push('-filter_complex', filter);
  args.push('-map', '[outv]', '-map', images.length + ':a');
  args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=1.25');
  args.push('-t', totalDur.toFixed(2));
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  args.push('-c:a', 'aac', '-b:a', '128k', outPath);

  execFileSync('ffmpeg', args, { timeout: 900000, stdio: 'pipe' });
  const renderDur = Number(execFileSync('ffprobe', [
    '-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1', outPath
  ]).toString().trim());
  if (renderDur + 0.5 < audioDur) throw new Error('Render ' + renderDur + 's < audio ' + audioDur + 's');
  return { audioDur, renderDur };
}

async function main() {
  console.log('🎬 BVAI Termux Render Pipeline\n');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY missing');
  if (!process.env.PIXABAY_API_KEY)
    console.log('⚠️  PIXABAY_API_KEY missing → thumbnail fallback');

  fs.mkdirSync(TMP, { recursive: true });

  const article = await fetchArticle();
  if (!article) { console.log('ℹ️  No pending published articles without video.'); return; }
  console.log('📰 ' + (article.title_bn || '').slice(0, 60));

  const audioPath = path.join(TMP, 'voice.mp3');
  const subPath = path.join(TMP, 'voice.vtt');
  const overlayPath = path.join(TMP, 'overlay.png');
  const videoPath = path.join(TMP, 'final_output.mp4');

  const text = (article.title_bn || '') + '। ' +
    (article.excerpt_bn || (article.content_bn || '').substring(0, 220));
  const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
  if (cleanText.length < 20) throw new Error('Script too short');

  console.log('\n🎙️  Voice...');
  synthesizeVoice(cleanText, audioPath, subPath);

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
