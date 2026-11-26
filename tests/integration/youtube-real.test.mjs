// Real YouTube OAuth + upload scope test. Requires OAUTH_CLIENT_ID,
// OAUTH_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, YOUTUBE_CHANNEL_ID.
import test from 'node:test';
import assert from 'node:assert/strict';

const NEEDED = ['OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_CHANNEL_ID'];
const missing = NEEDED.filter((k) => !process.env[k]);
const skip = missing.length ? `missing: ${missing.join(', ')}` : false;

async function refreshAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token_refresh_${r.status}`);
  return (await r.json()).access_token;
}

test('youtube refresh token has upload scope and channel id is valid', { skip }, async () => {
  const token = await refreshAccessToken();
  const r = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(r.status, 200, 'channels.list must succeed');
  const j = await r.json();
  const ch = j.items?.[0];
  assert.ok(ch, 'no channel returned');
  assert.match(process.env.YOUTUBE_CHANNEL_ID, /^UC[\w-]{22}$/, 'YOUTUBE_CHANNEL_ID must start with UC');
  console.log(`[youtube-real] channel=${ch.snippet.title} id=${ch.id}`);
});

test('youtube videos.insert accepts a small test upload', { skip, timeout: 120_000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-real-'));
  const mp4 = path.join(dir, 'probe.mp4');
  try {
    execFileSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4,
    ]);
    const token = await refreshAccessToken();
    const init = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: { title: 'BVAI integration probe', description: 'auto-test', categoryId: '25' },
          status: { privacyStatus: 'private' },
        }),
      },
    );
    assert.equal(init.status, 200, 'resumable init failed');
    const location = init.headers.get('location');
    assert.ok(location, 'no resumable upload URL');
    const body = fs.readFileSync(mp4);
    const up = await fetch(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body,
    });
    assert.ok(up.status === 200 || up.status === 201, `upload failed: ${up.status}`);
    const upj = await up.json();
    assert.ok(upj.id, 'no video id returned');
    console.log(`[youtube-real] uploaded private video id=${upj.id} — delete it manually`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
