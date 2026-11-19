// BVAI Deep — Headline Quality
// Reader Polish টেস্টের জন্য

export const AUTOMATION_DISCLOSURE = {
  bn: 'এই লেখাটি এআই-এর সাহায্যে তৈরি, সম্পাদকের যাচাই ও পরিমার্জন করা।',
  en: 'This article was drafted with AI assistance and reviewed by an editor.',
};

const MAX_LEN = 240;

export function cleanHeadline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.includes('\uFFFD')) return null;
  if (/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(value)) return null;
  if (value.includes('<') || value.includes('>')) return null;
  if (/https?:\/\/|www\./i.test(value)) return null;
  if (value.includes(':')) return null;

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length > MAX_LEN) return null;
  return normalized;
}

export function uniqueHeadlines(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const c = cleanHeadline(v);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export function scoreHeadline(headline: string): number {
  const c = cleanHeadline(headline);
  if (!c) return 0;
  if (c.length < 10) return 20;
  if (c.length > 90) return 50;
  return 85;
}

export function isGoodHeadline(headline: string): boolean {
  return scoreHeadline(headline) >= 70;
}

export default { cleanHeadline, uniqueHeadlines, AUTOMATION_DISCLOSURE, scoreHeadline, isGoodHeadline };
