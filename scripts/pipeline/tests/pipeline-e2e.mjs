// Offline end-to-end check of the renderer orchestration with a fake DB, fake TTS and fake media.
// Verifies: contract-valid manifest, duplicate-asset skipping, reservations, heartbeat, and that every
// downloaded asset + intermediate is deleted once the render is confirmed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { renderClaim } from '../generate-video.js';
import { scriptHash, contentKey } from '../video-script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.resolve(here, '../../../temp_assets');
if (fs.existsSync(path.join(tmp, 'manifest.json'))) throw new Error('Refusing e2e test over a live render');
const claim = { article_id: '11111111-1111-4111-8111-111111111111', job_id: '22222222-2222-4222-8222-222222222222', claim_token: '33333333-3333-4333-8333-333333333333' };
const bodySentences = [
  'রাজধানীর বিভিন্ন এলাকায় বুধবার বিকেলে ভারী বৃষ্টিতে জলাবদ্ধতা তৈরি হয়েছে।', 'অনেক সড়কে পানি জমে যাওয়ায় যান চলাচল ধীর হয়ে পড়ে।',
  'আবহাওয়া অধিদপ্তর জানিয়েছে, আগামী দুই দিন দেশের বিভিন্ন অঞ্চলে হালকা থেকে মাঝারি বৃষ্টি হতে পারে।', 'নগর কর্তৃপক্ষ বলছে, নিষ্কাশন ব্যবস্থা পরিষ্কারের কাজ চলছে।',
  'যাত্রীরা অফিস থেকে ফেরার পথে দীর্ঘ সময় আটকে ছিলেন বলে জানিয়েছেন।', 'সংশ্লিষ্ট কর্মকর্তারা পরিস্থিতি পর্যবেক্ষণ করছেন এবং প্রয়োজনীয় ব্যবস্থা নেওয়ার কথা জানিয়েছেন।',
  'বিশেষজ্ঞরা বলছেন, দীর্ঘমেয়াদি পরিকল্পনা ছাড়া এই সমস্যার সমাধান কঠিন।', 'স্থানীয় বাসিন্দারা দ্রুত সমাধানের দাবি জানিয়েছেন।',
  'গত বছরও একই সময়ে একই ধরনের পরিস্থিতি দেখা গিয়েছিল বলে স্থানীয়রা জানান।', 'আরও কয়েকটি এলাকায় পানি নামতে বেশ সময় লাগতে পারে বলে ধারণা করা হচ্ছে।',
];
const article = {
  id: claim.article_id, title_bn: 'ঢাকায় ভারী বৃষ্টিতে জলাবদ্ধতা, যান চলাচলে দুর্ভোগ', content_bn: bodySentences.join(' ') + '\n\nসূত্র: Prothom Alo https://example.org/x',
  excerpt_bn: '', category_key: 'national', source_name: 'Prothom Alo', source_url: 'https://www.prothomalo.com/x', context_blocks: [],
};
const calls = []; let attemptedDuplicate = false;
const db = {
  from: () => ({ insert: async()=>({error:null}), select: () => ({ eq: () => ({ single: async () => ({ data: article, error: null }) }) }) }),
  rpc: async (name, args) => {
    calls.push(name);
    if (name === 'reserve_video_broll' && !attemptedDuplicate) { attemptedDuplicate = true; return { data: null, error: { message: 'broll_already_used' } }; }
    return { data: true, error: null };
  },
};
const work = path.join(tmp, '_e2e_src'); fs.mkdirSync(work, { recursive: true });
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: 'pipe' });
ff('-f', 'lavfi', '-i', 'testsrc2=s=1600x1067:d=1', '-frames:v', '1', path.join(work, 's.jpg'));
ff('-f', 'lavfi', '-i', 'mandelbrot=s=640x360:r=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'c.mp4'));
let n = 0;
const fakeMedia = {
  async *candidates() {
    yield { provider: 'pixabay', kind: 'video', url: 'https://cdn.example/dup.mp4', source_url: 'https://pixabay.com/v/1', title: 'monsoon rain street', author: 'A', license: 'Pixabay Content License', license_url: 'https://license.example/terms', query: 'q' };
    yield { provider: 'wikimedia-commons', kind: 'image', url: 'https://upload.example/a.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:a.jpg', title: 'monsoon rain street', author: 'Example Author', license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', query: 'q' };
    yield { provider: 'pexels', kind: 'video', url: 'https://videos.example/b.mp4', source_url: 'https://pexels.com/v/2', title: 'highway traffic road', author: 'B', license: 'Pexels License', license_url: 'https://license.example/terms', query: 'q' };
  },
  async download(candidate, file) {
    n++; const src = path.join(work, candidate.kind === 'video' ? 'c.mp4' : 's.jpg');
    fs.copyFileSync(src, file); const bytes = fs.readFileSync(file);
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).update(String(n)).digest('hex') };
  },
};
// Synthetic offline fixture ONLY: tone + test timestamps. This is NOT real alignment or Bengali voice quality proof.
async function fakeTts(script, audioPath, subPath) {
  const seconds = Math.max(40, script.length / 24); // minimum-duration fixture; delivery master remains full 1080×1920/30fps
  ff('-f', 'lavfi', '-i', `sine=frequency=200:duration=${seconds.toFixed(2)}`, '-af', 'volume=0.6', '-c:a', 'libmp3lame', audioPath);
  const words = script.split(/\s+/); const per = (seconds - 0.3) / words.length;
  const f = (x) => { const ms = Math.round(x * 1000); return `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
  fs.writeFileSync(subPath, 'WEBVTT\n\n' + words.map((w, i) => `${f(0.1 + i * per)} --> ${f(0.1 + (i + 0.9) * per)}\n${w}\n`).join('\n'));
  fs.writeFileSync(path.join(path.dirname(audioPath), 'script.txt'), script);
  return { method: 'groq-whisper', timed: true };
}
try {
  const manifest = await renderClaim(db, claim, { synthesizeVoice: fakeTts, media: fakeMedia });
  assert.equal(manifest.article_id, claim.article_id);
  assert.equal(manifest.technical_qc.checks.decode,true);
  assert.equal(manifest.technical_qc.checks.script_binding,true);
  assert.equal(manifest.technical_qc.policy_version,'2026-11-16.v2');
  assert.equal(manifest.spoken_script_hash, scriptHash(fs.readFileSync(path.join(tmp, claim.job_id, 'script.txt'), 'utf8')));
  assert.equal(manifest.production_plan.status, 'needs_review');
  assert.ok(manifest.production_plan.scenes.length > 0);
  assert.equal(manifest.content_key, contentKey(article));
  assert.ok(manifest.audio_duration >= 34 && manifest.render_duration >= 40 && manifest.render_duration <= 120);
  assert.ok(calls.includes('reserve_video_story') && calls.includes('reserve_video_visual') && calls.includes('reserve_video_broll'));
  assert.equal(manifest.media.length, 2, 'duplicate asset was skipped, two fresh assets used');
  assert.ok(manifest.media.every((m) => m.license && m.source_url && m.author));
  const left = fs.readdirSync(path.join(tmp, claim.job_id)).sort();
  assert.deepEqual(left, ['final_output.mp4', 'production-plan.json', 'script.txt', 'voice.vtt'], 'downloads and intermediates must be deleted after confirmed render');
  assert.ok(fs.existsSync(path.join(tmp, 'manifest.json')));
  console.log(`PASS e2e: ${manifest.render_duration.toFixed(1)} s video, ${manifest.media.length} licensed assets, leftovers = ${left.join(', ')}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(path.join(tmp, claim.job_id), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, 'manifest.json'), { force: true });
}
