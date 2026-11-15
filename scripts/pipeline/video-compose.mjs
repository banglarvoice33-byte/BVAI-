// Vertical 1080×1920 / 30 fps / H.264 + AAC 48 kHz composition for Bengali news shorts.
// Pure ffmpeg + rsvg-convert (Bengali shaping via HarfBuzz). Fonts are shipped with the repo, so the
// renderer does not depend on what the CI image or Termux happens to have installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loudnormFilter, measureAudioAsync } from './audio-qc.mjs';
import { CTA } from './video-script.mjs';
import { MASTER_VIDEO_FILTER, MASTER_COLOR_ARGS } from './video-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_FONTS = path.resolve(HERE, '../../frontend/public/fonts');
export const FONT_FAMILY = 'Hind Siliguri';
export const W = 1080; export const H = 1920; export const FPS = 30;
export const END_CARD_SECONDS = 5.2;
const SYMBOLIC_LABEL = 'প্রতীকী ভিজ্যুয়াল';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('bn', { granularity: 'grapheme' }) : null;
const graphemeParts = (value) => segmenter
  ? Array.from(segmenter.segment(String(value).normalize('NFC')), (part) => part.segment)
  : Array.from(String(value).normalize('NFC'));

/** Bound every line, including an unbroken URL/word, without splitting Bengali grapheme clusters. */
export function wrapLines(text, maxLen, maxLines) {
  if (!Number.isInteger(maxLen) || maxLen < 2 || !Number.isInteger(maxLines) || maxLines < 1) throw new Error('Invalid headline line budget');
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean).flatMap((token) => {
    const chars = graphemeParts(token); const chunks = [];
    for (let i = 0; i < chars.length; i += maxLen) chunks.push(chars.slice(i, i + maxLen).join(''));
    return chunks;
  });
  const lines = []; let line = ''; let truncated = false;
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (line && graphemeParts(candidate).length > maxLen) {
      lines.push(line); line = '';
      if (lines.length === maxLines) { truncated = true; break; }
    }
    line = line ? `${line} ${token}` : token;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (truncated) lines[maxLines - 1] = graphemeParts(lines[maxLines - 1]).slice(0, maxLen - 1).join('').trimEnd() + '…';
  return lines.length ? lines : [''];
}

/** fontconfig profile: repo fonts + system fonts, with a private cache, so rsvg/libass always find Bengali glyphs. */
export function prepareFonts(jobDir) {
  const fontsDir = path.join(jobDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  for (const file of fs.existsSync(REPO_FONTS) ? fs.readdirSync(REPO_FONTS).filter((f) => /^HindSiliguri-.*\.ttf$/.test(f)) : []) fs.copyFileSync(path.join(REPO_FONTS, file), path.join(fontsDir, file));
  if (!fs.readdirSync(fontsDir).length) throw new Error('Bundled Bengali fonts missing (frontend/public/fonts/HindSiliguri-*.ttf)');
  const conf = path.join(jobDir, 'fonts.conf');
  fs.writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include>
<include ignore_missing="yes">/data/data/com.termux/files/usr/etc/fonts/fonts.conf</include>
<dir>${esc(fontsDir)}</dir><cachedir>${esc(path.join(jobDir, 'fc-cache'))}</cachedir></fontconfig>`);
  return { fontsDir, env: { ...process.env, FONTCONFIG_FILE: conf } };
}

const FONT = `'${FONT_FAMILY}','Noto Sans Bengali','Lohit Bengali',sans-serif`;
function svgToPng(svg, outFile, env) {
  if (!outFile.endsWith('.png')) throw new Error('Overlay output must be a PNG');
  const svgFile = outFile.replace(/\.png$/, '.svg');
  fs.writeFileSync(svgFile, svg, 'utf8');
  try {
    execFileSync('rsvg-convert', ['-f', 'png', '-w', String(W), '-h', String(H), '-o', outFile, svgFile], { timeout: 60000, env });
  } finally { fs.rmSync(svgFile, { force: true }); }
}
const svg = (inner) => `<?xml version="1.0" encoding="UTF-8"?><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>
<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
<linearGradient id="bot" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".72"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>${inner}</svg>`;
const text = (x, y, size, fill, content, { weight = 'normal', anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`;

/** Persistent layer: brand, honest "symbolic visual" label, and the credited source. */
export function renderBrandOverlay(outFile, { sourceName }, env) {
  const source = sourceName ? `সূত্র: ${sourceName}` : '';
  svgToPng(svg(
    `<rect x="0" y="0" width="${W}" height="330" fill="url(#top)"/><rect x="0" y="${H - 260}" width="${W}" height="260" fill="url(#bot)"/>`
    + `<rect x="40" y="62" rx="14" width="318" height="76" fill="#D50032"/>${text(199, 115, 40, '#fff', 'বাংলার ভয়েস', { weight: 'bold', anchor: 'middle' })}`
    + `<rect x="620" y="62" rx="14" width="420" height="76" fill="#FFB300"/>${text(830, 115, 38, '#1a1a1a', SYMBOLIC_LABEL, { weight: 'bold', anchor: 'middle' })}`
    + (source ? text(48, H - 52, 34, '#fff', source, { weight: 'bold' }) : ''),
  ), outFile, env);
}
export function renderHeadlineBig(outFile, title, env) {
  const lines = wrapLines(title, 23, 4); const top = 200; const height = 56 + lines.length * 72;
  svgToPng(svg(`<rect x="36" y="${top}" rx="22" width="1008" height="${height}" fill="#000" fill-opacity=".74"/><rect x="36" y="${top}" width="14" height="${height}" fill="#D50032"/>`
    + lines.map((l, i) => text(78, top + 78 + i * 72, 56, '#fff', l, { weight: 'bold' })).join('')), outFile, env);
}
export function renderHeadlineSmall(outFile, title, env) {
  const lines = wrapLines(title, 36, 2); const top = 168; const height = 34 + lines.length * 52;
  svgToPng(svg(`<rect x="36" y="${top}" rx="16" width="1008" height="${height}" fill="#000" fill-opacity=".58"/>`
    + lines.map((l, i) => text(66, top + 56 + i * 52, 40, '#fff', l, { weight: 'bold' })).join('')), outFile, env);
}
export function renderEndCard(outFile, { host }, env) {
  const [a, b] = CTA.replace(/।$/, '').split(' বাংলার ভয়েস ');
  svgToPng(svg(`<rect x="0" y="0" width="${W}" height="${H}" fill="#050C1C" fill-opacity=".86"/>`
    + text(W / 2, 640, 74, '#fff', a, { weight: 'bold', anchor: 'middle' })
    + text(W / 2, 780, 112, '#FF3B4E', 'বাংলার ভয়েস', { weight: 'bold', anchor: 'middle' })
    + text(W / 2, 900, 64, '#fff', b, { weight: 'bold', anchor: 'middle' })
    + (host ? text(W / 2, 1000, 46, '#FFB300', host, { weight: 'bold', anchor: 'middle' }) : '')), outFile, env);
}
export function renderCreditStrip(outFile, creditLine, env) {
  const line = [...creditLine].slice(0, 78).join('');
  svgToPng(svg(`<rect x="36" y="${H - 168}" rx="12" width="1008" height="52" fill="#000" fill-opacity=".55"/>${text(54, H - 131, 26, '#fff', line)}`), outFile, env);
}

function threads() {
  const value = Number(process.env.VIDEO_THREADS || 2);
  if (!Number.isInteger(value) || value < 1 || value > 16) throw new Error('VIDEO_THREADS must be an integer from 1 to 16');
  return String(value);
}
function encoderArgs() {
  const preset = process.env.VIDEO_X264_PRESET || process.env.VIDEO_ENCODER_PRESET || process.env.VIDEO_PRESET || 'veryfast';
  if (!['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'].includes(preset)) throw new Error('Invalid x264 preset');
  return ['-c:v', 'libx264', '-preset', preset, '-crf', '21', '-threads', threads(), '-r', String(FPS), ...MASTER_COLOR_ARGS];
}
const execFileAsync = promisify(execFile);
const run = (args, opts = {}) => execFileAsync('ffmpeg', ['-nostdin', '-y', '-hide_banner', '-v', 'error',
  '-filter_threads', threads(), '-filter_complex_threads', threads(), ...args], { timeout: 900000, maxBuffer: 8 * 1024 * 1024, stdio: 'pipe', ...opts });
function validDuration(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 120) throw new Error('Render duration must be finite and within (0, 120] seconds');
  return value.toFixed(3);
}

/** One B-roll slot → 1080×1920 silent segment: blurred full-bleed backdrop + fitted foreground with slow push-in. */
export async function renderSegment({ kind, file, duration, creditPng, outFile, env, signal }) {
  const d = validDuration(duration);
  if (duration < 1 / FPS) throw new Error('Segment must contain at least one frame');
  if (!['image', 'video', 'brand'].includes(kind)) throw new Error('Unsupported segment kind');
  const input = kind === 'image' ? ['-loop', '1', '-framerate', String(FPS), '-t', d, '-i', file]
    : kind === 'video' ? ['-stream_loop', '-1', '-t', d, '-i', file]
      : ['-f', 'lavfi', '-t', d, '-i', `gradients=s=${W}x${H}:c0=0x0b1f3a:c1=0x6e0f2b:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.015:rate=${FPS}`];
  const base = kind === 'brand'
    ? `[0:v]${MASTER_VIDEO_FILTER}[m0]`
    : `[0:v]fps=${FPS},setpts=PTS-STARTPTS,scale=w='max(2,trunc(iw*sar/2)*2)':h=ih,setsar=1,${MASTER_VIDEO_FILTER},split=2[bgsrc][fgsrc];`
    + `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=34:4,eq=brightness=-0.16:saturation=0.9[bg];`
    + `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,`
    + `scale=w='max(2,trunc(iw*(0.94+0.06*t/${d})/2)*2)':h='max(2,trunc(ih*(0.94+0.06*t/${d})/2)*2)':eval=frame[fg];`
    + `[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2':shortest=1[m0]`;
  const filter = `${base};[m0][1:v]overlay=0:0:format=auto,fps=${FPS},${MASTER_VIDEO_FILTER}[out]`;
  await run([...input, '-loop', '1', '-framerate', String(FPS), '-i', creditPng, '-filter_complex', filter, '-map', '[out]', '-t', d,
    ...encoderArgs(), '-an', outFile], { env, signal });
}

let shapingSupport;
/**
 * Bengali needs libass' COMPLEX (HarfBuzz) shaper. The `subtitles` filter has no switch and defaults to simple shaping, which
 * mis-orders pre-base vowel signs (দেশের renders as দশেরে). The `ass` filter exposes `shaping=complex`.
 */
export function assComplexShapingSupported() {
  if (shapingSupport === undefined) {
    try { shapingSupport = /\bshaping\b/.test(execFileSync('ffmpeg', ['-hide_banner', '-h', 'filter=ass'], { encoding: 'utf8', timeout: 20000 })); }
    catch { shapingSupport = false; }
  }
  return shapingSupport;
}

/** Final pass: concat → overlays → burned karaoke captions → two-pass loudness-normalised AAC. */
export async function composeFinal({ jobDir, segments, audioPath, assFile, overlays, total, outFile, env, fontsDir, signal }) {
  validDuration(total);
  if (path.extname(outFile) !== '.mp4') throw new Error('Final output must be an MP4');
  if (!Array.isArray(segments) || !segments.length) throw new Error('At least one rendered segment required');
  for (const file of [...segments, audioPath, assFile, ...Object.values(overlays), outFile]) {
    if (path.dirname(path.resolve(file)) !== path.resolve(jobDir)) throw new Error('Composition inputs and output must be inside the job directory');
    // These local basenames are embedded in concat/filter syntax, not shell syntax.
    if (!/^[a-zA-Z0-9_.-]+$/.test(path.basename(file))) throw new Error('Unsafe composition filename');
  }
  if (path.dirname(path.resolve(fontsDir)) !== path.resolve(jobDir) || !/^[a-zA-Z0-9_.-]+$/.test(path.basename(fontsDir))) throw new Error('Unsafe fonts directory');
  const list = path.join(jobDir, 'segments.txt');
  fs.writeFileSync(list, segments.map((s) => `file '${path.basename(s).replace(/'/g, "'\\''")}'`).join('\n'));
  // Measure on the exact channel layout/sample rate that ships: mono→stereo adds ~3 LU.
  const stereo = path.join(jobDir, 'voice_stereo.wav');
  await run(['-i', audioPath, '-vn', '-ac', '2', '-ar', '48000', stereo], { env, signal });
  const measured = await measureAudioAsync(stereo, undefined, { signal });
  const endStart = Math.max(0, total - END_CARD_SECONDS).toFixed(3);
  // Only the MP4 is uploaded today: a local sidecar is not a delivered caption track.
  // Refuse a silent degradation to captionless publication when complex shaping is unavailable.
  const burnCaptions = assComplexShapingSupported();
  if (!burnCaptions) throw new Error('Bengali captions require FFmpeg with libass shaping=complex; upgrade FFmpeg before rendering');
  const filter = `[0:v][2:v]overlay=0:0:format=auto[a];[a][3:v]overlay=0:0:format=auto:enable='lt(t,5)'[b];`
    + `[b][4:v]overlay=0:0:format=auto:enable='gte(t,5)'[c];[c][5:v]overlay=0:0:format=auto:enable='gte(t,${endStart})'[d];`
    + `[d]ass=filename=${path.basename(assFile)}:fontsdir=${path.basename(fontsDir)}:shaping=complex[e];`
    + `[e]${MASTER_VIDEO_FILTER}[v];`
    + `[1:a]${loudnormFilter(measured)},aresample=48000,apad=whole_dur=${total.toFixed(3)}[a]`;
  const png = (f) => ['-loop', '1', '-framerate', String(FPS), '-t', total.toFixed(3), '-i', f];
  // Commit the final filename only after the encoder exits successfully. Never expose a partial master.
  const pending = path.join(jobDir, `${path.basename(outFile, '.mp4')}.partial.mp4`);
  try {
    await run(['-f', 'concat', '-safe', '0', '-i', path.basename(list), '-i', path.basename(stereo),
      ...png(overlays.brand), ...png(overlays.headBig), ...png(overlays.headSmall), ...png(overlays.endCard),
      '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3),
      ...encoderArgs(),
      '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', path.basename(pending)], { env, cwd: jobDir, signal });
    fs.renameSync(pending, outFile);
  } finally { fs.rmSync(pending, { force: true }); }
  return { measured, burnCaptions };
}

export function probeDuration(file) {
  const value = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8', timeout: 20000 }).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid media duration');
  return value;
}
