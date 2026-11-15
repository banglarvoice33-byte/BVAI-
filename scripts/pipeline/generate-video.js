// BVAI faceless-video renderer (one claimed article -> one verified 1080x1920 Bengali short).
//
//   claim (DB slot + freshness + trust gate) -> narration from the article only -> TTS + actual-audio captions
//   -> story reservation (no duplicate stories/scripts) -> keyless, licence-checked symbolic B-roll with per-asset
//   reservation (no reused clip/photo) -> compose -> inspectRender() self-check -> delete every downloaded asset.
//
// It never publishes. upload-supabase-video.mjs does the transactional finalize; review/website/distribute is decided there.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadVaultEnv } from './load-vault-env.mjs';
import { synthesizeVoice, audioDuration, scrubSecrets } from './voice-captions.js';
import { buildNarration, contentKey, scriptHash, sourceNameBn, CTA } from './video-script.mjs';
import { normalizeBanglaForTts } from './bangla-normalize.mjs';
import { candidates, download } from './media-sources.mjs';
import { prepareFonts, renderBrandOverlay, renderHeadlineBig, renderHeadlineSmall, renderEndCard, renderCreditStrip, renderSegment, composeFinal, probeDuration, FONT_FAMILY } from './video-compose.mjs';
import { inspectRender } from './upload-supabase-video.mjs';

// Compatibility exports: the repository's contract tests (tests/repair-contract.test.mjs) and older callers use these names.
export const CLOSING_CTA = CTA;
export const buildVoiceScript = (article) => buildNarration(article).script;
export const isMotionMedia = (filename) => /\.(mp4|webm|ogv)$/i.test(String(filename || ''));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '..', '..', 'temp_assets');
export const LIMITS = Object.freeze({ minAudio: 34, retryBelow: 38, maxAudio: 112, minTotal: 40.6, tail: 1.2, maxClaims: 4 });
const PROVIDER_LABEL = { 'wikimedia-commons': 'Wikimedia Commons', nasa: 'NASA', pixabay: 'Pixabay', pexels: 'Pexels' };

class SkipArticle extends Error { constructor(message) { super(message); this.skip = true; } }
const log = (...a) => console.log(...a);

function admin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function planSlots(total, mediaCount) {
  const wanted = Math.min(10, Math.max(4, Math.round(total / 8)));
  // Never more slots than real assets (long holds beat repeated filler), but never fewer than 3 cuts.
  const count = Math.max(3, Math.min(wanted, mediaCount));
  const each = total / count;
  return { count, durations: Array.from({ length: count }, (_, i) => (i === count - 1 ? total - each * (count - 1) : each)) };
}

async function makeVoice(article, jobDir, beat, tts = synthesizeVoice) {
  const audioPath = path.join(jobDir, 'voice.mp3');
  const subPath = path.join(jobDir, 'voice.vtt');
  let target = Number(process.env.VIDEO_TARGET_CHARS || 900);
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const narration = buildNarration(article, { targetChars: target });
    // Numbers/currency/dates are spoken as Bengali words; captions come from the audio actually produced.
    const captions = await tts(normalizeBanglaForTts(narration.script), audioPath, subPath);
    if (!['groq-whisper', 'edge-matched'].includes(captions.method)) throw new Error('Actual-audio captions unavailable; refusing to render');
    const seconds = audioDuration(audioPath);
    last = { ...narration, caption_method: captions.method, seconds };
    log(`   🎙️ attempt ${attempt}: ${narration.chars} chars → ${seconds.toFixed(1)} s (${captions.method})`);
    beat();
    const tooShort = seconds < LIMITS.retryBelow && !narration.usedAll;
    const tooLong = seconds > LIMITS.maxAudio;
    if (!tooShort && !tooLong) break;
    const perSecond = narration.script.length / seconds;
    target = tooLong ? Math.floor(perSecond * 95) : Math.ceil(perSecond * 52);
  }
  if (last.seconds < LIMITS.minAudio) throw new SkipArticle(`article_too_short_for_video (${last.seconds.toFixed(1)} s of narration)`);
  if (last.seconds > LIMITS.maxAudio) throw new Error(`narration_too_long (${last.seconds.toFixed(1)} s)`);
  return { ...last, audioPath, subPath };
}

const extensionFor = (candidate) => {
  const ext = (new URL(candidate.url).pathname.match(/\.([a-z0-9]{2,4})$/i)?.[1] || '').toLowerCase();
  if (candidate.kind === 'image') return ['jpg', 'jpeg', 'png'].includes(ext) ? ext : 'jpg';
  return ['mp4', 'webm', 'ogv', 'mov'].includes(ext) ? ext : 'mp4';
};
function usableMedia(file, kind) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 20000 }));
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  if (!video || video.width < 480 || video.height < 320) return false;
  return kind === 'video' ? Number(probe.format?.duration) >= 3 : true;
}

/** Pull licence-checked candidates until enough are reserved. A reservation failure (already used) just skips the asset. */
async function gatherMedia(db, claim, article, jobDir, need, beat, source = { candidates, download }) {
  const dir = path.join(jobDir, 'dl');
  fs.mkdirSync(dir, { recursive: true });
  const picked = [];
  const deadline = Date.now() + Number(process.env.VIDEO_MEDIA_BUDGET_MS || 150000);
  let tried = 0;
  try {
    for await (const candidate of source.candidates(article)) {
      if (picked.length >= need || tried >= 45 || Date.now() > deadline) break;
      tried++;
      const file = path.join(dir, `m${tried}.${extensionFor(candidate)}`);
      try {
        const info = await source.download(candidate, file, fs);
        if (!usableMedia(file, candidate.kind)) throw new Error('unusable_media');
        const { error } = await db.rpc(candidate.kind === 'video' ? 'reserve_video_broll' : 'reserve_video_visual',
          { p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_sha256: info.sha256, p_source_url: candidate.source_url });
        if (error) throw new Error(error.message); // already used elsewhere -> never reuse
        picked.push({ ...candidate, file, sha256: info.sha256 });
        log(`   🎞️ ${candidate.provider} ${candidate.kind}: ${candidate.title.slice(0, 50)} (${candidate.license})`);
        beat();
      } catch (error) {
        fs.rmSync(file, { force: true });
        if (/invalid_(broll|visual)_claim/.test(error.message)) throw error; // lease lost: stop
      }
    }
  } catch (error) {
    if (/invalid_(broll|visual)_claim/.test(error.message)) throw error;
    log('   ⚠️ media search interrupted:', error.message);
  }
  return picked;
}

const creditLine = (m) => m
  ? `${m.kind === 'video' ? 'ভিডিও' : 'ছবি'}: ${m.author} · ${m.license} · ${PROVIDER_LABEL[m.provider] || m.provider}`
  : 'প্রতীকী গ্রাফিক · বাংলার ভয়েস';

export async function renderClaim(db, claim, deps = {}) {
  const jobDir = path.join(TMP, claim.job_id);
  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
  const beat = () => db.rpc('heartbeat_reviewed_render', { p_job_id: claim.job_id, p_claim_token: claim.claim_token }).then(() => {}, () => {});
  const timer = setInterval(beat, 45000); timer.unref();
  try {
    const { data: article, error } = await db.from('articles').select('*').eq('id', claim.article_id).single();
    if (error || !article) throw new Error('Article fetch failed');
    log('📰 ' + String(article.title_bn).slice(0, 80));

    log('🎙️ Voice + captions...');
    const voice = await makeVoice(article, jobDir, beat, deps.synthesizeVoice);
    const key = contentKey(article); const hash = scriptHash(voice.script);
    const reserved = await db.rpc('reserve_video_story', { p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_content_key: key, p_script_hash: hash, p_content_text: voice.script });
    if (reserved.error) {
      if (/duplicate_story_or_script/.test(reserved.error.message)) throw new SkipArticle('duplicate_story_or_script');
      throw new Error('Story reservation: ' + reserved.error.message);
    }

    const total = Math.max(LIMITS.minTotal, voice.seconds + LIMITS.tail);
    const wanted = planSlots(total, 99).count;
    log(`🎞️ Symbolic B-roll (want up to ${wanted})...`);
    const media = await gatherMedia(db, claim, article, jobDir, wanted, beat, deps.media);
    const { count, durations } = planSlots(total, media.length);
    log(`   ${media.length} licensed asset(s) reserved; ${Math.max(0, count - media.length)} branded motion slot(s) fill the rest`);

    log('🎨 Overlays + compose...');
    const { fontsDir, env } = prepareFonts(jobDir);
    const host = (() => { try { return new URL(process.env.SITE_URL || 'https://bvai-chi.vercel.app').host; } catch { return ''; } })();
    const sourceName = String(article.source_name || '').trim();
    const png = (name) => path.join(jobDir, name);
    renderBrandOverlay(png('brand.png'), { sourceName }, env);
    renderHeadlineBig(png('head_big.png'), article.title_bn, env);
    renderHeadlineSmall(png('head_small.png'), article.title_bn, env);
    renderEndCard(png('end.png'), { host }, env);
    execFileSync(process.env.PYTHON || 'python3', [path.join(HERE, 'vtt-to-karaoke.py'), voice.subPath, png('voice.ass'), FONT_FAMILY], { timeout: 60000, stdio: 'pipe' });

    const segments = [];
    for (let i = 0; i < count; i++) {
      const asset = media[i];
      renderCreditStrip(png(`credit${i}.png`), creditLine(asset), env);
      const out = png(`seg-${i}.mp4`);
      renderSegment({ kind: asset ? asset.kind : 'brand', file: asset?.file, duration: durations[i], creditPng: png(`credit${i}.png`), outFile: out, env });
      segments.push(out);
      beat();
    }
    const finalFile = png('final_output.mp4');
    composeFinal({
      jobDir, segments, audioPath: voice.audioPath, assFile: png('voice.ass'), fontsDir, total, outFile: finalFile, env,
      overlays: { brand: png('brand.png'), headBig: png('head_big.png'), headSmall: png('head_small.png'), endCard: png('end.png') },
    });

    const renderSeconds = probeDuration(finalFile);
    const manifest = {
      schema: 2, article_id: claim.article_id, job_id: claim.job_id, claim_token: claim.claim_token, video_path: finalFile,
      audio_duration: voice.seconds, render_duration: renderSeconds, size_bytes: fs.statSync(finalFile).size,
      caption_method: voice.caption_method, script_hash: hash, content_key: key, script_chars: voice.script.length,
      symbolic_visuals: true, synthetic_realistic: false, visual_label: 'প্রতীকী ভিজ্যুয়াল',
      source: { name: sourceName, name_bn: sourceNameBn(sourceName), url: article.source_url },
      media: media.map((m) => ({ provider: m.provider, kind: m.kind, title: m.title, author: m.author, license: m.license, license_url: m.license_url, source_url: m.source_url, sha256: m.sha256 })),
      evidence: [], generated_at: new Date().toISOString(),
    };
    // Render is "confirmed" only when the uploader's own contract passes: probe, full decode, loudness, caption sidecar.
    inspectRender(manifest);
    fs.writeFileSync(path.join(TMP, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // Confirmed -> delete every downloaded source video/photo and all intermediates; keep only the final MP4, captions, script.
    fs.rmSync(path.join(jobDir, 'dl'), { recursive: true, force: true });
    for (const name of fs.readdirSync(jobDir)) if (!['final_output.mp4', 'voice.vtt', 'script.txt'].includes(name)) fs.rmSync(path.join(jobDir, name), { recursive: true, force: true });
    log(`✅ Render confirmed: ${(manifest.size_bytes / 1e6).toFixed(1)} MB, ${renderSeconds.toFixed(1)} s; downloaded assets deleted`);
    return manifest;
  } finally { clearInterval(timer); }
}

async function failClaim(db, claim, reason) {
  await db.rpc('fail_video_generation_job', { p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_reason: String(reason).slice(0, 300) }).then(() => {}, () => {});
  fs.rmSync(path.join(TMP, claim.job_id), { recursive: true, force: true });
  fs.rmSync(path.join(TMP, 'claim.json'), { force: true });
}

export async function main() {
  log('🎬 BVAI video renderer');
  await loadVaultEnv();
  if (process.env.VIDEO_AUTOMATION_PAUSED === 'true') { log('⏸️ VIDEO_AUTOMATION_PAUSED=true: nothing rendered.'); return; }
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  if (fs.existsSync(path.join(TMP, 'manifest.json'))) throw new Error('Unfinished upload found; run --upload-only before rendering a new video');
  const db = admin();
  await db.rpc('recover_expired_video_generation_jobs').then(() => {}, () => {});
  const requested = (process.env.ARTICLE_ID || '').trim() || null;
  for (let attempt = 1; attempt <= LIMITS.maxClaims; attempt++) {
    const { data, error } = await db.rpc('claim_reviewed_video_job', { p_article_id: requested });
    if (error) throw new Error('Claim failed: ' + error.message);
    const claim = data?.[0];
    if (!claim) { log('ℹ️ No video due: outside peak slot quota, daily cap reached, or no fresh eligible article.'); return; }
    if (process.env.GITHUB_ACTIONS) console.log('::add-mask::' + claim.claim_token);
    fs.writeFileSync(path.join(TMP, 'claim.json'), JSON.stringify(claim), { mode: 0o600 });
    try {
      await renderClaim(db, claim);
      return;
    } catch (error) {
      console.error('❌', error.message);
      // GitHub annotations are readable through the API without downloading logs; secrets are scrubbed first.
      if (process.env.GITHUB_ACTIONS) console.log('::error title=BVAI render failed::' + scrubSecrets(error.message, 300).replace(/[%\r\n]+/g, ' '));
      await failClaim(db, claim, error.message);
      if (!error.skip || requested) throw error;
      log('↪ trying the next eligible article');
    }
  }
  throw new Error('Several eligible articles were skipped; see log');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error('❌', error.message); process.exit(1); });
}
