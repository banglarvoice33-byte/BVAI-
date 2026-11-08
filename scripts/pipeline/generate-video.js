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
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TMP = path.resolve(__dirname, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const OUTPUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUTPUT, { recursive: true });

// Env loaded via config

const { Client } = require('pg');
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;
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

// ─── Helper: Pixabay Videos API → background video clips ───
async function fetchImages(article, count = 3) {
  console.log('🎞️  Fetching ' + count + ' Pixabay background video clips...');
  const fallbackToThumbnail = async (reason) => {
    if (!article.thumbnail_url) throw new Error(reason + '; article has no published thumbnail fallback');
    const response = await fetch(article.thumbnail_url);
    if (!response.ok) throw new Error(`Published article thumbnail fallback failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error('Published article thumbnail fallback is empty or invalid');
    const imagePath = path.join(TMP, 'article-thumbnail.jpg');
    fs.writeFileSync(imagePath, buffer);
    console.log('   ⚠️  Using the published article thumbnail fallback: ' + reason);
    return Array.from({ length: count }, () => imagePath);
  };
  if (!PIXABAY_KEY) return fallbackToThumbnail('PIXABAY_API_KEY is not configured');
  const query = article.category_key === 'sports' ? 'cricket stadium sports'
    : article.category_key === 'politics' ? 'parliament government building'
    : article.category_key === 'economy' ? 'city business stock market'
    : article.category_key === 'international' ? 'world city skyline'
    : 'Bangladesh Dhaka city';
  try {
    const apiUrl = `https://pixabay.com/api/videos/?key=${encodeURIComponent(PIXABAY_KEY)}&q=${encodeURIComponent(query)}&per_page=3`;
    const response = await fetch(apiUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Pixabay Videos API HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.hits) || payload.hits.length === 0) throw new Error('Pixabay Videos API returned no matching clips');
    const paths = [];
    for (let i = 0; i < Math.min(count, payload.hits.length); i++) {
      const variants = payload.hits[i].videos || {};
      const selected = ['large', 'medium', 'small', 'tiny'].map((quality) => variants[quality] && variants[quality].url).find(Boolean);
      if (!selected) continue;
      const videoResponse = await fetch(selected, { signal: AbortSignal.timeout(60000) });
      if (!videoResponse.ok) throw new Error(`Pixabay clip download failed (${videoResponse.status})`);
      const buffer = Buffer.from(await videoResponse.arrayBuffer());
      if (buffer.length < 1024) throw new Error('Pixabay returned an empty or invalid video file');
      const videoPath = path.join(TMP, `pixabay-bg-${i}.mp4`);
      fs.writeFileSync(videoPath, buffer);
      paths.push(videoPath);
      console.log('   ✅ Pixabay clip ' + (i + 1) + ': ' + (buffer.length / 1024 / 1024).toFixed(2) + ' MB');
    }
    if (paths.length === 0) throw new Error('Pixabay results contained no usable video URLs');
    while (paths.length < count) paths.push(paths[paths.length - 1]);
    return paths;
  } catch (error) {
    console.log('   ⚠️  Pixabay request/download failed: ' + error.message);
    return fallbackToThumbnail('Pixabay unavailable');
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
  for (const img of images) {
    const duration = durationPerImage.toFixed(3);
    if (/\.mp4$/i.test(img)) args.push(`-stream_loop -1 -t ${duration} -i "${img}"`);
    else args.push(`-loop 1 -framerate 25 -t ${duration} -i "${img}"`);
  }
  args.push(`-i "${voicePath}"`);

  // Shape Bengali with librsvg/Pango; FFmpeg only composites the rasterized PNG.
  function xmlEscape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  const words = String(title || '').trim().split(/\\s+/).filter(Boolean);
  const lines = [];
  let headlineLine = '';
  for (const word of words) {
    const candidate = headlineLine ? headlineLine + ' ' + word : word;
    if (candidate.length > 34 && headlineLine) { lines.push(headlineLine); headlineLine = word; }
    else headlineLine = candidate;
  }
  if (headlineLine) lines.push(headlineLine);
  const visibleLines = lines.slice(0, 2);
  const headlineSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="180" viewBox="0 0 1280 180">' +
    '<rect width="1280" height="180" fill="#07111f" fill-opacity="0.78"/>' +
    '<text x="48" y="34" font-family="Noto Sans Bengali" font-size="20" font-weight="700" fill="#ffcf4a">বাংলার ভয়েস | NEWS</text>' +
    visibleLines.map((line, index) =>
      '<text x="48" y="' + (88 + index * 48) + '" font-family="Noto Sans Bengali" font-size="36" font-weight="700" fill="#ffffff">' +
      xmlEscape(line) + '</text>'
    ).join('') + '</svg>';
  const svgPath = path.join(TMP, 'headline-overlay.svg');
  const overlayPath = path.join(TMP, 'headline-overlay.png');
  fs.writeFileSync(svgPath, headlineSvg, 'utf8');
  execFileSync('rsvg-convert', ['--format', 'png', '--output', overlayPath, svgPath]);
  if (!fs.existsSync(overlayPath) || fs.statSync(overlayPath).size < 512) {
    throw new Error('Pango/librsvg Bengali headline rasterization failed');
  }
  args.push(`-loop 1 -framerate 25 -t ${totalDuration.toFixed(3)} -i "${overlayPath}"`);

  const motion = [
    "x='iw/2-(iw/zoom/2)+12*sin(on/55)':y='ih/2-(ih/zoom/2)'",
    "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+10*sin(on/60)'",
    "x='iw/2-(iw/zoom/2)-10*sin(on/65)':y='ih/2-(ih/zoom/2)'",
  ];
  const filterParts = images.map((_, i) =>
    `[${i}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00045,1.14)':${motion[i % motion.length]}:d=1:s=1280x720:fps=25,setsar=1[v${i}]`
  ).join(';');
  const concatInputs = images.map((_, i) => `[v${i}]`).join('');
  const captions = `subtitles='${subtitlePath}':fontsdir='/usr/share/fonts/truetype/noto':force_style='FontName=Noto Sans Bengali,FontSize=24,Outline=2,Shadow=1,Alignment=2,MarginV=36'`;
  const overlayInput = images.length + 1;
  const filter = `${filterParts};${concatInputs}concat=n=${images.length}:v=1:a=0,${captions}[base];[base][${overlayInput}:v]overlay=0:0:shortest=1[outv]`;
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
  if (!DB) throw new Error('SUPABASE_DB_URL is not set');

  const client = new Client({
    connectionString: DB,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  await client.connect();
  try {
    const article = await fetchArticle(client, arg);
    if (!article) throw new Error('No article found for the claimed article ID');
    console.log('📰 Article: ' + article.title_bn.slice(0, 60));
    console.log('   Category: ' + article.category_key);

    const script = await generateScript(article);
    const voicePath = path.join(TMP, 'voice.mp3');
    const voice = synthesizeVoice(script, voicePath);
    const images = await fetchImages(article, 3);
    const slug = article.id.slice(0, 8);
    const outPath = path.join(OUTPUT, `video-${slug}.mp4`);
    composeVideo(images, voice.voicePath, outPath, article.title_bn, voice.subtitlePath);

    const metaPath = path.join(OUTPUT, `video-${slug}.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      article_id: article.id,
      title_bn: article.title_bn,
      title_en: '',
      category: article.category_key,
      script_bn: script,
      video_path: outPath,
      generated_at: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });

    console.log('VIDEO_READY=' + outPath);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(error => {
  console.error('FATAL:', error.message);
  process.exitCode = 1;
});
