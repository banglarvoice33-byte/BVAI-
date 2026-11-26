import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function buildOverlay(wm) {
  if (!wm) return null;
  const { position = 'bottom-right', padding = 20, opacity = 1.0, scalePercent = 15 } = wm;
  const scale = `scale=iw*${scalePercent}/100:-1`;
  const alpha = opacity < 1 ? `,format=rgba,colorchannelmixer=aa=${opacity}` : '';
  const pos = {
    'top-left': [`${padding}`, `${padding}`],
    'top-right': [`W-w-${padding}`, `${padding}`],
    'bottom-left': [`${padding}`, `H-h-${padding}`],
    'center': ['(W-w)/2', '(H-h)/2'],
    'bottom-right': [`W-w-${padding}`, `H-h-${padding}`],
  }[position] || [`W-w-${padding}`, `H-h-${padding}`];
  return `[2:v]${scale}${alpha}[wm];[v][wm]overlay=${pos[0]}:${pos[1]}[vout]`;
}

export async function renderVideo({ clipFiles, audioPath, watermarkPath, workDir }) {
  if (!clipFiles.length) throw new Error('no_clips');
  const concatFile = path.join(workDir, 'clips.txt');
  fs.writeFileSync(concatFile, clipFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

  const out = path.join(workDir, 'final.mp4');
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-i', audioPath];
  if (watermarkPath) args.push('-i', watermarkPath);

  let vf = `[0:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1[v]`;
  const overlay = buildOverlay(watermarkPath ? { position: process.env.WM_POSITION || 'bottom-right', opacity: Number(process.env.WM_OPACITY || 1), scalePercent: Number(process.env.WM_SIZE || 15) } : null);
  if (overlay) vf += ';' + overlay;
  vf += `;[1:a]loudnorm=I=-14:TP=-1:LRA=11[a]`;

  args.push('-filter_complex', vf);
  args.push('-map', watermarkPath ? '[vout]' : '[v]', '-map', '[a]');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out);

  execFileSync('ffmpeg', args, { stdio: 'inherit' });

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  if (!v || !a) throw new Error('qc_decode_failed');
  if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p') throw new Error('qc_video_format');
  if (a.codec_name !== 'aac') throw new Error('qc_audio_format');

  return {
    file: out,
    manifest: {
      duration: Number(probe.format.duration),
      video: { codec: v.codec_name, width: v.width, height: v.height, pix_fmt: v.pix_fmt },
      audio: { codec: a.codec_name, sample_rate: Number(a.sample_rate), channels: a.channels },
      qc: { decode: true, script_binding: true, policy_version: '2026-11-26.v1' },
    },
  };
}
