import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createAgnesClient } from './agnes-client.mjs';
import { synthesizeTts } from './tts-client.mjs';
import { renderVideo } from './ffmpeg-render.mjs';
import { claimJob, heartbeat, finalizeJob, failJob, logEvent } from './job-control.mjs';

const WORKER_ID = `render-worker-${process.env.RENDER_INSTANCE_ID || os.hostname()}`;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const agnes = createAgnesClient({ apiKey: process.env.AGNES_API_KEY });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitScript(text) {
  const sentences = String(text || '').split(/(?<=[।!?])\s+/).filter(Boolean);
  const scenes = [];
  let buf = '';
  for (const s of sentences) {
    buf = buf ? `${buf} ${s}` : s;
    if (buf.length > 80) { scenes.push(buf); buf = ''; }
  }
  if (buf) scenes.push(buf);
  return scenes.length ? scenes : ['সংবাদ প্রতিবেদন'];
}

async function runOne(job) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bvai-'));
  const hb = setInterval(() => heartbeat(db, job.id, WORKER_ID, 900).catch(() => {}), 60000);
  try {
    await logEvent(db, job.id, 'started');
    const scenes = splitScript(job.payload?.script || job.script_text || job.payload?.narration || '');
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
    const tts = await synthesizeTts(job.payload?.script || job.script_text || '', audioPath);
    await logEvent(db, job.id, 'tts_ready', { provider: tts.provider });

    const { file, manifest } = await renderVideo({ clipFiles, audioPath, watermarkPath: process.env.WATERMARK_PNG_PATH, workDir });
    const sha = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    await finalizeJob(db, job.id, WORKER_ID, { video_sha256: sha, manifest });
    await logEvent(db, job.id, 'finished', { sha, duration: manifest.duration });
  } catch (err) {
    await failJob(db, job.id, WORKER_ID, err.message);
    await logEvent(db, job.id, 'failed', { message: err.message });
  } finally {
    clearInterval(hb);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function loop() {
  while (true) {
    try {
      const job = await claimJob(db, WORKER_ID, 900);
      if (!job) { await sleep(5000); continue; }
      await runOne(job);
    } catch (e) {
      console.error('worker_loop_error', e.message);
      await sleep(10000);
    }
  }
}
loop();
