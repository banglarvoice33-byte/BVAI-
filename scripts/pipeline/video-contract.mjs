// Shared, dependency-free encode/probe contract. Keep renderer and publisher in agreement.
export const MASTER = Object.freeze({ width: 1080, height: 1920, fps: 30, sampleRate: 48000, channels: 2 });

/** Convert sample values, not just their range tags. Overlays may negotiate RGB/full-range YUV. */
export const MASTER_VIDEO_FILTER = 'scale=iw:ih:in_range=auto:out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709';
export const MASTER_COLOR_ARGS = Object.freeze([
  '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
  '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-bsf:v', 'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
]);

/** ffprobe emits rational strings; Number('0') / Number('0') is NaN, never a valid rate. */
export function rational(value, separator = '/') {
  if (typeof value !== 'string') return NaN;
  const parts = value.split(separator);
  if (parts.length !== 2 || parts.some((part) => !/^\d+$/.test(part))) return NaN;
  const [numerator, denominator] = parts.map(Number);
  const result = numerator / denominator;
  return Number.isFinite(result) && numerator > 0 && denominator > 0 ? result : NaN;
}

/** Pure metadata validation; inspectRender additionally verifies captions, full decode and loudness. */
export function validateMasterProbe(probe, audioDuration) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videos = streams.filter((stream) => stream.codec_type === 'video');
  const audios = streams.filter((stream) => stream.codec_type === 'audio');
  const video = videos[0]; const audio = audios[0];
  const duration = Number(probe?.format?.duration);
  const failures = [];
  if (videos.length !== 1 || audios.length !== 1) failures.push('exactly one video and one audio stream');
  if (video?.codec_name !== 'h264' || video?.width !== MASTER.width || video?.height !== MASTER.height || video?.pix_fmt !== 'yuv420p') {
    failures.push(`1080×1920 H.264/yuv420p (got ${video?.width ?? '?'}×${video?.height ?? '?'} ${video?.codec_name ?? 'missing'}/${video?.pix_fmt ?? 'missing'})`);
  }
  const fps = rational(video?.avg_frame_rate);
  if (!Number.isFinite(fps) || Math.abs(fps - MASTER.fps) > 0.01) failures.push(`30 fps (got ${video?.avg_frame_rate ?? 'missing'})`);
  if (rational(video?.sample_aspect_ratio, ':') !== 1) failures.push(`square pixels SAR 1:1 (got ${video?.sample_aspect_ratio ?? 'missing'})`);
  if (video?.color_range !== 'tv') failures.push(`limited color range tv (got ${video?.color_range ?? 'missing'})`);
  if (['color_space', 'color_transfer', 'color_primaries'].some((field) => video?.[field] !== 'bt709')) failures.push('explicit BT.709 matrix/transfer/primaries');
  if (audio?.codec_name !== 'aac') failures.push(`AAC audio (got ${audio?.codec_name ?? 'missing'})`);
  if (Number(audio?.sample_rate) !== MASTER.sampleRate || audio?.channels !== MASTER.channels) failures.push('48 kHz stereo audio');
  if (!Number.isFinite(duration) || duration < 40 || duration > 120) failures.push('Video duration must be 40–120 seconds');
  if (!Number.isFinite(audioDuration) || audioDuration <= 0 || duration + 0.5 < audioDuration) failures.push('Render truncates narration or narration duration is invalid');
  if (failures.length) throw new Error(`Invalid delivery master: ${failures.join('; ')}`);
  return { video, audio, duration };
}
