// BVAI faceless-video renderer (one claimed article -> one verified 1080x1920 Bengali short).
//
//   claim (DB slot + freshness + trust gate) -> narration from the article only -> TTS + actual-audio captions
//   -> story reservation (no duplicate stories/scripts) -> keyless, licence-checked symbolic B-roll with per-asset
//   reservation (no reused clip/photo) -> compose -> inspectRender() self-check -> delete every downloaded asset.
//
// It never publishes. upload-supabase-video.mjs does the transactional finalize; review/website/distribute is decided there.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadVaultEnv } from './load-vault-env.mjs';
import { guardVideoClip } from './perceptual-video.mjs';
import { captionGuard } from './caption-qc.mjs';
import { synthesizeVoice, audioDuration, scrubSecrets } from './voice-captions.js';
import { buildNarration, contentKey, scriptHash, sourceNameBn, CTA } from './video-script.mjs';
import { normalizeSpeechText as normalizeBanglaForTts } from './bangla-speech.mjs';
import { candidates, download } from './media-sources.mjs';
import { prepareFonts, renderBrandOverlay, renderHeadlineBig, renderHeadlineSmall, renderEndCard, renderCreditStrip, renderSegment, composeFinal, probeDuration, FONT_FAMILY } from './video-compose.mjs';
import { inspectRender } from './upload-supabase-video.mjs';
import { createRenderHeartbeat } from './render-heartbeat.mjs';
import { buildProductionPlan, timelineFromVtt, renderSlotsFromTimeline } from './production-plan.mjs';
import { runContinuity } from './continuity.mjs';
import { generateScript } from './enhanced/script-router.mjs';
import { assignVisuals, rankVisuals } from './enhanced/composer.mjs';
import { inspectWithRepair } from './enhanced/quality-repair.mjs';
import { emitPipelineEvent } from './enhanced/events.mjs';
import { technicalReport } from './enhanced/policy.mjs';
import { AgnesApiError, createAgnesClient, getAgnesKeyCandidates } from './agnes-client.mjs';
import { agnesSlotSeconds } from './agnes-visuals.mjs';

// Compatibility exports: the repository's contract tests (tests/repair-contract.test.mjs) and older callers use these names.
export const CLOSING_CTA = CTA;
export const buildVoiceScript = (article) => buildNarration(article).script;
export const isMotionMedia = (filename) => /\.(mp4|webm|ogv)$/i.test(String(filename || ''));
const useAgnesVisuals = () => String(process.env.VIDEO_VISUAL_PROVIDER || 'licensed').toLowerCase() === 'agnes';

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

async function makeVoice(article, jobDir, beat, tts = synthesizeVoice, signal) {
  const audioPath = path.join(jobDir, 'voice.mp3');
  const subPath = path.join(jobDir, 'voice.vtt');
  let target = Number(process.env.VIDEO_TARGET_CHARS || 900);
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const narration = await generateScript(article, { targetChars: target, signal });
    // Numbers/currency/dates are spoken as Bengali words; captions come from the audio actually produced.
    const captions = await tts(normalizeBanglaForTts(narration.script), audioPath, subPath);
    if (!['groq-whisper', 'edge-matched'].includes(captions.method)) throw new Error('Actual-audio captions unavailable; refusing to render');
    const seconds = audioDuration(audioPath);
    last = { ...narration, caption_method: captions.method, seconds };
    log(`   🎙️ attempt ${attempt}: ${narration.chars} chars → ${seconds.toFixed(1)} s (${captions.method})`);
    await beat();
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
      const relevance=rankVisuals({spoken_text:article.title_bn+' '+String(article.content_bn || '').slice(0,1200)},[candidate])[0];
      if(!relevance?.rights || relevance.score<=0)continue;
      const file = path.join(dir, `m${tried}.${extensionFor(candidate)}`);
      try {
        const info = await source.download(candidate, file, fs);
        if (!usableMedia(file, candidate.kind)) throw new Error('unusable_media');
        // Near-duplicate (re-encoded / rescaled / trimmed) clips are skipped like exact-hash reuse; see perceptual-video.mjs for limits.
        if (candidate.kind === 'video') await (source.guardVideoClip || guardVideoClip)({ db, claim, file, sha256: info.sha256, sourceUrl: candidate.source_url, log });
        const { error } = await db.rpc(candidate.kind === 'video' ? 'reserve_video_broll' : 'reserve_video_visual',
          { p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_sha256: info.sha256, p_source_url: candidate.source_url });
        if (error) throw new Error(error.message); // already used elsewhere -> never reuse
        picked.push({ ...candidate, file, sha256: info.sha256 });
        log(`   🎞️ ${candidate.provider} ${candidate.kind}: ${candidate.title.slice(0, 50)} (${candidate.license})`);
        await beat();
      } catch (error) {
        fs.rmSync(file, { force: true });
        if (error.code === 'RENDER_LEASE_LOST' || /invalid_(broll|visual|perceptual)_claim/.test(error.message)) throw error; // lease lost: stop
      }
    }
  } catch (error) {
    if (error.code === 'RENDER_LEASE_LOST' || /invalid_(broll|visual|perceptual)_claim/.test(error.message)) throw error;
    log('   ⚠️ media search interrupted:', error.message);
  }
  return picked;
}

/** Hash a downloaded asset without loading a potentially large clip into memory. */
async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Generate one short Agnes clip per visual slot, sequentially by design. */
async function gatherAgnesMedia(plan, sceneSlots, jobDir, beat, signal) {
  const keys = getAgnesKeyCandidates();
  if (!keys.length) throw new AgnesApiError('No Agnes API key is configured', { statusCode: 500 });
  const assets = [];
  for (let index = 0; index < sceneSlots.count; index += 1) {
    if (signal?.aborted) throw new Error('Agnes render aborted');
    const scene = plan.scenes[index] || plan.scenes.at(-1);
    const slotDuration = Number(sceneSlots.durations[index] || 4);
    const seconds = agnesSlotSeconds(slotDuration);
    const prompt = [
      'Create a factual, neutral, documentary-style Bengali news visual.',
      'Use realistic contextual imagery with restrained camera motion.',
      'Do not include text, captions, logos, watermarks, or invented identifiable people.',
      'Vertical 9:16 composition, suitable for a Bengali news short.',
      `Scene context: ${String(scene?.spoken_text || '').trim()}`,
    ].join(' ');
    const file = path.join(jobDir, `agnes-${String(index).padStart(3, '0')}.mp4`);
    let videoId;
    let result;
    let lastError;
    for (const candidate of keys) {
      try {
        // Complete one candidate before trying the next; Agnes calls remain sequential.
        const client = createAgnesClient({ apiKey: candidate.key });
        videoId = await client.createVideoTask({ prompt, seconds });
        result = await client.waitForVideo({
          videoId,
          timeoutMs: Number(process.env.AGNES_TIMEOUT_MS || 600000),
          pollIntervalMs: Number(process.env.AGNES_POLL_INTERVAL_MS || 1500),
        });
        await client.downloadVideo(result.url, file);
        break;
      } catch (error) {
        fs.rmSync(file, { force: true });
        lastError = error;
        if (!(error instanceof AgnesApiError) || !error.retryable) throw error;
        console.warn(`[agnes] key candidate #${candidate.index} failed; trying the next configured candidate`);
      }
    }
    if (!result || !videoId) throw lastError || new AgnesApiError('All Agnes API key candidates failed', { retryable: true });
    const sha256 = await hashFile(file);
    assets.push({
      file,
      kind: 'video',
      provider: 'agnes-ai',
      title: 'AI-generated contextual visual',
      author: 'Agnes AI',
      description: String(scene?.spoken_text || ''),
      tags: [],
      // Do not persist the provider's temporary/signed download URL in a public manifest.
      source_url: 'https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash',
      license: 'AI-generated output; provider terms apply; editorial review required',
      license_url: 'https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash',
      external_id: videoId,
      sha256,
      synthetic: true,
    });
    await beat();
  }
  return assets;
}

const creditLine = (m) => m
  ? (m.synthetic
    ? 'এআই-উৎপাদিত ভিজ্যুয়াল · মানব যাচাই আবশ্যক'
    : `${m.kind === 'video' ? 'ভিডিও' : 'ছবি'}: ${m.author} · ${m.license} · ${PROVIDER_LABEL[m.provider] || m.provider}`)
  : 'প্রতীকী গ্রাফিক · বাংলার ভয়েস';

export async function renderClaim(db, claim, deps = {}) {
  const heartbeat = createRenderHeartbeat(db, claim);
  await heartbeat.renew(); // Validate ownership before touching a claimed job's directory.
  const jobDir = path.join(TMP, claim.job_id);
  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
  const beat = () => heartbeat.renew();
  heartbeat.start();
  try {
    const { data: article, error } = await db.from('articles').select('*').eq('id', claim.article_id).single();
    if (error || !article) throw new Error('Article fetch failed');
    log('📰 ' + String(article.title_bn).slice(0, 80));
    await emitPipelineEvent(db,{jobId:claim.job_id,articleId:claim.article_id,type:'render_started'});

    const plan = buildProductionPlan(article);
    fs.writeFileSync(path.join(jobDir, 'production-plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
    log('🎙️ Voice + captions...');
    const voice = await makeVoice(article, jobDir, beat, deps.synthesizeVoice, heartbeat.signal);
    const spokenScript = normalizeBanglaForTts(voice.script);
    plan.display_script = voice.script; plan.spoken_script = spokenScript;
    plan.excerpts = voice.sentences.map((text, i) => ({ id: `excerpt-${i + 1}`, text, verification: 'not_established_by_this_planner' }));
    plan.spoken_script_sha256 = scriptHash(spokenScript);
    plan.audio_duration = voice.seconds;
    plan.script_selection = voice.selection;
    plan.scenes = timelineFromVtt(fs.readFileSync(voice.subPath, 'utf8'), voice.seconds);
    fs.writeFileSync(path.join(jobDir, 'production-plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
    const key = contentKey(article); const hash = scriptHash(voice.script);
    const reserved = await db.rpc('reserve_video_story', { p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_content_key: key, p_script_hash: hash, p_content_text: voice.script });
    if (reserved.error) {
      if (/duplicate_story_or_script/.test(reserved.error.message)) throw new SkipArticle('duplicate_story_or_script');
      throw new Error('Story reservation: ' + reserved.error.message);
    }

    const total = Math.max(LIMITS.minTotal, voice.seconds + LIMITS.tail);
    const sceneSlots = renderSlotsFromTimeline(plan.scenes, total);
    const wanted = sceneSlots.count;
    const { count, durations } = sceneSlots;
    const agnes = useAgnesVisuals();
    log(agnes ? `🎞️ Agnes AI visuals (${wanted} sequential clips)...` : `🎞️ Symbolic B-roll (want up to ${wanted})...`);
    const media = agnes
      ? await gatherAgnesMedia(plan, sceneSlots, jobDir, beat, heartbeat.signal)
      : await gatherMedia(db, claim, article, jobDir, wanted, beat, deps.media);
    plan.visual_cuts = sceneSlots.boundaries;
    const assignments = agnes
      ? plan.scenes.map((scene, index) => ({
        asset: media[index] || null,
        selection: media[index] ? { method: 'agnes_scene_generation', score: 1, matched: [] } : null,
        rank: null,
      }))
      : assignVisuals(plan.scenes, media, {context: article.title_bn});
    plan.visual_assets = plan.scenes.map((scene, index) => ({
      spoken_text: scene.spoken_text, start: sceneSlots.boundaries[index], end: sceneSlots.boundaries[index + 1],
      asset: assignments[index].asset ? { source_url: assignments[index].asset.source_url, sha256: assignments[index].asset.sha256, license: assignments[index].asset.license, title: assignments[index].asset.title } : null,
      selection: assignments[index].selection,
      classification: agnes ? 'synthetic_realistic' : 'symbolic', relevance_status: 'needs_human_review',
    }));
    fs.writeFileSync(path.join(jobDir, 'production-plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
    log(agnes
      ? `   ${media.length} Agnes clip(s) generated; every clip remains subject to human review`
      : `   ${media.length} licensed asset(s) reserved; ${Math.max(0, count - media.length)} branded motion slot(s) fill the rest`);

    log('🎨 Overlays + compose...');
    const { fontsDir, env } = prepareFonts(jobDir);
    const host = (() => { try { return new URL(process.env.SITE_URL || 'https://bvai-chi.vercel.app').host; } catch { return ''; } })();
    const sourceName = String(article.source_name || 'নিজস্ব প্রতিবেদক').trim();
    const sourceUrl = article.source_url || (process.env.SITE_URL && article.slug ? new URL('/article/' + encodeURIComponent(article.slug), process.env.SITE_URL).href : null);
    const png = (name) => path.join(jobDir, name);
    renderBrandOverlay(png('brand.png'), {
      sourceName,
      visualLabel: agnes ? 'এআই ভিজ্যুয়াল' : undefined,
    }, env);
    renderHeadlineBig(png('head_big.png'), article.title_bn, env);
    renderHeadlineSmall(png('head_small.png'), article.title_bn, env);
    renderEndCard(png('end.png'), { host }, env);
    execFileSync(process.env.PYTHON || 'python3', [path.join(HERE, 'vtt-to-karaoke.py'), voice.subPath, png('voice.ass'), FONT_FAMILY], { timeout: 60000, stdio: 'pipe' });
    // Grapheme/safe-zone check of the burned-in captions: BVAI_CAPTION_QC=shadow (default, log + record) | enforce | off.
    plan.caption_qc = captionGuard(fs.readFileSync(png('voice.ass'), 'utf8'), { log });

    const segments = [];
    for (let i = 0; i < count; i++) {
      const asset = assignments[i].asset;
      renderCreditStrip(png(`credit${i}.png`), creditLine(asset), env);
      const out = png(`seg-${i}.mp4`);
      log(`   Segment ${i + 1}/${count}: ${asset?.kind || 'brand'} (${durations[i].toFixed(1)} s)`);
      await renderSegment({ kind: asset ? asset.kind : 'brand', file: asset?.file, duration: durations[i], creditPng: png(`credit${i}.png`), outFile: out, env, signal: heartbeat.signal });
      segments.push(out);
      await beat();
    }
    const finalFile = png('final_output.mp4');
    log('   Final composition + two-pass audio normalization...');
    await composeFinal({
      jobDir, segments, audioPath: voice.audioPath, assFile: png('voice.ass'), fontsDir, total, outFile: finalFile, env, signal: heartbeat.signal,
      overlays: { brand: png('brand.png'), headBig: png('head_big.png'), headSmall: png('head_small.png'), endCard: png('end.png') },
    });

    await beat(); // Fence a stale worker before it can produce a ready-to-publish manifest.
    const renderSeconds = probeDuration(finalFile);
    const manifest = {
      schema: 2, article_id: claim.article_id, job_id: claim.job_id, claim_token: claim.claim_token, video_path: finalFile,
      audio_duration: voice.seconds, render_duration: renderSeconds, size_bytes: fs.statSync(finalFile).size,
      caption_method: voice.caption_method, script_hash: hash, spoken_script_hash: plan.spoken_script_sha256,
      production_plan: plan, content_key: key, script_chars: voice.script.length,
      symbolic_visuals: !agnes,
      synthetic_realistic: agnes,
      visual_label: agnes ? 'এআই-উৎপাদিত ভিজ্যুয়াল' : 'প্রতীকী ভিজ্যুয়াল',
      source: { name: sourceName, name_bn: sourceNameBn(sourceName), url: sourceUrl },
      media: media.filter(m => assignments.some(a => a.asset === m)).map((m) => ({ provider: m.provider, kind: m.kind, title: m.title, author: m.author, license: m.license, license_url: m.license_url, source_url: m.source_url, sha256: m.sha256, ...(m.synthetic ? { synthetic: true, external_id: m.external_id } : {}) })),
      evidence: [], generated_at: new Date().toISOString(),
    };
    // Render is "confirmed" only when the uploader's own contract passes: probe, full decode, loudness, caption sidecar.
    const quality = await inspectWithRepair(manifest, {inspect: inspectRender, beat, signal: heartbeat.signal, onEvent: async event => {log(JSON.stringify(event));await emitPipelineEvent(db,{jobId:claim.job_id,articleId:claim.article_id,type:'quality_repair_attempt',details:event});}});
    manifest.size_bytes = quality.result.size;
    manifest.render_duration = probeDuration(finalFile);
    manifest.technical_qc = technicalReport(manifest, quality.result);
    manifest.quality_repair_history = quality.history;
    await beat(); // Decode/loudness checks are bounded but can outlive a timer interval.
    // Same-filesystem hard-link publication is atomic and refuses to overwrite an unfinished upload.
    // Shared manifest/claim files still require a single worker per workspace.
    const stagedManifest = path.join(jobDir, 'manifest.ready.json');
    fs.writeFileSync(stagedManifest, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
    try { fs.linkSync(stagedManifest, path.join(TMP, 'manifest.json')); }
    finally { fs.rmSync(stagedManifest, { force: true }); }

    // Confirmed -> delete every downloaded source video/photo and all intermediates; keep only the final MP4, captions, script.
    fs.rmSync(path.join(jobDir, 'dl'), { recursive: true, force: true });
    for (const name of fs.readdirSync(jobDir)) if (!['final_output.mp4', 'voice.vtt', 'script.txt', 'production-plan.json'].includes(name)) fs.rmSync(path.join(jobDir, name), { recursive: true, force: true });
    await emitPipelineEvent(db,{jobId:claim.job_id,articleId:claim.article_id,type:'render_completed',details:{repairs:quality.history.length,duration_sec:manifest.render_duration}});
    log(`✅ Render confirmed: ${(manifest.size_bytes / 1e6).toFixed(1)} MB, ${renderSeconds.toFixed(1)} s; downloaded assets deleted`);
    return manifest;
  } finally { await heartbeat.stop(); }
}

async function failClaim(db, claim, reason, failure) {
  if(failure?.code==='QUALITY_REPAIR_EXHAUSTED')await emitPipelineEvent(db,{jobId:claim.job_id,articleId:claim.article_id,type:'quality_repair_escalated',details:{repairs:failure.repair_history?.length || 0}});
  const { data, error } = await db.rpc('fail_video_generation_job', { p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_reason: scrubSecrets(reason, 300) });
  if (error || data !== true) throw new Error('Failure acknowledgement unavailable; stop before claiming another story');
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
  const result = await runContinuity({
    requested: Boolean(requested), maxClaims: LIMITS.maxClaims,
    claim: async () => {
      const { data, error } = await db.rpc('claim_reviewed_video_job', { p_article_id: requested });
      if (error) throw new Error('Claim failed: ' + scrubSecrets(error.message));
      const claim = data?.[0];
      if (!claim) return null;
      if (process.env.GITHUB_ACTIONS) console.log('::add-mask::' + claim.claim_token);
      fs.writeFileSync(path.join(TMP, 'claim.json'), JSON.stringify(claim), { mode: 0o600 });
      return claim;
    },
    render: claim => renderClaim(db, claim),
    fail: (claim, error) => failClaim(db, claim, error.message, error),
    report: ({ action, error }) => {
      console.error('❌', scrubSecrets(error.message, 300));
      if (action === 'next_story') log('↪ trying the next eligible article without lowering quality');
    },
  });
  if (result.status === 'no_eligible_story') log('ℹ️ No fresh eligible replacement/slot. No video published; alert the operator.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error('❌', error.message); process.exit(1); });
}
