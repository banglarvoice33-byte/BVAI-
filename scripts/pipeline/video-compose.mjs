// Vertical 1080×1920 / 30 fps / H.264 + AAC 48 kHz composition for Bengali news shorts.
// Pure ffmpeg + rsvg-convert (Bengali shaping via HarfBuzz). Fonts are shipped with the repo, so the
// renderer does not depend on what the CI image or Termux happens to have installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loudnormFilter, measureAudio } from './audio-qc.mjs';
import { CTA } from './video-script.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_FONTS = path.resolve(HERE, '../../frontend/public/fonts');
export const FONT_FAMILY = 'Hind Siliguri';
export const W = 1080; export const H = 1920; export const FPS = 30;
export const END_CARD_SECONDS = 5.2;
const SYMBOLIC_LABEL = 'প্রতীকী ভিজ্যুয়াল';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const graphemes = (s) => {
  try { return [...new Intl.Segmenter('bn', { granularity: 'grapheme' }).segment(String(s))].length; } catch { return [...String(s).normalize('NFC')].length; }
};
export function wrapLines(text, maxLen, maxLines) {
  const lines = []; let line = '';
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const candidate = line ? `${line} ${tokens[i]}` : tokens[i];
    if (graphemes(candidate) > maxLen && line) {
      lines.push(line); line = tokens[i];
      if (lines.length === maxLines - 1) { line = tokens.slice(i).join(' '); break; }
    } else line = candidate;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines && graphemes(lines[maxLines - 1]) > maxLen) {
    const chars = [...new Intl.Segmenter('bn', { granularity: 'grapheme' }).segment(lines[maxLines - 1])].map((x) => x.segment);
    lines[maxLines - 1] = chars.slice(0, maxLen - 1).join('').trimEnd() + '…';
  }
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
<dir>${fontsDir}</dir><cachedir>${path.join(jobDir, 'fc-cache')}</cachedir></fontconfig>`);
  return { fontsDir, env: { ...process.env, FONTCONFIG_FILE: conf } };
}

const FONT = `'${FONT_FAMILY}','Noto Sans Bengali','Lohit Bengali',sans-serif`;
function svgToPng(svg, outFile, env) {
  const svgFile = outFile.replace(/\.png$/, '.svg');
  fs.writeFileSync(svgFile, svg, 'utf8');
  execFileSync('rsvg-convert', ['-f', 'png', '-w', String(W), '-h', String(H), '-o', outFile, svgFile], { timeout: 60000, env });
  fs.rmSync(svgFile, { force: true });
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

const run = (args, opts = {}) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-v', 'error', ...args], { timeout: 900000, stdio: 'pipe', ...opts });

/** One B-roll slot → 1080×1920 silent segment: blurred full-bleed backdrop + fitted foreground with slow push-in. */
export function renderSegment({ kind, file, duration, creditPng, outFile, env }) {
  const d = duration.toFixed(3);
  const input = kind === 'image' ? ['-loop', '1', '-framerate', String(FPS), '-t', d, '-i', file]
    : kind === 'video' ? ['-stream_loop', '-1', '-t', d, '-i', file]
      : ['-f', 'lavfi', '-t', d, '-i', `gradients=s=${W}x${H}:c0=0x0b1f3a:c1=0x6e0f2b:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.015:rate=${FPS}`];
  const base = kind === 'brand'
    ? '[0:v]format=yuv420p[m0]'
    : `[0:v]fps=${FPS},setpts=PTS-STARTPTS,format=yuv420p,split=2[bgsrc][fgsrc];`
    + `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=34:4,eq=brightness=-0.16:saturation=0.9[bg];`
    + `[fgsrc]scale=w='trunc(${W}*(1+0.06*t/${d})/2)*2':h=-2:eval=frame[fg];[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2':shortest=1[m0]`;
  const filter = `${base};[m0][1:v]overlay=0:0:format=auto,fps=${FPS},format=yuv420p[out]`;
  run([...input, '-loop', '1', '-framerate', String(FPS), '-i', creditPng, '-filter_complex', filter, '-map', '[out]', '-t', d,
    '-c:v', 'libx264', '-preset', process.env.VIDEO_X264_PRESET || process.env.VIDEO_ENCODER_PRESET || process.env.VIDEO_PRESET || 'veryfast', '-crf', '21', '-r', String(FPS), '-pix_fmt', 'yuv420p', '-an', outFile], { env });
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
export function composeFinal({ jobDir, segments, audioPath, assFile, overlays, total, outFile, env, fontsDir }) {
  const list = path.join(jobDir, 'segments.txt');
  fs.writeFileSync(list, segments.map((s) => `file '${path.basename(s).replace(/'/g, "'\\''")}'`).join('\n'));
  // Measure on the exact channel layout/sample rate that ships: mono→stereo adds ~3 LU.
  const stereo = path.join(jobDir, 'voice_stereo.wav');
  run(['-i', audioPath, '-vn', '-ac', '2', '-ar', '48000', stereo]);
  const measured = measureAudio(stereo);
  const endStart = Math.max(0, total - END_CARD_SECONDS).toFixed(3);
  // Mis-shaped Bengali is worse than no burned captions; the timed voice.vtt sidecar is always produced and verified.
  const burnCaptions = assComplexShapingSupported();
  if (!burnCaptions) console.warn('::warning::ffmpeg lacks ass shaping=complex; burned captions skipped (upgrade ffmpeg). Sidecar voice.vtt is still verified.');
  const filter = `[0:v][2:v]overlay=0:0:format=auto[a];[a][3:v]overlay=0:0:format=auto:enable='lt(t,5)'[b];`
    + `[b][4:v]overlay=0:0:format=auto:enable='gte(t,5)'[c];[c][5:v]overlay=0:0:format=auto:enable='gte(t,${endStart})'[d];`
    + (burnCaptions ? `[d]ass=filename=${path.basename(assFile)}:fontsdir=${path.basename(fontsDir)}:shaping=complex[v];` : '[d]null[v];')
    + `[1:a]${loudnormFilter(measured)},aresample=48000,apad=whole_dur=${total.toFixed(3)}[a]`;
  const png = (f) => ['-loop', '1', '-framerate', String(FPS), '-t', total.toFixed(3), '-i', f];
  run(['-f', 'concat', '-safe', '0', '-i', path.basename(list), '-i', path.basename(stereo),
    ...png(overlays.brand), ...png(overlays.headBig), ...png(overlays.headSmall), ...png(overlays.endCard),
    '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3),
    '-c:v', 'libx264', '-preset', process.env.VIDEO_X264_PRESET || process.env.VIDEO_ENCODER_PRESET || process.env.VIDEO_PRESET || 'veryfast', '-crf', '21', '-r', String(FPS), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', path.basename(outFile)], { env, cwd: jobDir });
  return { measured };
}

export function probeDuration(file) {
  const value = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8', timeout: 20000 }).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid media duration');
  return value;
}
