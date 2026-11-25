import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderVideo } from '../ops/worker/ffmpeg-render.mjs';

test('ffmpeg concat + mux produces qc-valid mp4', { skip: !which('ffmpeg') }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
  const clip = path.join(dir, 'c.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
  const audio = path.join(dir, 'a.mp3');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=4', audio]);
  const r = await renderVideo({ clipFiles: [clip, clip], audioPath: audio, workDir: dir });
  assert.equal(r.manifest.qc.decode, true);
  assert.equal(r.manifest.video.codec, 'h264');
  assert.equal(r.manifest.audio.codec, 'aac');
});

function which(bin) {
  try { execFileSync('which', [bin]); return true; } catch { return false; }
}
