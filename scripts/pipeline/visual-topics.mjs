// findTopics: [id, বাংলা নাম, English নাম, শ্রেণি, খেলার বিষয় কি না, keyword keys]
const TOPICS = [
  ['football', 'ফুটবল', 'football', 'sports', true, ['ফুটবল', 'চ্যাম্পিয়ন্স লিগ', 'চ্যাম্পিয়নস লিগ', 'football', 'soccer', 'champions league', 'আর্সেনাল', 'ডর্টমুন্ড', 'arsenal', 'dortmund', 'প্রিমিয়ার লীগ', 'premier league', 'লা লিগা', 'laliga', 'মেসি', 'রোনালদো']],
  ['cricket', 'ক্রিকেট', 'cricket', 'sports', true, ['ক্রিকেট', 'cricket', 'wicket', 'উইকেট', 'টি-টোয়েন্টি', 't20', 'ওডিআই', 'odi', 'টেস্ট ম্যাচ', 'বিসিবি', 'bcb', 'আইপিএল', 'ipl', 'ব্যাটসম্যান', 'বোলার']],
  ['flood', 'বন্যা', 'flood', 'weather', false, ['জলাবদ্ধতা', 'বন্যা', 'বৃষ্টি', 'flood', 'flooded', 'rain', 'monsoon', 'বৃষ্টি', 'জলোচ্ছ্বাস']],
  ['train', 'ট্রেন', 'train', 'transport', false, ['ট্রেন', 'train', 'railway', 'রেল', 'স্টেশন', 'station']],
  ['ship', 'জাহাজ', 'ship', 'transport', false, ['জাহাজ', 'ship', 'নৌকা', 'boat', 'বন্দর', 'port']],
  ['politics', 'রাজনীতি', 'politics', 'politics', false, ['সংসদ', 'সংসদে', 'নির্বাচন', 'মন্ত্রী', 'প্রধানমন্ত্রী', 'election', 'parliament', 'minister']],
  ['health', 'স্বাস্থ্য', 'health', 'health', false, ['হাসপাতাল', 'চিকিৎসা', 'ডাক্তার', 'টিকা', 'hospital', 'vaccine', 'covid', 'রোগ']],
  ['economy', 'অর্থনীতি', 'economy', 'economy', false, ['মূল্যস্ফীতি', 'শেয়ার', 'বাজার', 'inflation', 'stock', 'gdp', 'বাজেট', 'budget']],
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

export function findTopics(text = '') {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return [];
  return TOPICS.filter(([, , , , , keys]) => keys.some((k) => t.includes(String(k).toLowerCase())));
}

export function financialOrSensitive(text = '') {
  const t = String(text || '').toLowerCase();
  return ['হামলা', 'attack', 'নিহত', 'killed', 'ধর্ষণ', 'rape', 'দুর্নীতি', 'fraud', 'হত্যা', 'murder', 'বিস্ফোরণ', 'explosion', 'আত্মঘাতী', 'suicide', 'সন্ত্রাস', 'terror'].some((k) => t.includes(k));
}

export function sportDetail(text = '') {
  const t = String(text || '').toLowerCase();
  if (t.includes('চ্যাম্পিয়ন্স') || t.includes('চ্যাম্পিয়নস') || t.includes('champions league')) return 'চ্যাম্পিয়ন্স লিগ';
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

export const TOPIC_QUERIES = {
  football: ['football stadium', 'football match crowd', 'soccer field'],
  cricket: ['cricket stadium', 'cricket match', 'cricket pitch'],
  flood: ['monsoon rain street', 'flooded street', 'heavy rain city'],
  train: ['railway train station', 'passenger train'],
  ship: ['cargo ship ocean', 'harbor port'],
  politics: ['parliament building', 'government building'],
  health: ['hospital corridor', 'medical clinic'],
  economy: ['stock market board', 'city business district'],
};

export { TOPICS, CATEGORY_MAP };
