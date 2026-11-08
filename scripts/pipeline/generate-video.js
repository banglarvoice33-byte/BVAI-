const cfg = require('./config');

const VIDEO_CODEC = cfg.videoCodec();
const CODEC_OPTS = cfg.codecOptions().join(' ');
cfg.loadEnv();

/**
 * generate-video.js
 * ──────────────────
 * Article → AI script → Bengali voice → Slideshow MP4
 *
 * Usage:
 *   node scripts/pipeline/generate-video.js <article-id|--latest>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TMP = path.resolve(__dirname, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const OUTPUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUTPUT, { recursive: true });

// Env loaded via config

const { Client } = require('pg');
const PEXELS_KEY = process.env.PEXELS_API_KEY;
const DB = process.env.SUPABASE_DB_URL;

// ─── Helper: Fetch latest article ───
async function fetchArticle(client, arg) {
  let query, params;
  if (arg === '--latest') {
    query = `SELECT a.id, a.title_bn, a.content_bn, a.category AS category_key, a.thumbnail_url, a.published_at
             FROM public.articles a
             WHERE a.status = 'published' AND a.content_bn IS NOT NULL AND LENGTH(a.content_bn) > 200
               AND NOT EXISTS (SELECT 1 FROM public.videos v WHERE v.article_id = a.id)
             ORDER BY a.published_at DESC LIMIT 1`;
    params = [];
  } else {
    query = `SELECT id, title_bn, content_bn, category AS category_key, thumbnail_url, published_at
             FROM public.articles WHERE id = $1 AND status = 'published'`;
    params = [arg];
  }
  const { rows } = await client.query(query, params);
  return rows[0] || null;
}

// ─── Helper: Bengali script generation (multi-provider fallback) ───
const { generateScript } = require('./lib-generate-script');

// ─── Helper: edge-tts → Bengali voice ───
function synthesizeVoice(script, outPath) {
  console.log('🎙️  Synthesizing Bengali voice with timed captions...');
  const textFile = path.join(TMP, 'script.txt');
  const subtitlePath = path.join(TMP, 'voice.vtt');
  fs.writeFileSync(textFile, script, 'utf8');
  const runVoice = (voice) => execSync(
    `edge-tts --voice ${voice} --rate=+5% --file "${textFile}" --write-media "${outPath}" --write-subtitles "${subtitlePath}"`,
    { stdio: 'pipe' }
  );
  try {
    runVoice('bn-BD-PradeepNeural');
  } catch (e) {
    console.log('   ⚠️  Primary Bangla neural voice failed; switching to Nabanita...');
    runVoice('bn-BD-NabanitaNeural');
  }
  if (!fs.existsSync(subtitlePath) || fs.statSync(subtitlePath).size < 20) {
    throw new Error('Timed Bengali captions were not produced by edge-tts');
  }
  const size = fs.statSync(outPath).size;
  console.log('   ✅ Voice: ' + (size / 1024).toFixed(1) + ' KB; timed captions ready');
  return { voicePath: outPath, subtitlePath };
}

// ─── Helper: Pexels → background images ───
async function fetchImages(article, count = 3) {
  console.log('🖼️  Fetching ' + count + ' background images...');
  // Prefer Pexels stock imagery when configured. If the key is unavailable,
  // use the article's already-published thumbnail rather than failing the job
  // or inventing a visual that could misrepresent the report.
  if (!PEXELS_KEY) {
    if (!article.thumbnail_url) throw new Error('PEXELS_API_KEY is missing and article has no published thumbnail fallback');
    const response = await fetch(article.thumbnail_url);
    if (!response.ok) throw new Error(`Published article thumbnail fetch failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error('Published article thumbnail is empty or invalid');
    const imagePath = path.join(TMP, 'article-thumbnail.jpg');
    fs.writeFileSync(imagePath, buffer);
    console.log('   ⚠️  Using the published article thumbnail as a representative visual fallback');
    return Array.from({ length: count }, () => imagePath);
  }

  const query = encodeURIComponent(
    article.category_key === 'sports' ? 'bangladesh cricket'
    : article.category_key === 'politics' ? 'bangladesh parliament'
    : article.category_key === 'economy' ? 'dhaka city business'
    : article.category_key === 'international' ? 'middle east city skyline'
    : 'bangladesh news'
  );

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${query}&orientation=landscape&per_page=${count}`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
    const j = await res.json();
    if (!j.photos || j.photos.length === 0) throw new Error('Pexels returned no photos');
    const paths = [];
    for (let i = 0; i < Math.min(count, j.photos.length); i++) {
      const url = j.photos[i].src.large2x || j.photos[i].src.large;
      const imgPath = path.join(TMP, `bg-${i}.jpg`);
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`Pexels image fetch failed (${imgRes.status})`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      fs.writeFileSync(imgPath, buf);
      paths.push(imgPath);
      console.log('   ✅ Image ' + (i + 1) + ': ' + (buf.length / 1024).toFixed(0) + ' KB');
    }
    return paths;
  } catch (error) {
    if (!article.thumbnail_url) throw error;
    console.log('   ⚠️  Pexels unavailable; using published article thumbnail: ' + error.message);
    const response = await fetch(article.thumbnail_url);
    if (!response.ok) throw new Error(`Published article thumbnail fallback failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error('Published article thumbnail fallback is invalid');
    const imagePath = path.join(TMP, 'article-thumbnail.jpg');
    fs.writeFileSync(imagePath, buffer);
    return Array.from({ length: count }, () => imagePath);
  }
}

// ─── Helper: ffmpeg → slideshow MP4 ───
function composeVideo(images, voicePath, outPath, title, subtitlePath) {
  console.log('🎬 Composing animated, captioned Bengali MP4...');
  const audioDuration = Number(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`,
    { encoding: 'utf8' }
  ).trim());
  if (!Number.isFinite(audioDuration) || audioDuration < 1) throw new Error('Unable to determine Bengali narration duration');
  if (!fs.existsSync(subtitlePath)) throw new Error('Timed Bengali subtitle file is missing');

  const totalDuration = Math.ceil((audioDuration + 1.25) * 100) / 100;
  const durationPerImage = totalDuration / images.length;
  const args = [];
  for (const img of images) args.push(`-loop 1 -framerate 25 -t ${durationPerImage.toFixed(3)} -i "${img}"`);
  args.push(`-i "${voicePath}"`);

  // Break the Bengali headline at word boundaries to keep it readable on mobile.
  const words = String(title || '').split(/\\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (next.length > 32 && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  const titlePath = path.join(TMP, 'headline.txt');
  fs.writeFileSync(titlePath, lines.slice(0, 2).join('\\n'), 'utf8');
  const fontPath = '/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf';

  const motion = [
    "x='iw/2-(iw/zoom/2)+12*sin(on/55)':y='ih/2-(ih/zoom/2)'",
    "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+10*sin(on/60)'",
    "x='iw/2-(iw/zoom/2)-10*sin(on/65)':y='ih/2-(ih/zoom/2)'",
  ];
  const filterParts = images.map((_, i) =>
    `[${i}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00045,1.14)':${motion[i % motion.length]}:d=1:s=1280x720:fps=25,setsar=1[v${i}]`
  ).join(';');
  const concatInputs = images.map((_, i) => `[v${i}]`).join('');
  const overlay = `subtitles='${subtitlePath}':fontsdir='/usr/share/fonts/truetype/noto':force_style='FontName=Noto Sans Bengali,FontSize=24,Outline=2,Shadow=1,Alignment=2,MarginV=36',drawbox=x=0:y=0:w=iw:h=150:color=black@0.48:t=fill,drawtext=fontfile='${fontPath}':textfile='${titlePath}':fontcolor=white:fontsize=36:line_spacing=8:x=48:y=32`;
  const filter = `${filterParts};${concatInputs}concat=n=${images.length}:v=1:a=0,${overlay}[outv]`;
  const cmd = `ffmpeg -y ${args.join(' ')} -filter_complex "${filter}" -map "[outv]" -map ${images.length}:a -af "loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=1.25" -t ${totalDuration.toFixed(2)} -c:v ${VIDEO_CODEC} ${CODEC_OPTS} -c:a aac -b:a 128k -pix_fmt yuv420p "${outPath}" 2>&1 | tail -8`;

  try {
    execSync(cmd, { stdio: 'inherit', shell: cfg.shell() });
  } catch (e) {
    throw new Error('ffmpeg failed: ' + e.message);
  }

  const size = fs.statSync(outPath).size;
  const renderedDuration = Number(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outPath}"`,
    { encoding: 'utf8' }
  ).trim());
  if (!Number.isFinite(renderedDuration) || renderedDuration + 0.25 < audioDuration) {
    throw new Error(`Rendered video (${renderedDuration}s) is shorter than narration (${audioDuration}s)`);
  }
  console.log(`   ✅ Video: ${(size / 1024 / 1024).toFixed(2)} MB; narration ${audioDuration.toFixed(2)}s; render ${renderedDuration.toFixed(2)}s`);
  return outPath;
}

// ─── Main flow ───
async function main() {
  const arg = process.argv[2] || '--latest';
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  VIDEO GENERATOR — Article → MP4');
  console.log('══════════════════════════════════════');
  console.log('');

  if (!DB) {
    throw new Error('SUPABASE_DB_URL is not set');
  }

  const client = new Client({ connectionString: DB, ssl: { rejectUnauthorized: true } });
  await client.connect();

  // 1. Fetch article
  const article = await fetchArticle(client, arg);
  if (!article) {
    console.error('❌ No article found');
    await client.end();
    process.exit(1);
  }
  console.log('📰 Article: ' + article.title_bn.slice(0, 60));
  console.log('   Category: ' + article.category_key);
  console.log('');

  // 2. Generate script
  const script = await generateScript(article);
  console.log('');

  // 3. Synthesize voice
  const voicePath = path.join(TMP, 'voice.mp3');
  const voice = synthesizeVoice(script, voicePath);
  console.log('');

  // 4. Fetch images
  const images = await fetchImages(article, 3);
  console.log('');

  // 5. Compose video
  const slug = article.id.slice(0, 8);
  const outPath = path.join(OUTPUT, `video-${slug}.mp4`);
  composeVideo(images, voice.voicePath, outPath, article.title_bn, voice.subtitlePath);

  // 6. Save metadata
  const metaPath = path.join(OUTPUT, `video-${slug}.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    article_id: article.id,
    article_id_full: article.id,
    title_bn: article.title_bn,
    title_en: '',
    category: article.category_key,
    script_bn: script,
    video_path: outPath,
    generated_at: new Date().toISOString(),
  }, null, 2));

  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  ✅ VIDEO READY');
  console.log('══════════════════════════════════════');
  console.log('  Path: ' + outPath);
  console.log('  Meta: ' + metaPath);
  console.log('');

  await client.end();
}

main().catch(e => {
  console.error('');
  console.error('❌ FATAL:', e.message);
  process.exit(1);
});
