/**
 * Visual topic lexicon for content-aware B-roll.
 *
 * Rules (production):
 * - "বৃষ্টি" / rain ≠ flood. Flood needs strong inundation language.
 * - Sport is the primary topic when present; weather is a modifier (wet pitch, umbrellas),
 *   not a second story about disaster footage.
 * - Ambiguous "বিশ্বকাপ" without a sport keyword must not invent cricket or football
 *   (handled in media-sources buildQueries).
 */

// [id, bnLabel, enLabel, class, isSport, keys[]]
const TOPICS = [
  [
    'football',
    'ফুটবল',
    'football',
    'sports',
    true,
    [
      'ফুটবল', 'চ্যাম্পিয়ন্স লিগ', 'চ্যাম্পিয়নস লিগ', 'football', 'soccer',
      'champions league', 'আর্সেনাল', 'ডর্টমুন্ড', 'arsenal', 'dortmund',
      'প্রিমিয়ার লীগ', 'premier league', 'লা লিগা', 'laliga', 'মেসি', 'রোনালদো',
    ],
  ],
  [
    'cricket',
    'ক্রিকেট',
    'cricket',
    'sports',
    true,
    [
      'ক্রিকেট', 'cricket', 'wicket', 'উইকেট', 'টি-টোয়েন্টি', 't20',
      'ওডিআই', 'odi', 'টেস্ট ম্যাচ', 'বিসিবি', 'bcb', 'আইপিএল', 'ipl',
      'ব্যাটসম্যান', 'বোলার',
    ],
  ],
  // Rain / wet weather — NOT flood. Used for wet stadium, umbrellas, drizzle B-roll.
  [
    'rain',
    'বৃষ্টি',
    'rain',
    'weather',
    false,
    ['বৃষ্টি', 'rain', 'raining', 'drizzle', 'monsoon', 'ঝড়ো বৃষ্টি', 'বর্ষা'],
  ],
  // Flood / waterlogging — requires inundation language, never plain "বৃষ্টি".
  [
    'flood',
    'বন্যা',
    'flood',
    'weather',
    false,
    [
      'বন্যা', 'জলাবদ্ধতা', 'প্লাবিত', 'flood', 'flooded', 'waterlogging',
      'জলোচ্ছ্বাস', 'তলিয়ে', 'ডুবে গেছে', 'পানি ঢুকে',
      'ঘরে পানি', 'রাস্তা ডুবে', 'inundat',
    ],
  ],
  [
    'train',
    'ট্রেন',
    'train',
    'transport',
    false,
    ['ট্রেন', 'train', 'railway', 'রেলপথ', 'রেলওয়ে'],
  ],
  [
    'ship',
    'জাহাজ',
    'ship',
    'transport',
    false,
    ['জাহাজ', 'ship', 'cargo ship', 'বন্দর', 'seaport'],
  ],
  [
    'politics',
    'রাজনীতি',
    'politics',
    'politics',
    false,
    ['সংসদ', 'নির্বাচন', 'মন্ত্রী', 'প্রধানমন্ত্রী', 'election', 'parliament', 'minister'],
  ],
  [
    'health',
    'স্বাস্থ্য',
    'health',
    'health',
    false,
    ['হাসপাতাল', 'চিকিৎসা', 'ডাক্তার', 'টিকা', 'hospital', 'vaccine', 'covid'],
  ],
  [
    'economy',
    'অর্থনীতি',
    'economy',
    'economy',
    false,
    ['মূল্যস্ফীতি', 'শেয়ারবাজার', 'inflation', 'stock market', 'gdp', 'বাজেট', 'budget'],
  ],
];

const CATEGORY_MAP = {
  sports: 'sports', খেলা: 'sports', খেলাধুলা: 'sports',
  politics: 'politics', রাজনীতি: 'politics',
  economy: 'economy', অর্থনীতি: 'economy',
  international: 'international', আন্তর্জাতিক: 'international', বিশ্ব: 'international',
  national: 'national', জাতীয়: 'national',
  health: 'health', স্বাস্থ্য: 'health',
  weather: 'weather', education: 'education', শিক্ষা: 'education',
  entertainment: 'entertainment', বিনোদন: 'entertainment',
};

/**
 * Raw keyword hits (no ranking). Prefer findPrimaryTopics for media search.
 */
export function findTopics(text = '') {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return [];
  return TOPICS.filter(([, , , , , keys]) =>
    keys.some((k) => keyMatches(t, k)),
  );
}

/**
 * Ranked topics for B-roll:
 * 1. Sport topics always kept when present.
 * 2. Flood only if strong flood keywords matched (never via rain alone).
 * 3. Rain is a secondary modifier (wet pitch / umbrellas), not a disaster story.
 * 4. When a sport is primary, rain may accompany; flood only with inundation words.
 */
export function findPrimaryTopics(text = '') {
  const raw = findTopics(text);
  if (!raw.length) return [];

  const sports = raw.filter((t) => t[4] === true);
  const flood = raw.filter((t) => t[0] === 'flood');
  const rain = raw.filter((t) => t[0] === 'rain');
  const other = raw.filter((t) => t[4] !== true && t[0] !== 'flood' && t[0] !== 'rain');

  if (sports.length) {
    return [...sports, ...rain, ...flood];
  }

  return [...flood, ...rain, ...other];
}

export function financialOrSensitive(text = '') {
  const t = String(text || '').toLowerCase();
  return [
    'হামলা', 'attack', 'নিহত', 'killed', 'ধর্ষণ', 'rape', 'দুর্নীতি', 'fraud',
    'হত্যা', 'murder', 'বিস্ফোরণ', 'explosion', 'আত্মঘাতী', 'suicide', 'সন্ত্রাস', 'terror',
  ].some((k) => t.includes(k));
}

export function sportDetail(text = '') {
  const t = String(text || '').toLowerCase();
  if (t.includes('চ্যাম্পিয়ন্স') || t.includes('চ্যাম্পিয়নস') || t.includes('champions league')) {
    return 'চ্যাম্পিয়ন্স লিগ';
  }
  if (t.includes('বিশ্বকাপ') || t.includes('world cup')) return 'বিশ্বকাপ';
  if (t.includes('আইপিএল') || t.includes('ipl')) return 'আইপিএল';
  if (t.includes('প্রিমিয়ার') || t.includes('premier league')) return 'প্রিমিয়ার লীগ';
  return '';
}

export function normalizeCategory(categoryKey = '') {
  const key = String(categoryKey || '').trim().toLowerCase();
  if (!key) return 'national';
  return CATEGORY_MAP[key] || CATEGORY_MAP[categoryKey] || 'national';
}

/** English B-roll phrases — rain ≠ flooded streets. */
export const TOPIC_QUERIES = {
  football: ['football stadium', 'football match crowd', 'soccer field'],
  cricket: ['cricket stadium', 'cricket match', 'cricket pitch'],
  rain: ['monsoon rain street', 'rain umbrella city', 'wet stadium seats'],
  flood: ['flooded street', 'flood water village', 'waterlogging city'],
  train: ['railway train station', 'passenger train'],
  ship: ['cargo ship ocean', 'harbor port'],
  politics: ['parliament building', 'government building'],
  health: ['hospital corridor', 'medical clinic'],
  economy: ['stock market board', 'city business district'],
};

export { TOPICS, CATEGORY_MAP };

// Longer words that merely CONTAIN a topic key but mean something else (Bengali compounds).
const NOT_THIS_WORD = {
  'পাখি': ['উটপাখি'],
  'ট্রেন': ['ট্রেনিং', 'ট্রেনার'],
  'টিকা': ['টিকাটুলি'],
};

const LATIN_KEY = /^[a-z0-9][a-z0-9 -]*$/;
const latinPatterns = new Map();

/**
 * English keys match whole words only ("rain" must not hit "train", "ship" must not hit "championship");
 * short keys also accept a plural. Long keys stay stems ("inundat" -> inundated). Bengali keys stay
 * substring matches because suffixes attach to the word (বৃষ্টিতে), minus the confusable words above.
 */
function keyMatches(text, key) {
  const k = String(key).toLowerCase();
  if (!k) return false;
  if (LATIN_KEY.test(k)) {
    let re = latinPatterns.get(k);
    if (!re) {
      const body = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp('(?<![a-z0-9])' + body + (k.length > 6 ? '' : '(?:s|es)?(?![a-z0-9])'));
      latinPatterns.set(k, re);
    }
    return re.test(text);
  }
  let t = text;
  for (const longer of NOT_THIS_WORD[k] ?? []) t = t.split(longer).join(' ');
  return t.includes(k);
}
