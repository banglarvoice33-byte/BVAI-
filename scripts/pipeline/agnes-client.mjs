/**
 * Agnes Video 2.5 adapter.
 *
 * The adapter is intentionally provider-specific and side-effect free apart from
 * HTTP calls and streamed downloads. It never logs credentials or raw provider
 * responses. The caller owns job state, leases, and retries across jobs.
 *
 * Verified API contract:
 * - POST /v1/videos
 * - GET /agnesapi?video_id=<id>&model_name=<model>
 * - Flash model: agnes-video-2.5-flash
 * - Flash size: 720P
 * - seconds: string "4" through "12"
 */

import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const DEFAULT_MODEL = 'agnes-video-2.5-flash';
const DEFAULT_SIZE = '720P';
const DEFAULT_ASPECT_RATIO = '9:16';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_BACKOFF_MS = 30_000;

export class AgnesApiError extends Error {
  constructor(message, { statusCode = 502, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'AgnesApiError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/** Resolve indexed server-side keys in deterministic order without logging values. */
export function getAgnesKeyCandidates(env = process.env, max = 5) {
  const candidates = [];
  for (let index = 1; index <= max; index += 1) {
    const value = env[`AGNES_API_KEY_${index}`] || env[`VIDEO_AGNES_API_KEY_${index}`];
    if (value) candidates.push({ index, key: value });
  }
  if (!candidates.length && env.AGNES_API_KEY) candidates.push({ index: 1, key: env.AGNES_API_KEY });
  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.key === candidate.key) === index);
}

export function createAgnesClient({
  baseUrl = process.env.AGNES_BASE_URL || DEFAULT_BASE_URL,
  apiKey = process.env.AGNES_API_KEY,
  model = process.env.AGNES_MODEL || DEFAULT_MODEL,
  size = process.env.AGNES_SIZE || DEFAULT_SIZE,
  aspectRatio = process.env.AGNES_ASPECT_RATIO || DEFAULT_ASPECT_RATIO,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  nowImpl = () => Date.now(),
} = {}) {
  if (!apiKey) throw new AgnesApiError('AGNES_API_KEY is required', { statusCode: 500 });
  if (typeof fetchImpl !== 'function') throw new AgnesApiError('A fetch implementation is required', { statusCode: 500 });

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '');
  const createEndpoint = `${normalizedBaseUrl}/videos`;
  const pollEndpoint = `${normalizedBaseUrl.replace(/\/v1$/, '')}/agnesapi`;

  return {
    async createVideoTask({ prompt, seconds }) {
      validatePrompt(prompt);
      const duration = validateSeconds(seconds);
      validateFlashOptions({ model, size, aspectRatio });

      const response = await request(fetchImpl, createEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt: String(prompt).trim(),
          mode: 'text',
          seconds: String(duration),
          size,
          aspect_ratio: aspectRatio,
          n: 1,
        }),
      });

      const payload = await readJson(response, 'Agnes create task');
      const videoId = payload.video_id || payload.id || payload.task_id;
      if (!videoId) {
        throw new AgnesApiError('Agnes create response did not include a video ID', { statusCode: 502 });
      }
      return String(videoId);
    },

    async waitForVideo({
      videoId,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    }) {
      if (!videoId) throw new AgnesApiError('Agnes video ID is required', { statusCode: 400 });
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AgnesApiError('Agnes timeout must be positive', { statusCode: 400 });
      if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw new AgnesApiError('Agnes poll interval must be positive', { statusCode: 400 });

      const startedAt = nowImpl();
      let attempt = 0;
      while (nowImpl() - startedAt < timeoutMs) {
        attempt += 1;
        const url = new URL(pollEndpoint);
        url.searchParams.set('video_id', String(videoId));
        url.searchParams.set('model_name', model);

        let response;
        try {
          response = await fetchImpl(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
        } catch (error) {
          await sleepImpl(backoffDelay(attempt));
          continue;
        }

        if (response.status === 429 || response.status >= 500) {
          await sleepImpl(backoffDelay(attempt));
          continue;
        }
        if (!response.ok) await throwHttpError(response, 'Agnes poll');

        const payload = await readJson(response, 'Agnes poll');
        const status = String(payload.status || payload.state || '').toLowerCase();
        if (status === 'completed' || status === 'succeeded' || status === 'success') {
          const videoUrl = payload.url || payload.video_url || payload.result?.url || payload.result?.video_url;
          if (!videoUrl) throw new AgnesApiError('Agnes completed without a video URL', { statusCode: 502 });
          return { videoId: String(videoId), url: String(videoUrl), payload };
        }
        if (status === 'failed' || status === 'error' || status === 'canceled' || status === 'cancelled') {
          const detail = payload.error?.message || payload.error || payload.failure_reason || 'Agnes video generation failed';
          throw new AgnesApiError(safeProviderMessage(detail), { statusCode: 502 });
        }
        await sleepImpl(pollIntervalMs);
      }
      throw new AgnesApiError(`Agnes video generation timed out after ${timeoutMs} ms`, { statusCode: 504, retryable: true });
    },

    async downloadVideo(url, outputPath) {
      validateHttpsUrl(url);
      if (!outputPath || typeof outputPath !== 'string') throw new AgnesApiError('Output path is required', { statusCode: 400 });
      await fsp.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
      const response = await fetchImpl(url);
      if (!response.ok) await throwHttpError(response, 'Agnes video download');
      if (!response.body) throw new AgnesApiError('Agnes video response has no readable body', { statusCode: 502, retryable: true });
      await pipeline(response.body, fs.createWriteStream(outputPath, { flags: 'wx' }));
      return outputPath;
    },
  };
}

function validateFlashOptions({ model, size, aspectRatio }) {
  if (model === DEFAULT_MODEL && size !== DEFAULT_SIZE) throw new AgnesApiError('Agnes Video 2.5 Flash requires AGNES_SIZE=720P', { statusCode: 400 });
  if (!/^(?:\d{1,4}:\d{1,4})$/.test(String(aspectRatio))) throw new AgnesApiError('AGNES_ASPECT_RATIO must be WIDTH:HEIGHT', { statusCode: 400 });
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length < 10) throw new AgnesApiError('Agnes prompt must contain at least 10 characters', { statusCode: 400 });
}

function validateSeconds(seconds) {
  const value = Number(seconds);
  if (!Number.isInteger(value) || value < 4 || value > 12) throw new AgnesApiError('Agnes seconds must be an integer between 4 and 12', { statusCode: 400 });
  return value;
}

function validateHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
  } catch {
    throw new AgnesApiError('Agnes video URL must be an HTTPS URL', { statusCode: 502 });
  }
}

async function request(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    throw new AgnesApiError('Agnes request failed before receiving a response', { statusCode: 502, retryable: true, cause: error });
  }
  if (!response.ok) await throwHttpError(response, 'Agnes request');
  return response;
}

async function throwHttpError(response, operation) {
  const text = await response.text().catch(() => '');
  const detail = text.replace(/\s+/g, ' ').slice(0, 500);
  throw new AgnesApiError(`${operation} failed with status ${response.status}${detail ? `: ${detail}` : ''}`, {
    statusCode: response.status,
    retryable: response.status === 401 || response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500,
  });
}

async function readJson(response, operation) {
  try {
    return await response.json();
  } catch (error) {
    throw new AgnesApiError(`${operation} returned invalid JSON`, { statusCode: 502, retryable: true, cause: error });
  }
}

function safeProviderMessage(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 500);
  try { return JSON.stringify(value).slice(0, 500); } catch { return 'Agnes provider error'; }
}

function backoffDelay(attempt) {
  return Math.min(1000 * 2 ** Math.min(attempt, 5), MAX_BACKOFF_MS);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export const AgnesDefaults = Object.freeze({ DEFAULT_MODEL, DEFAULT_SIZE, DEFAULT_ASPECT_RATIO });
