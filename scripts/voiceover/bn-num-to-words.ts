const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const ASCII_DIGITS = '0123456789';

function bnDigitsToAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    const idx = BN_DIGITS.indexOf(ch);
    out += idx >= 0 ? ASCII_DIGITS[idx] : ch;
  }
  return out;
}

const ONES = ['', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'ঊনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আঠাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই'
];

export function numToBanglaWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'শূন্য';
  const integerPart = Math.floor(n);
  if (integerPart < 100) return ONES[integerPart];
  if (integerPart < 1000) {
    const hundreds = Math.floor(integerPart / 100);
    const remainder = integerPart % 100;
    return ONES[hundreds] + 'শত' + (remainder ? ' ' + ONES[remainder] : '');
  }
  if (integerPart < 100000) {
    const thousands = Math.floor(integerPart / 1000);
    const remainder = integerPart % 1000;
    let result = numToBanglaWords(thousands) + ' হাজার';
    if (remainder) result += ' ' + numToBanglaWords(remainder);
    return result;
  }
  if (integerPart < 10000000) {
    const lakhs = Math.floor(integerPart / 100000);
    const remainder = integerPart % 100000;
    let result = numToBanglaWords(lakhs) + ' লাখ';
    if (remainder) result += ' ' + numToBanglaWords(remainder);
    return result;
  }
  const crores = Math.floor(integerPart / 10000000);
  const remainder = integerPart % 10000000;
  let result = numToBanglaWords(crores) + ' কোটি';
  if (remainder) result += ' ' + numToBanglaWords(remainder);
  return result;
}

/** দশমিক সংখ্যা → শব্দ (যেমন 12.5 → "বারো দশমিক পাঁচ") */
function decimalToBanglaWords(numStr: string): string {
  const parts = numStr.split('.');
  const whole = parseInt(parts[0], 10);
  const fracDigits = parts[1];

  let result = numToBanglaWords(whole);
  if (!fracDigits) return result;

  result += ' দশমিক';
  for (const d of fracDigits) {
    result += ' ' + numToBanglaWords(parseInt(d, 10));
  }
  return result;
}

export function normalizeForTts(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // ১. বাংলা ডিজিট → ASCII
  let text = bnDigitsToAscii(input.trim());

  // ২. কমা যুক্ত বড় সংখ্যা (1,23,45,678) — কমা মুছে ফেলুন, তবে সংখ্যা হিসেবে ধরুন
  text = text.replace(/\d{1,3}(?:,\d{2,3})+/g, (m) => m.replace(/,/g, ''));

  // ৩. শতাংশ (দশমিক সহ)
  text = text.replace(/(\d+(?:\.\d+)?)\s*%/g, (_m, num) => {
    return `${decimalToBanglaWords(num)} শতাংশ`;
  });

  // ৪. সময় (HH:MM)
  text = text.replace(/(\d{1,2}):(\d{2})/g, (_m, h, min) => {
    const hour = parseInt(h, 10);
    const minute = parseInt(min, 10);
    if (minute === 0) return `${numToBanglaWords(hour)}টা`;
    if (minute === 30) return `${numToBanglaWords(hour)}টা থার্টি`;
    return `${numToBanglaWords(hour)}টা ${numToBanglaWords(minute)} মিনিট`;
  });

  // ৫. "Xটা" প্যাটার্ন
  text = text.replace(/(\d+)\s*টা/g, (_m, h) => `${numToBanglaWords(parseInt(h, 10))}টা`);

  // ৬. দশমিক সংখ্যা (যেমন 3.75, 12.5)
  text = text.replace(/\d+\.\d+/g, (m) => decimalToBanglaWords(m));

  // ৭. বাকি সব পূর্ণসংখ্যা
  text = text.replace(/\d+/g, (match) => numToBanglaWords(parseInt(match, 10)));

  // ৮. পরিষ্কার (একাধিক স্পেস, অবাঞ্ছিত কমা)
  text = text.replace(/,(?!\s)/g, ', ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
