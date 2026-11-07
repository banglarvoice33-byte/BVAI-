// Account-neutral safe fallback. Set NEXT_PUBLIC_SITE_URL before building production.
export const CANONICAL_SITE_URL = 'https://example.invalid';
export function canonicalSiteUrl(): string {
  const candidates = [process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { const url = new URL(candidate.trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.origin;
    } catch { /* ignore malformed configuration */ }
  }
  return CANONICAL_SITE_URL;
}
