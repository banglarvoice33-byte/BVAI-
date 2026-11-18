// Keyless, rights-aware symbolic B-roll discovery.
//  Keyless : Wikimedia Commons (CC0 / public domain / CC BY only), NASA Image Library (public domain).
//  Optional: Pixabay / Pexels when a key is present (their licences allow free commercial use).
// Publisher/agency news photos are NEVER used: attribution does not grant a reuse right.
import { boundedFetch } from './source-evidence.mjs';
import { createHash } from 'node:crypto';

const UA = process.env.BVAI_USER_AGENT || 'BanglarVoiceBot/2.0 (https://bvai-chi.vercel.app; symbolic news B-roll)';
const JSON_HEADERS = { 'User-Agent': UA, Accept: 'application/json' };

const CATEGORY_QUERIES = {
  national: ['Dhaka city street', 'Bangladesh river boat', 'Bangladesh village landscape', 'Dhaka skyline'],
  international: ['city skyline night', 'United Nations General Assembly hall', 'world map globe', 'airport terminal'],
  politics: ['parliament building', 'ballot box election', 'conference hall delegates', 'Jatiya Sangsad Bhaban'],
  economy: ['stock exchange trading floor', 'container port cranes', 'garment factory Bangladesh', 'market bazaar'],
  business: ['stock exchange trading floor', 'container port cranes', 'bank building', 'market bazaar'],
  sports: ['cricket stadium', 'football stadium crowd', 'cricket match', 'sports arena'],
  entertainment: ['cinema theatre interior', 'concert stage lights', 'film set camera'],
  technology: ['data center servers', 'circuit board', 'smartphone', 'laptop programming'],
  science: ['laboratory research', 'telescope observatory', 'space satellite', 'microscope'],
  health: ['hospital corridor', 'medical laboratory', 'stethoscope', 'pharmacy'],
  environment: ['river flood', 'forest canopy', 'monsoon rain', 'Sundarbans mangrove'],
  education: ['school classroom', 'university campus', 'library books'],
};
const CATEGORY_ALIASES = {
  জাতীয়: 'national', আন্তর্জাতিক: 'international', রাজনীতি: 'politics', অর্থনীতি: 'economy', বাণিজ্য: 'business',
  খেলা: 'sports', বিনোদন: 'entertainment', প্রযুক্তি: 'technology', বিজ্ঞান: 'science', স্বাস্থ্য: 'health',
  পরিবেশ: 'environment', শিক্ষা: 'education', sport: 'sports', world: 'international', asia: 'international',
};
const KEYWORD_QUERIES = [
  [/বন্যা|জলাবদ্ধতা/, 'flood water village'], [/ঘূর্ণিঝড়|নিম্নচাপ/, 'cyclone storm clouds'], [/বৃষ্টি|বর্ষা/, 'monsoon rain street'],
  [/ক্রিকেট|টেস্ট|ওয়ানডে|টি-টোয়েন্টি/, 'cricket stadium'], [/ফুটবল|বিশ্বকাপ/, 'football stadium'],
  [/নির্বাচন|ভোট/, 'ballot box election'], [/সংসদ/, 'parliament building'], [/আদালত|রায়/, 'court building gavel'],
  [/ডলার|টাকা|মুদ্রা|মূল্যস্ফীতি|দাম/, 'banknotes currency market'], [/শেয়ার|পুঁজিবাজার/, 'stock exchange trading floor'],
  [/বিদ্যুৎ|জ্বালানি|গ্যাস|তেল/, 'power plant electricity pylons'], [/সড়ক|দুর্ঘটনা|যানজট/, 'highway traffic road'],
  [/রেল|ট্রেন/, 'railway train station'], [/বিমান|ফ্লাইট/, 'airport aircraft runway'], [/নৌ|ফেরি|লঞ্চ/, 'river ferry boat'],
  [/হাসপাতাল|চিকিৎসা|ডেঙ্গু|টিকা|ভাইরাস/, 'hospital medical'], [/স্কুল|শিক্ষার্থী|পরীক্ষা/, 'school classroom'],
  [/পোশাক|গার্মেন্টস/, 'garment factory sewing'], [/কৃষি|ধান|কৃষক/, 'rice field farmer'], [/মহাকাশ|নাসা|রকেট|গ্রহ/, 'space rocket launch'],
  [/কৃত্রিম বুদ্ধিমত্তা|এআই|ডেটা/, 'data center servers'], [/জাতিসংঘ/, 'United Nations General Assembly hall'],
  [/যুদ্ধ|সংঘাত|হামলা|গাজা|ইউক্রেন/, 'diplomatic negotiation table'],
];
const SPACE_TOPIC = /space|science|technology|মহাকাশ|নাসা|বিজ্ঞান|প্রযুক্তি|রকেট|গ্রহ/i;

export function topicQueries(text) {
  return KEYWORD_QUERIES.filter(([pattern]) => pattern.test(String(text || ''))).map(([,query]) => query);
}

export function buildQueries(article) {
  const key = String(article.category_key || article.category || '').toLowerCase().trim();
  const category = CATEGORY_QUERIES[key] ? key : CATEGORY_ALIASES[article.category_key] || CATEGORY_ALIASES[article.category] || CATEGORY_ALIASES[key] || 'national';
  const text = `${article.title_bn || ''} ${article.excerpt_bn || ''} ${String(article.content_bn || '').slice(0, 1500)}`;
  const queries = [];
  for (const [pattern, query] of KEYWORD_QUERIES) if (pattern.test(text)) queries.push(query);
  for (const block of article.context_blocks || []) if (block?.wikipedia_title) queries.push(String(block.wikipedia_title));
  queries.push(...(CATEGORY_QUERIES[category] || CATEGORY_QUERIES.national));
  queries.push('Bangladesh');
  return { category, queries: [...new Set(queries)].slice(0, 12) };
}

/** Licence allow-list. ShareAlike/NonCommercial/NoDerivatives are refused: video is an adaptation. */
export function licenseOk(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return false;
  if (/\b(nc|nd|sa)\b|non-?commercial|no ?deriv|share ?alike|fair use|gfdl|all rights/.test(value)) return false;
  if (/public domain|cc0|pdm|\bpd\b|no known copyright|u\.?s\.? government|nasa/.test(value)) return true;
  return /^cc[- ]by[- ]?\d(\.\d)?(\s*\w*)?$/.test(value) || /^cc[- ]by$/.test(value);
}
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const BLOCKED_TITLE = /logo|seal|coat of arms|emblem|poster|portrait|selfie|headshot|nude|erotic|corpse|dead body|massacre|gore|screenshot|stamp|banknote scan|map of|diagram|chart|\.svg|flag of|wordmark|cover/i;

async function json(url) {
  const result = await boundedFetch(url, { maxBytes: 3_000_000, headers: JSON_HEADERS });
  return JSON.parse(result.bytes.toString('utf8'));
}

async function* commons(query, kinds = ['bitmap', 'video']) {
  for (const kind of kinds) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '24',
      gsrsearch: `${query} filetype:${kind}`, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata|mediatype',
      iiurlwidth: '1600', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|NonFree|Restrictions|ImageDescription',
    });
    let data;
    try { data = await json(url.href); } catch { continue; }
    const pages = (data.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata || {};
      if (!info || BLOCKED_TITLE.test(page.title || '')) continue;
      if (meta.NonFree?.value === 'true' || stripHtml(meta.Restrictions?.value)) continue;
      const license = stripHtml(meta.LicenseShortName?.value);
      if (!licenseOk(license)) continue;
      const isVideo = /^video\//.test(info.mime) || info.mediatype === 'VIDEO';
      if (!isVideo && !/^image\/(jpeg|png)$/.test(info.mime)) continue;
      if (!isVideo && ((info.width || 0) < 900 || (info.height || 0) < 600)) continue;
      if (isVideo && (info.size || 0) > 60_000_000) continue;
      yield {
        provider: 'wikimedia-commons', kind: isVideo ? 'video' : 'image',
        url: isVideo ? info.url : (info.thumburl || info.url), source_url: info.descriptionurl || info.url,
        title: stripHtml(page.title).replace(/^File:/, ''), author: stripHtml(meta.Artist?.value || meta.Credit?.value).slice(0, 80) || 'Wikimedia Commons contributor',
        license, license_url: meta.LicenseUrl?.value || 'https://commons.wikimedia.org/wiki/Commons:Licensing',
      };
    }
  }
}

async function* nasa(query) {
  const url = new URL('https://images-api.nasa.gov/search');
  url.search = new URLSearchParams({ q: query, media_type: 'image', page_size: '20' });
  let data;
  try { data = await json(url.href); } catch { return; }
  for (const item of data.collection?.items || []) {
    const meta = item.data?.[0];
    const href = item.links?.find((l) => l.render === 'image')?.href;
    if (!meta?.nasa_id || !href || BLOCKED_TITLE.test(meta.title || '')) continue;
    yield {
      provider: 'nasa', kind: 'image', url: href.replace('~thumb', '~medium'), source_url: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`,
      title: stripHtml(meta.title), author: stripHtml(meta.photographer || meta.secondary_creator || meta.center || 'NASA'),
      license: 'Public domain (NASA)', license_url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
    };
  }
}

async function* pixabay(query) {
  const key = process.env.PIXABAY_API_KEY; if (!key) return;
  const url = new URL('https://pixabay.com/api/videos/');
  url.search = new URLSearchParams({ key, q: query, per_page: '12', safesearch: 'true', video_type: 'film' });
  let data; try { data = await json(url.href); } catch { return; }
  for (const hit of data.hits || []) {
    const file = ['medium', 'large', 'small'].map((k) => hit.videos?.[k]).find((v) => v?.url);
    if (!file) continue;
    yield { provider: 'pixabay', kind: 'video', url: file.url, source_url: hit.pageURL, title: String(hit.tags || '').slice(0, 80), author: hit.user || 'Pixabay creator', license: 'Pixabay Content License', license_url: 'https://pixabay.com/service/license-summary/' };
  }
}

async function* pexels(query) {
  const key = process.env.PEXELS_API_KEY; if (!key) return;
  const url = new URL('https://api.pexels.com/videos/search');
  url.search = new URLSearchParams({ query, per_page: '10', orientation: 'portrait', size: 'medium' });
  let data; try { data = JSON.parse((await boundedFetch(url.href, { maxBytes: 3_000_000, headers: { ...JSON_HEADERS, Authorization: key } })).bytes.toString('utf8')); } catch { return; }
  for (const video of data.videos || []) {
    const file = (video.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.width <= 1920).sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
    if (!file?.link) continue;
    yield { provider: 'pexels', kind: 'video', url: file.link, source_url: video.url, title: `Pexels ${video.id}`, author: video.user?.name || 'Pexels creator', license: 'Pexels License', license_url: 'https://www.pexels.com/license/' };
  }
}

/** Candidate stream, best-first: real video clips, then open-licensed stills. Duplicates (by URL) are dropped. */
export async function* candidates(article) {
  const { category, queries } = buildQueries(article);
  const seen = new Set();
  const spaceTopic = SPACE_TOPIC.test(`${category} ${article.title_bn || ''}`);
  const providers = [pixabay, pexels, commons, ...(spaceTopic ? [nasa] : [])];
  for (const query of queries) {
    for (const provider of providers) {
      for await (const candidate of provider(query)) {
        if (seen.has(candidate.url)) continue;
        seen.add(candidate.url);
        yield { ...candidate, query };
      }
    }
  }
}

export async function download(candidate, destinationFile, fs) {
  const maxBytes = candidate.kind === 'video' ? 60_000_000 : 25_000_000;
  const { bytes } = await boundedFetch(candidate.url, { maxBytes, headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (bytes.length < 20_000) throw new Error('media_too_small');
  fs.writeFileSync(destinationFile, bytes, { mode: 0o600 });
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
