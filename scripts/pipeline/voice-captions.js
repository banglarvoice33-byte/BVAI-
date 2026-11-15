import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { synthesizeVoiceRouted } from './tts-router.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export function audioDuration(file) {
  const value = Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file], { encoding: 'utf8', timeout: 15000 }).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('Audio duration is invalid');
  return value;
}
export function timestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
export function validateVtt(content, duration) {
  if (!content.startsWith('WEBVTT')) throw new Error('Not a WEBVTT caption file');
  const toSec = v => { const [h,m,s] = v.split(':').map(Number); return h*3600+m*60+s; };
  let count = 0; let previousEnd = 0;
  for (const block of content.split(/\r?\n\s*\r?\n/)) {
    const match = block.match(/(\d{2,}:\d{2}:\d{2}\.\d{3}) --> (\d{2,}:\d{2}:\d{2}\.\d{3})\r?\n([^]*)/);
    if (!match) continue;
    const start = toSec(match[1]); const end = toSec(match[2]);
    if (!match[3].trim() || end <= start || start < previousEnd - 0.02 || end > duration + 0.25) throw new Error('Invalid or overlapping caption timing');
    count++; previousEnd = end;
  }
  if (!count) throw new Error('No timed captions returned');
  return count;
}
// Secrets must never reach a log, a job row or a GitHub annotation: the message below is stored in the database.
export function scrubSecrets(value, max = 160) {
  return String(value ?? '')
    .replace(/(?:gsk_|sk-)[A-Za-z0-9_-]{8,}/g, '[key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [key]')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
// Any one of these enables the actual-audio (Whisper) caption path. GROQ_API_KEY_VAULT and CAPTION_OPENAI_API_KEY are
// hydrated from the Supabase vault, so a stale GitHub secret can no longer block captions on its own.
export function captionKeysPresent(env = process.env) {
  return Boolean(env.GROQ_API_KEY || env.GROQ_API_KEY_VAULT || env.CAPTION_OPENAI_API_KEY);
}
export async function synthesizeVoice(text, audioPath, subPath) {
  const tmp = path.dirname(audioPath);
  fs.mkdirSync(tmp, { recursive: true });
  const textPath = path.join(tmp, 'script.txt');
  fs.writeFileSync(textPath, text, 'utf8');
  fs.rmSync(audioPath, { force: true }); fs.rmSync(subPath, { force: true });
  let routerOk = false;
  try {
    const result = await synthesizeVoiceRouted(text, { outFile: audioPath });
    audioDuration(audioPath); routerOk = true;
    console.log('   ✅ Voice via router: ' + result.provider);
  } catch (error) {
    console.warn('   ⚠️ Router unavailable: ' + error.message.slice(0, 200));
  }
  // Caption the ACTUAL router audio. Never reuse timings from another voice.
  let whisperFailure = '';
  if (routerOk && captionKeysPresent()) {
    try {
      execFileSync(process.env.PYTHON || 'python3', [path.join(HERE,'whisper-caption.py'),audioPath,subPath,'--script-file',textPath], { timeout: 150000, stdio: 'pipe' });
      const count = validateVtt(fs.readFileSync(subPath,'utf8'), audioDuration(audioPath));
      console.log(`   ✅ Groq Whisper captions: ${count} words`);
      return { method: 'groq-whisper', timed: true };
    } catch (error) {
      const raw = error.stderr?.toString() || error.message;
      whisperFailure = scrubSecrets(raw.replace(/^\s*Caption failed:\s*/, ''), 190);
      console.warn('   ⚠️ Actual-audio captioning failed: ' + scrubSecrets(raw, 400));
      fs.rmSync(subPath,{ force:true });
    }
  }
  // Edge captions are allowed only WITH the matching Edge audio, not scaled onto router speech.
  // When the router succeeded, repeated failing Edge requests are skipped by default.
  // Without a Groq key (or after a Whisper failure) the only accurate caption source is Edge TTS with ITS OWN audio.
  // Never block the newsroom on a missing paid key: use the matched Edge voice instead of failing.
  let edgeFailure = '';
  if (!routerOk || process.env.EDGE_CAPTION_FALLBACK === 'true' || !captionKeysPresent() || !fs.existsSync(subPath)) {
    const edgeAudio = path.join(tmp,'edge_tmp.mp3'); const edgeVtt = path.join(tmp,'edge_tmp.vtt');
    try {
      for (const voice of ['bn-BD-PradeepNeural','bn-BD-NabanitaNeural']) {
        fs.rmSync(edgeAudio,{ force:true }); fs.rmSync(edgeVtt,{ force:true });
        try {
          execFileSync(process.env.PYTHON || 'python3', ['-m','edge_tts','--voice',voice,'--rate=-8%','--pitch=-2Hz','--volume=+5%','--file',textPath,'--write-media',edgeAudio,'--write-subtitles',edgeVtt], { timeout: 90000, stdio: 'pipe' });
          validateVtt(fs.readFileSync(edgeVtt,'utf8'),audioDuration(edgeAudio));
          fs.copyFileSync(edgeAudio,audioPath); fs.copyFileSync(edgeVtt,subPath);
          console.log('   ✅ Matched Edge voice + subtitles: ' + voice);
          return { method:'edge-matched', timed:true };
        } catch (error) { const why = scrubSecrets(error.stderr?.toString() || error.message, 180); edgeFailure = `${voice.split('-')[2] || voice}: ${why.slice(0, 40)}`; console.warn(`   ⚠️ ${voice}: ${why}`); }
      }
    } finally { fs.rmSync(edgeAudio,{ force:true }); fs.rmSync(edgeVtt,{ force:true }); }
  }
  if (!routerOk) throw new Error('All TTS providers failed');
  if (process.env.VIDEO_REQUIRE_CAPTIONS !== 'false') {
    // The text is stored in video_generation_jobs.error_message (300 chars): lead with the real cause, not a generic hint.
    const causes = [whisperFailure ? `whisper: ${whisperFailure}` : 'no caption API key reached the renderer', edgeFailure && `edge: ${edgeFailure}`].filter(Boolean).join('; ');
    throw new Error(`Accurate captions unavailable (${causes}); video NOT published.`);
  }
  fs.writeFileSync(subPath,'WEBVTT\n\n','utf8');
  return { method:'none', timed:false };
}
