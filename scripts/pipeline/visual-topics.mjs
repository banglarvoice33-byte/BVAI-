// findTopics: [id, বাংলা নাম, English নাম, শ্রেণি, খেলার বিষয় কি না]
const TOPICS = [
  ['football', 'ফুটবল', 'football', 'sports', true, ['ফুটবল', 'চ্যাম্পিয়ন্স লিগ', 'চ্যাম্পিয়নস লিগ', 'football', 'champions league', '【entity-arsenal¦canonical_name=arsenal】', '【entity-dortmund¦canonical_name=dortmund】', 'আর্সেনাল', 'ডর্টমুন্ড']],
  ['cricket', 'ক্রিকেট', 'cricket', 'sports', true, ['ক্রিকেট', 'cricket', 'wicket', 'উইকেট']],
  ['flood', 'বন্যা', 'flood', 'weather', false, ['জলাবদ্ধতা', 'বন্যা', 'বৃষ্টি', 'flood', 'flooded', 'rain', 'monsoon', 'বৃষ্টি']],
  ['train', 'ট্রেন', 'train', 'transport', false, ['ট্রেন', 'train', 'railway', 'রেল']],
  ['ship', 'জাহাজ', 'ship', 'transport', false, ['জাহাজ', 'ship']],
];

export function findTopics(text = '') {
  const t = String(text || '').toLowerCase();
  return TOPICS.filter(([, , , , , keys]) => keys.some((k) => t.includes(k)));
}

export function financialOrSensitive(text = '') {
  const t = String(text || '').toLowerCase();
  return ['হামলা', 'attack', 'নিহত', 'killed', 'ধর্ষণ', 'rape', 'দুর্নীতি', 'fraud'].some((k) => t.includes(k));
}

export function sportDetail(text = '') {
  const t = String(text || '').toLowerCase();
  if (t.includes('চ্যাম্পিয়ন্স') || t.includes('চ্যাম্পিয়নস') || t.includes('champions league')) return 'চ্যাম্পিয়ন্স লিগ';
  if (t.includes('বিশ্বকাপ') || t.includes('world cup')) return 'বিশ্বকাপ';
  return '';
}
