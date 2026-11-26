export function createAgnesClient({ apiKey, baseUrl }) {
  if (!apiKey) throw new Error('AGNES_API_KEY missing');
  const base = baseUrl || 'https://apihub.agnes-ai.com/v1';
  const model = 'agnes-video-2.5-flash';
  const host = new URL(base).origin;

  const create = async ({ prompt, seconds = '8', aspect_ratio = '9:16' }) => {
    const r = await fetch(`${base}/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, seconds, size: '720P', aspect_ratio, mode: 'text' }),
    });
    if (!r.ok) throw new Error(`agnes_create_${r.status}`);
    const j = await r.json();
    const id = j.video_id || j.task_id || j.id;
    if (!id) throw new Error('agnes_create_missing_id');
    return id;
  };

  const poll = async (videoId, { intervalMs = 3000, timeoutMs = 300000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await fetch(
        `${host}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${model}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!r.ok) throw new Error(`agnes_poll_${r.status}`);
      const j = await r.json();
      if (j.status === 'completed' && j.url) return j.url;
      if (j.status === 'failed') throw new Error(`agnes_task_failed:${j.error || ''}`);
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    throw new Error('agnes_poll_timeout');
  };

  const download = async (url, destPath, fsMod) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`agnes_download_${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await fsMod.promises.writeFile(destPath, buf);
    return destPath;
  };

  return { create, poll, download };
}
