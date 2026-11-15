// Offline integration check: synthetic image/clip/tone only; no TTS, news, stock or provider API calls.
// Exercises overlays (Bengali shaping), image/video/brand segments, karaoke ASS, two-pass loudness and the
// uploader's own inspectRender() contract (1080x1920 H.264/AAC 48k, 30 fps, 40-120 s, -14 LUFS, caption sidecar).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { prepareFonts, renderBrandOverlay, renderHeadlineBig, renderHeadlineSmall, renderEndCard, renderCreditStrip, renderSegment, composeFinal, FONT_FAMILY } from '../video-compose.mjs';
import { inspectRender } from '../upload-supabase-video.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const tmp = path.join(root, 'temp_assets');
if (fs.existsSync(path.join(tmp, 'manifest.json')) || fs.existsSync(path.join(tmp, 'claim.json'))) throw new Error('Refusing smoke test over a live render');
const jobId = '00000000-0000-4000-8000-000000000002';
const jobDir = path.join(tmp, jobId);
fs.rmSync(jobDir, { recursive: true, force: true });
fs.mkdirSync(jobDir, { recursive: true });
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'pipe' });
try {
  const { fontsDir, env } = prepareFonts(jobDir);
  const total = 42.0;
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=40.5', '-af', 'volume=0.5', '-c:a', 'libmp3lame', path.join(jobDir, 'voice.mp3'));
  ff('-f', 'lavfi', '-i', 'testsrc2=s=1600x1067:d=1', '-frames:v', '1', path.join(jobDir, 'still.jpg'));
  ff('-f', 'lavfi', '-i', 'mandelbrot=s=640x360:r=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(jobDir, 'clip.mp4'));
  const words = ['দেশের', 'সর্বশেষ', 'সংবাদ', 'বিস্তারিত', 'জানতে', 'বাংলার', 'ভয়েস', 'দেখুন'];
  let vtt = 'WEBVTT\n\n'; const f = (x) => `00:00:${x.toFixed(3).padStart(6, '0')}`;
  words.forEach((w, i) => { vtt += `${f(0.2 + i * 0.7)} --> ${f(0.2 + i * 0.7 + 0.6)}\n${w}\n\n`; });
  fs.writeFileSync(path.join(jobDir, 'voice.vtt'), vtt);
  execFileSync('python3', [path.join(here, '../vtt-to-karaoke.py'), path.join(jobDir, 'voice.vtt'), path.join(jobDir, 'voice.ass'), FONT_FAMILY]);

  const title = 'ঢাকায় আজ বিকেলে ভারী বৃষ্টিতে জলাবদ্ধতা, যান চলাচলে চরম দুর্ভোগ';
  renderBrandOverlay(path.join(jobDir, 'brand.png'), { sourceName: 'Prothom Alo' }, env);
  renderHeadlineBig(path.join(jobDir, 'head_big.png'), title, env);
  renderHeadlineSmall(path.join(jobDir, 'head_small.png'), title, env);
  renderEndCard(path.join(jobDir, 'end.png'), { host: 'bvai-chi.vercel.app' }, env);
  renderCreditStrip(path.join(jobDir, 'credit1.png'), 'ছবি: Example Author · CC BY 4.0 · Wikimedia Commons', env);
  renderCreditStrip(path.join(jobDir, 'credit2.png'), 'ভিডিও: Example Creator · Pixabay Content License', env);
  const slots = [
    { kind: 'image', file: path.join(jobDir, 'still.jpg'), credit: 'credit1.png', d: 14 },
    { kind: 'video', file: path.join(jobDir, 'clip.mp4'), credit: 'credit2.png', d: 14 },
    { kind: 'brand', file: null, credit: 'credit1.png', d: 14 },
  ];
  const segments = [];
  slots.forEach((s, i) => {
    const out = path.join(jobDir, `seg-${i}.mp4`);
    renderSegment({ kind: s.kind, file: s.file, duration: s.d, creditPng: path.join(jobDir, s.credit), outFile: out, env });
    segments.push(out);
  });
  const out = path.join(jobDir, 'final_output.mp4');
  composeFinal({
    jobDir, segments, audioPath: path.join(jobDir, 'voice.mp3'), assFile: path.join(jobDir, 'voice.ass'), fontsDir,
    overlays: { brand: path.join(jobDir, 'brand.png'), headBig: path.join(jobDir, 'head_big.png'), headSmall: path.join(jobDir, 'head_small.png'), endCard: path.join(jobDir, 'end.png') },
    total, outFile: out, env,
  });
  const meta = inspectRender({
    article_id: '00000000-0000-4000-8000-000000000001', job_id: jobId, claim_token: '00000000-0000-4000-8000-000000000003',
    video_path: out, audio_duration: 40.5, caption_method: 'groq-whisper',
  });
  assert.ok(meta.duration >= 40 && meta.duration <= 120);
  for (const [name, t] of [['early', 1.0], ['mid', 20], ['end', 38]]) if (process.env.SMOKE_PREVIEW_DIR) ff('-ss', String(t), '-i', out, '-frames:v', '1', path.join(process.env.SMOKE_PREVIEW_DIR, `smoke-${name}.png`));
  console.log('PASS offline render: 1080x1920 H.264/AAC, burned Bengali captions, symbolic label, loudness gate, full decode');
} catch (error) {
  // Annotations can be read through the GitHub API without downloading the run log.
  if (process.env.GITHUB_ACTIONS) console.log('::error title=render-smoke::' + String(error?.message || error).replace(/[%\r\n]+/g, ' ').slice(0, 400));
  throw error;
} finally {
  if (!process.env.SMOKE_KEEP) fs.rmSync(jobDir, { recursive: true, force: true });
}
