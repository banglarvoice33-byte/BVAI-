/**
 * Deterministic Bengali "spoken form" normalizer for TTS.
 *
 * Problem: TTS engines may read the digits of "৭৩" one by one ("সাত তিন").
 * An LLM prompt alone cannot guarantee correct spelling every time, so this
 * module converts digits to Bengali words in code, as a safety net AFTER the
 * script-rewriter agent.
 *
 * Covers: integers (Indian grouping: হাজার/লাখ/কোটি), decimals, percent,
 * currency (৳ $ £ €), clock times (24h and 12h, সোয়া/সাড়ে/পৌনে/দেড়/আড়াই),
 * hour-only forms (৯টা), thousands separators, and phone/ID-like digit runs.
 *
 * NOT covered (leave to the editor): dates with ordinal suffixes (১লা, ২রা),
 * numeric ranges ("১০-১২"), units, abbreviations, foreign names.
 */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Words for 0..99. Printed for human review by pipeline/print-bn-numbers.mjs. */
export const WORDS_0_99 = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'ঊনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

const HUNDREDS = ['', 'একশো', 'দুইশো', 'তিনশো', 'চারশো', 'পাঁচশো', 'ছয়শো', 'সাতশো', 'আটশো', 'নয়শো'];

const MAX_SAFE_WORDS = 1e15;

/** Converts Bengali digits to ASCII digits. @param {string} s */
export function toAsciiDigits(s) {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Integer to Bengali words (0 <= n < 1e15). @param {number} n */
export function intToWords(n) {
  if (!Number.isInteger(n) || n < 0 || n >= MAX_SAFE_WORDS) {
    throw new RangeError(`intToWords: unsupported value ${n}`);
  }
  if (n < 100) return WORDS_0_99[n];
  let rest = n;
  const crore = Math.floor(rest / 1e7); rest %= 1e7;
  const lakh = Math.floor(rest / 1e5); rest %= 1e5;
  const thousand = Math.floor(rest / 1e3); rest %= 1e3;
  const hundred = Math.floor(rest / 100); rest %= 100;
  const parts = [];
  if (crore) parts.push(`${intToWords(crore)} কোটি`);
  if (lakh) parts.push(`${WORDS_0_99[lakh]} লাখ`);
  if (thousand) parts.push(`${WORDS_0_99[thousand]} হাজার`);
  if (hundred) parts.push(HUNDREDS[hundred]);
  if (rest) parts.push(WORDS_0_99[rest]);
  return parts.join(' ');
}

/** Reads every digit separately ("০১৭" -> "শূন্য এক সাত"). @param {string} asciiDigits */
export function digitsToWords(asciiDigits) {
  return [...asciiDigits].map((d) => WORDS_0_99[Number(d)]).join(' ');
}

/**
 * Spoken form of a numeric string such as "১২,৫০০", "3.5", "০১৭১২৩৪৫৬৭৮".
 * @param {string} raw
 * @param {{ idiom?: boolean }} [opts] idiom: use দেড়/আড়াই/সাড়ে for x.5 before a magnitude word
 */
export function spokenNumber(raw, opts = {}) {
  const ascii = toAsciiDigits(raw).replace(/,/g, '');
  const [intPart, fracPart] = ascii.split('.');
  if (fracPart !== undefined) {
    const whole = Number(intPart);
    if (opts.idiom && fracPart === '5' && whole >= 1 && whole < MAX_SAFE_WORDS) {
      if (whole === 1) return 'দেড়';
      if (whole === 2) return 'আড়াই';
      return `সাড়ে ${intToWords(whole)}`;
    }
    return `${spokenNumber(intPart)} দশমিক ${digitsToWords(fracPart)}`;
  }
  // phone numbers / IDs: leading zero or very long runs are read digit by digit
  if ((intPart.length > 1 && intPart.startsWith('0')) || intPart.length >= 10) {
    return digitsToWords(intPart);
  }
  return intToWords(Number(intPart));
}

/** Day-part inferred from a 24-hour clock hour. @param {number} h24 */
export function dayPartFor(h24) {
  if (h24 < 4) return 'রাত';
  if (h24 < 6) return 'ভোর';
  if (h24 < 12) return 'সকাল';
  if (h24 < 15) return 'দুপুর';
  if (h24 < 17) return 'বিকেল';
  if (h24 < 19) return 'সন্ধ্যা';
  return 'রাত';
}

/**
 * Spoken clock time without day-part, e.g. (16,30) -> "সাড়ে চারটা".
 * @param {number} h24 0..23
 * @param {number} m 0..59
 */
export function clockWords(h24, m) {
  const h12 = h24 % 12 || 12;
  const next = (h12 % 12) + 1;
  if (m === 0) return `${WORDS_0_99[h12]}টা`;
  if (m === 15) return `সোয়া ${WORDS_0_99[h12]}টা`;
  if (m === 30) {
    if (h12 === 1) return 'দেড়টা';
    if (h12 === 2) return 'আড়াইটা';
    return `সাড়ে ${WORDS_0_99[h12]}টা`;
  }
  if (m === 45) return `পৌনে ${WORDS_0_99[next]}টা`;
  return `${WORDS_0_99[h12]}টা ${WORDS_0_99[m]}`;
}

const D = '[0-9০-৯]';
const PART = '(?:ভোর|সকাল|দুপুর|বেলা|বিকেল|বিকাল|সন্ধ্যা|রাত)';
const NUM = `${D}+(?:,${D}{2,3})*(?:\\.${D}+)?`;
const MAGNITUDE = '(?:হাজার|লাখ|কোটি|মিলিয়ন|বিলিয়ন|ট্রিলিয়ন)';
const CURRENCY_UNIT = { '৳': 'টাকা', $: 'ডলার', '£': 'পাউন্ড', '€': 'ইউরো' };

/**
 * Normalizes a Bengali script for speech.
 * @param {string} input
 * @returns {{ text: string, changes: Array<{ kind: string, from: string, to: string }> }}
 */
export function normalizeBanglaForSpeech(input) {
  const changes = [];
  const record = (kind, from, to) => { changes.push({ kind, from, to }); return to; };
  let text = String(input);

  // 1) clock times with a colon: "বিকেল ৪:৩০", "১৬:৪৫"
  text = text.replace(
    new RegExp(`(?<!${D})(?:(${PART})\\s*)?(${D}{1,2}):(${D}{2})(?!${D})`, 'g'),
    (match, part, hh, mm) => {
      const h = Number(toAsciiDigits(hh));
      const m = Number(toAsciiDigits(mm));
      if (h > 23 || m > 59) return match;
      const label = part ?? (h >= 13 || h === 0 ? dayPartFor(h) : '');
      const spoken = clockWords(h, m);
      return record('time', match, label ? `${label} ${spoken}` : spoken);
    },
  );

  // 2) hour-only forms: "সকাল ৯টা", "৯টায়"
  text = text.replace(
    new RegExp(`(?<!${D})(?:(${PART})\\s*)?(${D}{1,2})\\s*(টায়|টার|টা)`, 'g'),
    (match, part, hh, suffix) => {
      const h = Number(toAsciiDigits(hh));
      if (h < 1 || h > 23) return match;
      const h12 = h % 12 || 12;
      const label = part ?? (h >= 13 ? dayPartFor(h) : '');
      const spoken = `${WORDS_0_99[h12]}${suffix}`;
      return record('hour', match, label ? `${label} ${spoken}` : spoken);
    },
  );

  // 3) currency: "৳৫০০", "$৫০ মিলিয়ন", "£১০০"
  text = text.replace(
    new RegExp(`([৳$£€])\\s*(${NUM})(\\s*${MAGNITUDE})?`, 'g'),
    (match, symbol, num, mag) => {
      const magnitude = mag ? mag.trim() : '';
      const words = spokenNumber(num, { idiom: Boolean(magnitude) });
      const spoken = [words, magnitude, CURRENCY_UNIT[symbol]].filter(Boolean).join(' ');
      return record('currency', match, spoken);
    },
  );

  // 4) percent: "১২.৫%", "৫০ শতাংশ"
  text = text.replace(new RegExp(`(${NUM})\\s*(?:%|শতাংশ)`, 'g'), (match, num) =>
    record('percent', match, `${spokenNumber(num)} শতাংশ`),
  );

  // 5) every remaining number; leave digits glued to Latin letters (COVID-19, B2B, F-16)
  text = text.replace(new RegExp(NUM, 'g'), (match, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 2), offset);
    if (/[A-Za-z]$/.test(before) || /[A-Za-z]-$/.test(before)) return match;
    const after = whole.slice(offset + match.length);
    const idiom = /^\s*(?:হাজার|লাখ|কোটি|গুণ)/.test(after);
    return record('number', match, spokenNumber(match, { idiom }));
  });

  return { text, changes };
}
