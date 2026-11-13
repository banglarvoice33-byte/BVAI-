export const MAX_PUBLISH_PER_RUN = 3
export const MIN_PUBLISH_PER_RUN = 1
export const MAX_CANDIDATES_PER_RUN = 6
export const MAX_SOURCES_PER_RUN = 10
export const PRIORITY_CANDIDATE_TARGET_PERCENT = 70

export const WORLD_CLASS_FEED_HOSTS = [
  'feeds.bbci.co.uk',
  'bbc.co.uk',
  'bbc.com',
  'reuters.com',
  'apnews.com',
  'nytimes.com',
  'theguardian.com',
  'aljazeera.com',
  'npr.org',
  'dw.com',
  'france24.com',
  'thehindu.com',
  'japantimes.co.jp',
  'afp.com',
]

const WORLD_CLASS_NAME_HINTS = [
  'bbc',
  'reuters',
  'associated press',
  'ap news',
  'new york times',
  'nytimes',
  'guardian',
  'al jazeera',
  'npr',
  'deutsche welle',
  'dw ',
  'france 24',
  'the hindu',
  'japan times',
  'afp',
]

export function isWorldClassFeed(feedUrl: string, sourceName = ''): boolean {
  const host = feedUrl.toLowerCase()
  if (WORLD_CLASS_FEED_HOSTS.some((item) => host.includes(item))) return true
  const name = sourceName.toLowerCase()
  return WORLD_CLASS_NAME_HINTS.some((hint) => name.includes(hint.trim()))
}

export function rankSourcesForRun<T extends { feed_url: string; name?: string; last_probe_at?: string | null }>(
  sources: T[],
  limit = MAX_SOURCES_PER_RUN,
): T[] {
  const worldClass = sources.filter((source) => isWorldClassFeed(source.feed_url, source.name || ''))
  const others = sources.filter((source) => !isWorldClassFeed(source.feed_url, source.name || ''))
  const byOldestProbe = (left: T, right: T) =>
    Date.parse(left.last_probe_at || '1970-01-01') - Date.parse(right.last_probe_at || '1970-01-01')
  // Balanced rotation: half of every run goes to world-class feeds and half to the
  // remaining (mostly Bangladeshi) feeds, each side oldest-probe first. A strict
  // "world-class first" order starves local feeds once there are >= limit
  // world-class sources. Unused slots on one side are filled from the other.
  const size = Math.max(1, limit)
  const worldSorted = [...worldClass].sort(byOldestProbe)
  const otherSorted = [...others].sort(byOldestProbe)
  const worldQuota = Math.min(worldSorted.length, Math.ceil(size / 2))
  const otherQuota = Math.min(otherSorted.length, size - worldQuota)
  const worldTake = Math.min(worldSorted.length, size - otherQuota)
  return [...worldSorted.slice(0, worldTake), ...otherSorted.slice(0, otherQuota)]
}
