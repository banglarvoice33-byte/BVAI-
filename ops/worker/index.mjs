import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createAgnesClient } from './agnes-client.mjs';
import { synthesizeTts } from './tts-client.mjs';
import { renderVideo } from './ffmpeg-render.mjs';
import { claimJob, heartbeat, finalizeJob, failJob, logEvent, sha256 } from './job-control.mjs';

const WORKER_ID = `render-worker-${process.env.RENDER_INSTANCE_ID || os.hostname()}`;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const agnes = createAgnesClient({ apiKey: process.env.AGNES_API_KEY });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitScript(text) {
  const sentences = String(text || '')
    .split(/(?<=[\u0964!?])\s+/)
    .filter(Boolean);
  const scenes = [];
  let buf = '';
  for (const s of sentences) {
    buf = buf ? `${buf} ${s}` : s;
    if (buf.length > 80) {
      scenes.push(buf);
      buf = '';
    }
  }
  if (buf) scenes.push(buf);
  return (scenes.length ? scenes : ['\u09b8\u0982\u09ac\u09be\u09a6 \u09aa\u09cd\u09b0\u09a4\u09bf\u09ac\u09c7\u09a6\u09a8']).slice(0, 6);
}

async function resolveScript(job) {
  const fromJob =
    (job.payload && (job.payload.script || job.payload.narration)) ||
    job.script_text ||
    '';
  if (String(fromJob).trim().length >= 40) return String(fromJob).trim();

  if (!job.article_id) return '\u09b8\u0982\u09ac\u09be\u09a6 \u09aa\u09cd\u09b0\u09a4\u09bf\u09ac\u09c7\u09a6\u09a8';

  const { data: article, error } = await db
    .from('articles')
    .select('title_bn, content_bn, summary_bn')
    .eq('id', job.article_id)
    .maybeSingle();
  if (error) throw new Error(`article_load: ${error.message}`);
  if (!article) return '\u09b8\u0982\u09ac\u09be\u09a6 \u09aa\u09cd\u09b0\u09a4\u09bf\u09ac\u09c7\u09a6\u09a8';

  const body = String(article.content_bn || article.summary_bn || '').trim();
  const title = String(article.title_bn || '').trim();
  const combined = [title, body].filter(Boolean).join('\u0964 ').slice(0, 1200);
  return combined.length >= 40 ? combined : title || '\u09b8\u0982\u09ac\u09be\u09a6 \u09aa\u09cd\u09b0\u09a4\u09bf\u09ac\u09c7\u09a6\u09a8';
}

async function uploadToReels(localFile, job, fileSha) {
  const articleId = job.article_id || 'unknown';
  const storagePath = `${articleId}/${job.id}-${fileSha.slice(0, 32)}.mp4`;
  const bytes = fs.readFileSync(localFile);
  const { error } = await db.storage.from('reels').upload(storagePath, bytes, {
    contentType: 'video/mp4',
    upsert: false,
  });
  if (error) {
    if (!/already exists|Duplicate|409/i.test(error.message || '')) {
      throw new Error(`storage_upload: ${error.message}`);
    }
  }
  return storagePath;
}

async function runOne(job) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bvai-'));
  const hb = setInterval(() => heartbeat(db, job.id, WORKER_ID, 900).catch(() => {}), 60000);
  try {
    await logEvent(db, job.id, 'started');
    const script = await resolveScript(job);
    await db
      .from('agnes_video_jobs')
      .update({
        script_text: script,
        payload: { ...(job.payload || {}), script },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    const scenes = splitScript(script);
    await logEvent(db, job.id, 'script_ready', { scenes: scenes.length, chars: script.length });

    const clipFiles = [];
    for (const [i, scene] of scenes.entries()) {
      const videoId = await agnes.create({ prompt: scene, seconds: '8', aspect_ratio: '9:16' });
      const url = await agnes.poll(videoId);
      const dest = path.join(workDir, `clip-${i}.mp4`);
      await agnes.download(url, dest, fs);
      clipFiles.push(dest);
      await logEvent(db, job.id, 'clip_ready', { index: i });
    }

    const audioPath = path.join(workDir, 'voice.mp3');
    const tts = await synthesizeTts(script, audioPath);
    await logEvent(db, job.id, 'tts_ready', { provider: tts.provider });

    const { file, manifest } = await renderVideo({
      clipFiles,
      audioPath,
      watermarkPath: process.env.WATERMARK_PNG_PATH || '',
      workDir,
    });
    const fileSha = sha256(fs.readFileSync(file));
    let storagePath = null;
    try {
      storagePath = await uploadToReels(file, job, fileSha);
      await logEvent(db, job.id, 'storage_uploaded', { path: storagePath });
    } catch (uploadErr) {
      await logEvent(db, job.id, 'storage_upload_failed', { message: uploadErr.message });
      console.error('storage_upload_failed', uploadErr.message);
    }

    const fullManifest = {
      ...manifest,
      script_hash: sha256(script),
      storage_path: storagePath,
      worker_id: WORKER_ID,
    };
    await finalizeJob(db, job.id, WORKER_ID, {
      video_sha256: fileSha,
      manifest: fullManifest,
      storage_path: storagePath,
    });
    await logEvent(db, job.id, 'finished', {
      sha: fileSha,
      duration: manifest?.duration,
      storage_path: storagePath,
    });
  } catch (err) {
    await failJob(db, job.id, WORKER_ID, err.message);
    await logEvent(db, job.id, 'failed', { message: err.message });
    console.error('job_failed', job.id, err.message);
  } finally {
    clearInterval(hb);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function loop() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    process.exit(1);
  }
  if (!process.env.AGNES_API_KEY) {
    console.error('FATAL: AGNES_API_KEY missing');
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      event: 'agnes_worker_start',
      worker_id: WORKER_ID,
      publish_mode: process.env.VIDEO_PUBLISH_MODE || '',
      platforms: process.env.VIDEO_DELIVERY_PLATFORMS || '',
    }),
  );
  while (true) {
    try {
      const job = await claimJob(db, WORKER_ID, 900);
      if (!job) {
        await sleep(5000);
        continue;
      }
      console.log(JSON.stringify({ event: 'job_claimed', job_id: job.id, article_id: job.article_id }));
      await runOne(job);
    } catch (e) {
      console.error('worker_loop_error', e.message);
      await sleep(10000);
    }
  }
}

loop();
