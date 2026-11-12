import { execFileSync } from 'node:child_process';

/** Measure the actual encoded stream, not requested encoder parameters. */
export function measureAudio(filename) {
  return runMeasurement(filename);
}
export function parseLoudness(text) {
  const blocks = String(text).match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks?.length) throw new Error('Loudness measurement missing');
  const value = JSON.parse(blocks.at(-1));
  if (!Number.isFinite(Number(value.input_i)) || !Number.isFinite(Number(value.input_tp))) throw new Error('Silent/invalid audio');
  return value;
}
export function normalizeAudio(input, output) {
  // ffmpeg emits loudnorm JSON on stderr. Capture it explicitly for two-pass QC.
  const first = runMeasurement(input);
  const filter = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${first.input_i}:measured_TP=${first.input_tp}:measured_LRA=${first.input_lra}:measured_thresh=${first.input_thresh}:offset=${first.target_offset}:linear=true`;
  execFileSync('ffmpeg',['-y','-v','error','-i',input,'-af',filter,'-ar','48000','-ac','2','-c:a','pcm_s16le',output],{timeout:180000,stdio:'pipe'});
}
function runMeasurement(filename) {
  // spawnSync is used because successful execFileSync returns stdout only.
  const { stderr, status, error } = spawnMeasurement(filename);
  if(error || status!==0) throw new Error('Audio measurement failed');
  return parseLoudness(stderr);
}
import { spawnSync } from 'node:child_process';
function spawnMeasurement(filename) {
  return spawnSync('ffmpeg',['-hide_banner','-nostats','-i',filename,'-vn','-af','loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
}
export { runMeasurement as measureEncodedAudio };
