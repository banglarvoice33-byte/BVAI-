// EBU R128 loudness measurement + two-pass normalisation helpers (ffmpeg loudnorm, no extra deps).
// upload-supabase-video.mjs gates every render on -14 LUFS ±2 and true peak <= -1 dBTP.
import { spawnSync } from 'node:child_process';

export const LOUDNESS_TARGET = Object.freeze({ I: -14, TP: -1.5, LRA: 11 });

export function parseLoudnormJson(stderr) {
  const blocks = String(stderr || '').match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks?.length) throw new Error('loudnorm measurement missing from ffmpeg output');
  const parsed = JSON.parse(blocks[blocks.length - 1]);
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh']) {
    if (!Number.isFinite(Number(parsed[key]))) throw new Error(`loudnorm ${key} is not numeric (silent or unreadable audio)`);
  }
  return parsed;
}

/** Measure integrated loudness (input_i, LUFS) and true peak (input_tp, dBTP) of any media file's audio. */
export function measureAudio(file, target = LOUDNESS_TARGET) {
  const run = spawnSync('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file, '-vn',
    '-af', `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:print_format=json`,
    '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) throw new Error('ffmpeg could not analyse audio loudness');
  return parseLoudnormJson(run.stderr);
}

/** Second-pass filter string that applies the measured values linearly (no pumping, exact target). */
export function loudnormFilter(measured, target = LOUDNESS_TARGET) {
  return `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}`
    + `:measured_I=${Number(measured.input_i)}:measured_TP=${Number(measured.input_tp)}`
    + `:measured_LRA=${Number(measured.input_lra)}:measured_thresh=${Number(measured.input_thresh)}`
    + `:offset=${Number(measured.target_offset ?? 0)}:linear=true:print_format=summary`;
}

export function loudnessOk(measured) {
  return Math.abs(Number(measured.input_i) + 14) <= 2 && Number(measured.input_tp) <= -1;
}

// ── Compatibility surface used by the repository's existing tests and callers (tests/repair-contract.test.mjs) ──
/** Lenient parser: only integrated loudness and true peak are required (silent/-inf audio is rejected). */
export function parseLoudness(text) {
  const blocks = String(text).match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks?.length) throw new Error('Loudness measurement missing');
  const value = JSON.parse(blocks.at(-1));
  if (!Number.isFinite(Number(value.input_i)) || !Number.isFinite(Number(value.input_tp))) throw new Error('Silent/invalid audio');
  return value;
}
export { measureAudio as measureEncodedAudio };

/** Two-pass loudnorm to a 48 kHz stereo PCM file (measure first, then apply the measured values linearly). */
export function normalizeAudio(input, output) {
  const measured = measureAudio(input);
  const run = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', input, '-af', loudnormFilter(measured), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output],
    { encoding: 'utf8', timeout: 180000 });
  if (run.status !== 0) throw new Error('ffmpeg loudness normalisation failed');
}
