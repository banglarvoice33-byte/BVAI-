// Narration builder for 40–120 s Bengali news shorts.
// Rules (editorial fidelity):
//  * Only sentences that already exist in the published article are spoken. No invented impact/context lines.
//  * No "today"/date claims are added: the source's own time context is preserved.
//  * The source is credited aloud (when it has a Bengali name) and on screen.
//  * The mandatory closing line is always the last sentence.
import { createHash } from 'node:crypto';

export const CTA = 'বিস্তারিত দেখতে বাংলার ভয়েস ওয়েব সাইট ভিজিট করুন।';

const SOURCE_BN = [
  [/^prothom alo$/i, 'প্রথম আলো'], [/^bbc bangla$/i, 'বিবিসি বাংলা'], [/^bbc\b/i, 'বিবিসি'],
  [/^al jazeera/i, 'আল জাজিরা'], [/^dw bangla$/i, 'ডয়চে ভেলে বাংলা'], [/^dw\b/i, 'ডয়চে ভেলে'],
  [/^dhaka tribune$/i, 'ঢাকা ট্রিবিউন'], [/^the daily star$/i, 'দ্য ডেইলি স্টার'],
  [/^the business standard$/i, 'দ্য বিজনেস স্ট্যান্ডার্ড'], [/^jugantor$/i, 'যুগান্তর'],
  [/^kaler kantho$/i, 'কালের কণ্ঠ'], [/^espncricinfo$/i, 'ইএসপিএন ক্রিকইনফো'],
  [/^france ?24/i, 'ফ্রান্স টোয়েন্টি ফোর'], [/^npr\b/i, 'এনপিআর'], [/^nyt\b/i, 'নিউ ইয়র্ক টাইমস'],
  [/^sky news/i, 'স্কাই নিউজ'], [/^the guardian/i, 'দ্য গার্ডিয়ান'], [/^the hindu/i, 'দ্য হিন্দু'],
  [/^times of india$/i, 'টাইমস অব ইন্ডিয়া'], [/^un news$/i, 'জাতিসংঘ সংবাদ'],
  [/^who\b/i, 'বিশ্ব স্বাস্থ্য সংস্থা'], [/^nasa\b/i, 'নাসা'], [/^wikinews/i, 'উইকিনিউজ'],
  [/^abc news australia$/i, 'এবিসি নিউজ অস্ট্রেলিয়া'], [/^reuters$/i, 'রয়টার্স'], [/^ap\b|^associated press/i, 'অ্যাসোসিয়েটেড প্রেস'],
];
const BN = /[ঀ-৿]/;

export function sourceNameBn(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (BN.test(clean)) return clean;
  for (const [pattern, bn] of SOURCE_BN) if (pattern.test(clean)) return bn;
  return null; // unknown Latin-script name: shown on screen, not mispronounced by a Bengali voice
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBnDigits = (s) => String(s).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

export function plain(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\n)\s*(সূত্র|Source)\s*[:：].*$/gim, ' ')
    .replace(/[\*_`#>\[\]\(\)\{\}"“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s) => s.split(/\s+/).filter(Boolean);

/** Split into speakable sentences; very long sentences are cut at commas, never mid-clause without a pause. */
export function speakableSentences(text, { maxWords = 26 } = {}) {
  const out = [];
  for (const raw of plain(text).split(/(?<=[।!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence || words(sentence).length < 4) continue;
    if (words(sentence).length <= maxWords) { out.push(/[।!?]$/.test(sentence) ? sentence : sentence + '।'); continue; }
    let buffer = '';
    for (const part of sentence.split(/(?<=[,،;])\s+/)) {
      if (buffer && words(buffer + ' ' + part).length > maxWords) { out.push(buffer.replace(/[,،;]$/, '') + '।'); buffer = part; }
      else buffer = buffer ? buffer + ' ' + part : part;
    }
    if (buffer && words(buffer).length >= 4) out.push(buffer.replace(/[,،;]$/, '').replace(/[।!?]$/, '') + '।');
  }
  return out;
}

const norm = (s) => String(s).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function contentKey(article) {
  return createHash('sha256').update(norm(article.title_bn || article.id)).digest('hex');
}
export function scriptHash(script) {
  return createHash('sha256').update(String(script).normalize('NFC')).digest('hex');
}

/**
 * @returns {{script:string, sentences:string[], usedAll:boolean, chars:number}}
 * targetChars is the body budget; the headline, source credit and closing line are always included.
 */
export function buildNarration(article, { targetChars = 900 } = {}) {
  const headline = plain(article.title_bn).replace(/[।!?]+$/, '');
  if (!headline) throw new Error('article_missing_bengali_headline');
  const credit = sourceNameBn(article.source_name);
  const pool = speakableSentences(article.content_bn || article.excerpt_bn || '');
  const headlineKey = norm(headline);
  const body = pool.filter((s) => norm(s) !== headlineKey && !norm(s).startsWith(headlineKey));
  const lead = headline + '।';
  const tail = (credit ? `সূত্র: ${credit}। ` : '') + CTA;
  const chosen = [];
  let chars = lead.length + tail.length + 2;
  let usedAll = true;
  for (const sentence of body) {
    if (chosen.length >= 2 && chars + sentence.length + 1 > targetChars) { usedAll = false; break; }
    chosen.push(sentence); chars += sentence.length + 1;
  }
  const script = toBnDigits([lead, ...chosen, tail].join(' ')).replace(/\s+/g, ' ').trim();
  return { script, sentences: [lead, ...chosen], usedAll, chars: script.length, headline };
}
