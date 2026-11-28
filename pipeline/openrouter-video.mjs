/**
 * OpenRouter video generation client (submit + poll).
 *
 * Verified against the OpenRouter API reference (2026-11-27):
 *  - POST https://openrouter.ai/api/v1/videos, only "model" is required
 *  - fields used here: prompt, aspect_ratio, duration, resolution, generate_audio, callback_url
 *  - there is no negative_prompt field
 *  - the 202 response carries polling_url as a RELATIVE path ("/api/v1/videos/<id>")
 *  - status values: pending, in_progress, completed, failed, cancelled, expired
 *  - "urls" are signed download links, "unsigned_urls" need the API key
 */

const ORIGIN = 'https://openrouter.ai';
export const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21', '2:1', '5:2']);
export const RESOLUTIONS = new Set(['360p', '480p', '720p', '768p', '1080p', '1K', '2K', '4K']);
const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired']);

/**
 * @param {{ model: string, prompt: string, aspectRatio?: string, duration: number, resolution?: string,
 *           generateAudio?: boolean, supportedDurations?: number[], callbackUrl?: string }} o
 */
export function buildVideoRequest(o) {
  const aspect = o.aspectRatio ?? '9:16';
  const resolution = o.resolution ?? '720p';
  if (!o.model) throw new Error('model is required');
  if (!o.prompt || !o.prompt.trim()) throw new Error('prompt is empty');
  if (!ASPECT_RATIOS.has(aspect)) throw new Error(`unsupported aspect_ratio ${aspect}`);
  if (!RESOLUTIONS.has(resolution)) throw new Error(`unsupported resolution ${resolution}`);
  if (!Number.isInteger(o.duration) || o.duration < 1) throw new Error('duration must be a positive integer (seconds)');
  if (o.supportedDurations && !o.supportedDurations.includes(o.duration)) {
    throw new Error(`duration ${o.duration}s is not in the model's supported durations: ${o.supportedDurations.join(', ')}`);
  }
  if (o.callbackUrl && !o.callbackUrl.startsWith('https://')) throw new Error('callback_url must be HTTPS');
  return {
    model: o.model,
    prompt: o.prompt,
    aspect_ratio: aspect,
    duration: o.duration,
    resolution,
    generate_audio: o.generateAudio ?? false,
    ...(o.callbackUrl ? { callback_url: o.callbackUrl } : {}),
  };
}

/** Turns the relative polling_url from the API into an absolute URL. @param {string} pollingUrl */
export function resolvePollingUrl(pollingUrl) {
  return new URL(pollingUrl, ORIGIN).toString();
}

/** @param {object} request @param {{ apiKey: string, fetchImpl?: typeof fetch }} ctx */
export async function submitVideo(request, ctx) {
  if (!ctx.apiKey) throw new Error('OPENROUTER_API_KEY is missing');
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(`${ORIGIN}/api/v1/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (res.status !== 202 && !res.ok) {
    throw new Error(`OpenRouter submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const job = await res.json();
  if (!job.id || !job.polling_url) throw new Error('OpenRouter response has no id/polling_url');
  return { id: job.id, pollingUrl: resolvePollingUrl(job.polling_url), status: job.status };
}

/**
 * Polls until the job is completed. Throws on failed/cancelled/expired or timeout.
 * @param {string} pollingUrl absolute URL from submitVideo()
 * @param {{ apiKey: string, fetchImpl?: typeof fetch, intervalMs?: number, timeoutMs?: number,
 *           sleep?: (ms: number) => Promise<void>, now?: () => number }} ctx
 */
export async function pollVideo(pollingUrl, ctx) {
  const doFetch = ctx.fetchImpl ?? fetch;
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = ctx.now ?? Date.now;
  const intervalMs = ctx.intervalMs ?? 5000;
  const deadline = now() + (ctx.timeoutMs ?? 10 * 60_000);
  for (;;) {
    const res = await doFetch(pollingUrl, { headers: { Authorization: `Bearer ${ctx.apiKey}` } });
    if (!res.ok) throw new Error(`OpenRouter poll ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    if (data.status === 'completed') {
      return {
        signedUrls: data.urls ?? [],
        unsignedUrls: data.unsigned_urls ?? [], // need the Authorization header to download
        costUsd: data.usage?.cost ?? null,
      };
    }
    if (TERMINAL_FAILURES.has(data.status)) {
      throw new Error(`video job ${data.status}${data.error ? `: ${data.error}` : ''}`);
    }
    if (now() >= deadline) throw new Error('video job timed out');
    await sleep(intervalMs);
  }
}
