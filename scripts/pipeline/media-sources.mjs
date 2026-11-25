/**
 * Content-aware open-media search for video B-roll / stills.
 *
 * Contract (consumed by generate-video.js + tests):
 *   - licenseOk(name) → boolean (CC0 / PD / plain CC BY only)
 *   - buildQueries({ title_bn, content_bn, category_key }) → { category, queries, topics, sensitive }
 *   - async *candidates(article) → stream of licensed media descriptors
 *   - download(candidate, file, fsModule?) → { bytes, sha256 }
 *
 * Providers: Wikimedia Commons · Pexels (PEXELS_API_KEY) · Pixabay (PIXABAY_API_KEY)
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  findPrimaryTopics,
  financialOrSensitive,
  normalizeCategory,
  TOPIC_QUERIES,
} from './visual-topics.mjs';

const UA = 'BanglarVoiceVideoBot/1.0 (https://bvai-chi.vercel.app; media@banglarvoice.local)';

/** Conservative automated subset: no NC, ND, SA, GFDL, fair-use. */
export function licenseOk(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (/^CC0(?:\s*1\.0)?$/i.test(n)) return true;
  if (/^PDM(?:\s*1\.0)?$/i.test(n)) return true;
  if (/public domain/i.test(n)) return true;
  const plainBy = n.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^CC BY(?: \d\.\d)?$/i.test(plainBy)) return true;
  return false;
}

export function buildQueries({ title_bn = '', content_bn = '', category_key = '' } = {}) {
  const title = String(title_bn || '');
  const content = String(content_bn || '');
  const haystack = `${title}\n${content}`;
  const category = normalizeCategory(category_key);
  const sensitive = financialOrSensitive(haystack);

  const ambiguous =
    /বিশ্বকাপ|world cup/i.test(haystack) &&
    !/ক্রিকেট|ফুটবল|cricket|football|soccer|champions league|চ্যাম্পিয়ন্স|চ্যাম্পিয়নস/i.test(haystack);
  if (ambiguous) {
    return { category, topics: [], queries: [], sensitive };
  }

  // Ranked topics: sport primary; rain is modifier; flood only on strong inundation words.
  const topics = findPrimaryTopics(haystack);
  const queries = [];
  const seen = new Set();

  const push = (q) => {
    const cleaned = String(q || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(cleaned);
  };

  for (const [id] of topics) {
    for (const phrase of TOPIC_QUERIES[id] || []) push(phrase);
  }

  if (!queries.length) {
    if (category === 'sports') push('sports stadium');
    else if (category === 'weather') push('monsoon rain street');
    else if (category === 'politics') push('parliament building');
    else if (category === 'economy') push('city business district');
    else if (category === 'health') push('hospital corridor');
  }

  while (queries.length > 11) queries.pop();
  if (queries.length) push('Bangladesh');

  return { category, topics, queries, sensitive };
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function candidate({
  provider,
  kind,
  url,
  source_url,
  title,
  author,
  license,
  license_url,
  query,
}) {
  if (!url || !source_url || !licenseOk(license)) return null;
  return {
    provider,
    kind: kind === 'video' ? 'video' : 'image',
    url,
    source_url,
    title: String(title || query || 'open media').slice(0, 160),
    author: String(author || provider).slice(0, 120),
    license: String(license),
    license_url: String(license_url || ''),
    query: String(query || ''),
  };
}

async function* fromWikimedia(query, { video = true, image = true } = {}) {
  const searches = [];
  if (video) searches.push(`${query} filetype:video`);
  if (image) searches.push(`${query} filetype:bitmap`);

  for (const gsrsearch of searches) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch,
      gsrlimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata|mime',
      origin: '*',
    });
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
    for (const page of data?.query?.pages || []) {
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      const meta = info.extmetadata || {};
      const license = String(meta.LicenseShortName?.value || '').replace(/<[^>]+>/g, '').trim();
      const license_url = String(meta.LicenseUrl?.value || '').trim();
      const author = String(meta.Artist?.value || page.title || 'Wikimedia')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      const mime = String(info.mime || '');
      const isVideo = mime.startsWith('video/') || /\.(webm|ogv|mp4)$/i.test(info.url);
      const hit = candidate({
        provider: 'wikimedia-commons',
        kind: isVideo ? 'video' : 'image',
        url: info.url,
        source_url: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`,
        title: page.title || query,
        author,
        license,
        license_url,
        query,
      });
      if (hit) yield hit;
    }
  }
}

async function* fromPexels(query) {
  const key = process.env.PEXELS_API_KEY || '';
  if (!key) return;

  const vdata = await getJson(
    `https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`,
    { Authorization: key },
  );
  for (const v of vdata?.videos || []) {
    const files = [...(v.video_files || [])].sort((a, b) => (b.width || 0) - (a.width || 0));
    const file = files.find((f) => (f.width || 0) >= 640 && (f.file_type || '').includes('mp4')) || files[0];
    if (!file?.link) continue;
    const hit = candidate({
      provider: 'pexels',
      kind: 'video',
      url: file.link,
      source_url: v.url || `https://www.pexels.com/video/${v.id}/`,
      title: v.user?.name ? `${query} — ${v.user.name}` : query,
      author: v.user?.name || 'Pexels',
      license: 'CC0',
      license_url: 'https://www.pexels.com/license/',
      query,
    });
    if (hit) yield hit;
  }

  const pdata = await getJson(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=4&orientation=landscape`,
    { Authorization: key },
  );
  for (const p of pdata?.photos || []) {
    const url = p.src?.large2x || p.src?.large || p.src?.original;
    if (!url) continue;
    const hit = candidate({
      provider: 'pexels',
      kind: 'image',
      url,
      source_url: p.url || `https://www.pexels.com/photo/${p.id}/`,
      title: p.alt || query,
      author: p.photographer || 'Pexels',
      license: 'CC0',
      license_url: 'https://www.pexels.com/license/',
      query,
    });
    if (hit) yield hit;
  }
}

async function* fromPixabay(query) {
  const key = process.env.PIXABAY_API_KEY || '';
  if (!key) return;

  const vdata = await getJson(
    `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=6`,
  );
  for (const v of vdata?.hits || []) {
    const vids = v.videos || {};
    const pick = vids.medium || vids.small || vids.large || vids.tiny;
    if (!pick?.url) continue;
    const hit = candidate({
      provider: 'pixabay',
      kind: 'video',
      url: pick.url,
      source_url: v.pageURL || `https://pixabay.com/videos/id-${v.id}/`,
      title: v.tags || query,
      author: v.user || 'Pixabay',
      license: 'CC0',
      license_url: 'https://pixabay.com/service/license/',
      query,
    });
    if (hit) yield hit;
  }

  const idata = await getJson(
    `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&image_type=photo&per_page=4`,
  );
  for (const p of idata?.hits || []) {
    const url = p.largeImageURL || p.webformatURL;
    if (!url) continue;
    const hit = candidate({
      provider: 'pixabay',
      kind: 'image',
      url,
      source_url: p.pageURL || `https://pixabay.com/photos/id-${p.id}/`,
      title: p.tags || query,
      author: p.user || 'Pixabay',
      license: 'CC0',
      license_url: 'https://pixabay.com/service/license/',
      query,
    });
    if (hit) yield hit;
  }
}

export async function* candidates(article = {}) {
  const brief = buildQueries({
    title_bn: article.title_bn || article.title || '',
    content_bn: article.content_bn || article.body_bn || '',
    category_key: article.category_key || article.category || '',
  });

  if (brief.sensitive) return;
  if (!brief.queries.length) return;

  const seenUrl = new Set();
  for (const query of brief.queries) {
    for await (const hit of fromWikimedia(query)) {
      if (seenUrl.has(hit.url)) continue;
      seenUrl.add(hit.url);
      yield hit;
    }
    for await (const hit of fromPexels(query)) {
      if (seenUrl.has(hit.url)) continue;
      seenUrl.add(hit.url);
      yield hit;
    }
    for await (const hit of fromPixabay(query)) {
      if (seenUrl.has(hit.url)) continue;
      seenUrl.add(hit.url);
      yield hit;
    }
  }
}

export async function download(candidate, file, fsModule = fs) {
  const maxBytes = Number(process.env.VIDEO_MEDIA_MAX_BYTES || 18 * 1024 * 1024);
  const res = await fetch(candidate.url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(45_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`download_http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('download_too_small');
  if (buf.length > maxBytes) throw new Error('download_too_large');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  fsModule.writeFileSync(file, buf, { mode: 0o600 });
  return { bytes: buf.length, sha256 };
}
