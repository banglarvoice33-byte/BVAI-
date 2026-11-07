import { createHash } from 'node:crypto';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const MAX_LOCAL_KEYS = 2_000;
const localWindows = new Map<string, { count: number; resetAt: number }>();

function requestKey(request: Request): string {
  const forwarded = request.headers.get('x-vercel-forwarded-for') || 'unknown';
  const address = forwarded.split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(address).digest('hex').slice(0, 32);
}

function localLimit(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (localWindows.size >= MAX_LOCAL_KEYS) {
    for (const [existingKey, value] of localWindows) {
      if (value.resetAt <= now) localWindows.delete(existingKey);
    }
    while (localWindows.size >= MAX_LOCAL_KEYS) {
      const oldest = localWindows.keys().next().value as string | undefined;
      if (!oldest) break;
      localWindows.delete(oldest);
    }
  }

  const entry = localWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    localWindows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

async function createUpstashLimiter() {
  const [{ Ratelimit }, { Redis }] = await Promise.all([
    import('@upstash/ratelimit'),
    import('@upstash/redis'),
  ]);
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(MAX_REQUESTS, '10 m'),
    analytics: false,
    prefix: 'banglarvoice_newsletter_subscribe',
  });
}

type UpstashLimiter = Awaited<ReturnType<typeof createUpstashLimiter>>;
let upstashLimiter: UpstashLimiter | null = null;

/** Uses shared Upstash limiting when configured, with a bounded local fallback. */
export async function limitNewsletterRequest(request: Request): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const key = requestKey(request);
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      upstashLimiter ??= await createUpstashLimiter();
      const result = await upstashLimiter.limit(key);
      return {
        allowed: result.success,
        retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      };
    } catch {
      // Do not let a Redis outage disable subscriptions; retain per-instance protection.
    }
  }
  return localLimit(key);
}
