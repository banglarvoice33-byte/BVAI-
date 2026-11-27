// Bengali digits/time/currency to spoken words for TTS
export const WORDS_0_99 = [
  'শূন্য','এক','দুই','তিন','চার','পাঁচ','ছয়','সাত','আট','নয়',
  'দশ','এগারো','বারো','তেরো','চৌদ্দ','পনেরো','ষোলো','সতেরো','আঠারো','উনিশ',
  'বিশ','একুশ','বাইশ','তেইশ','চব্বিশ','পঁচিশ','ছাব্বিশ','সাতাশ','আটাশ','উনত্রিশ',
  'ত্রিশ','একত্রিশ','বত্রিশ','তেত্রিশ','চৌত্রিশ','পঁয়ত্রিশ','ছত্রিশ','সাঁইত্রিশ','আটত্রিশ','উনচল্লিশ',
  'চল্লিশ','একচল্লিশ','বিয়াল্লিশ','তেতাল্লিশ','চয়াল্লিশ','পঁয়তাল্লিশ','ছেচল্লিশ','সাতচল্লিশ','আটচল্লিশ','উনপঞ্চাশ',
  'পঞ্চাশ','একান্ন','বায়ান্ন','তিপ্পান্ন','চুয়ান্ন','পঞ্চান্ন','ছাপ্পান্ন','সাতান্ন','আটান্ন','উনষাট',
  'ষাট','একষট্টি','বাষট্টি','তেষট্টি','চৌষট্টি','পঁয়ষট্টি','ছেষট্টি','সাতষট্টি','আটষট্টি','উনসত্তর',
  'সত্তর','একাত্তর','বাহাত্তর','তিয়াত্তর','চুয়াত্তর','পঁচাত্তর','ছিয়াত্তর','সাতাত্তর','আটাত্তর','উনআশি',
  'আশি','একাশি','বিরাশি','তিরাশি','চুরাশি','পচাশি','ছিয়াশি','সাতাশি','আটাশি','উননব্বই',
  'নব্বই','একানব্বই','বিরানব্বই','তিরানব্বই','চুরানব্বই','পঁচানব্বই','ছিয়ানব্বই','সাতানব্বই','আটানব্বই','নিরানব্বই',
];

export function intToWords(n) {
  if (n < 100) return WORDS_0_99[n];
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return (h === 1 ? 'একশো' : WORDS_0_99[h] + 'শো') + (r ? ' ' + intToWords(r) : '');
  }
  if (n < 100000) {
    const t = Math.floor(n / 1000), r = n % 1000;
    return (t === 1 ? 'এক হাজার' : intToWords(t) + ' হাজার') + (r ? ' ' + intToWords(r) : '');
  }
  if (n < 10000000) {
    const l = Math.floor(n / 100000), r = n % 100000;
    return (l === 1 ? 'এক লাখ' : intToWords(l) + ' লাখ') + (r ? ' ' + intToWords(r) : '');
  }
  const c = Math.floor(n / 10000000), r = n % 10000000;
  return (c === 1 ? 'এক কোটি' : intToWords(c) + ' কোটি') + (r ? ' ' + intToWords(r) : '');
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

function bnToNum(s) {
  let n = 0;
  for (const c of s) n = n * 10 + BN_DIGITS.indexOf(c);
  return n;
}

function numToWords(token) {
  if (/[০-৯]/.test(token)) return intToWords(bnToNum(token.replace(/,/g, '')));
  return intToWords(parseInt(token.replace(/,/g, ''), 10));
}

function timeWord(H, M) {
  const h12 = H % 12 || 12;
  if (M === 30) {
    if (h12 === 1) return 'দেড়টা';
    if (h12 === 2) return 'আড়াইটা';
    return 'সাড়ে ' + WORDS_0_99[h12] + 'টা';
  }
  if (M === 15) return 'সোয়া ' + WORDS_0_99[h12] + 'টা';
  if (M === 45) return 'পৌনে ' + WORDS_0_99[(h12) % 12 + 1] + 'টা'; // Fixed: Uses h12 for next hour
  return WORDS_0_99[h12] + 'টা ' + WORDS_0_99[M];
}

function periodForHour(H) {
  if (H === 0 || H >= 20) return 'রাত';
  if (H >= 18) return 'সন্ধ্যা';
  if (H >= 16) return 'বিকেল';
  if (H >= 13) return 'দুপুর';
  return '';
}

export function normalizeBanglaForSpeech(text) {
  const changes = [];
  let out = text;

  out = out.replace(/(ভোর|সকাল|দুপুর|বিকেল|সন্ধ্যা|রাত)\s*([০-৯]{1,2}):([০-৯]{2})/g, (m, period, h, min) => {
    const H = bnToNum(h), M = bnToNum(min);
    if (H > 23 || M > 59) return m;
    const w = timeWord(H, M);
    changes.push({ kind: 'time', from: m, to: period + ' ' + w });
    return period + ' ' + w;
  });

  out = out.replace(/(^|[\s(])([০-৯]{1,2}):([০-৯]{2})(?=[\s).,;!?]|$)/g, (m, pre, h, min) => {
    const H = bnToNum(h), M = bnToNum(min);
    if (H > 23 || M > 59) return m;
    const period = periodForHour(H);
    const w = timeWord(H, M);
    const to = period ? period + ' ' + w : w;
    changes.push({ kind: 'time', from: h + ':' + min, to });
    return pre + to;
  });

  out = out.replace(/৳\s*([০-৯]+)/g, (m, d) => {
    const w = intToWords(bnToNum(d)) + ' টাকা';
    changes.push({ kind: 'currency', from: m, to: w });
    return w;
  });

  out = out.replace(/£\s*([০-৯]+)/g, (m, d) => {
    const w = intToWords(bnToNum(d)) + ' পাউন্ড';
    changes.push({ kind: 'currency', from: m, to: w });
    return w;
  });

  out = out.replace(/\$\s*([০-৯]+)(?:\s*(মিলিয়ন|বিলিয়ন|ট্রিলিয়ন))?/g, (m, d, unit) => {
    const unitBn = unit ? ' ' + unit.replace('য়', 'য') : '';
    const w = intToWords(bnToNum(d)) + unitBn + ' ডলার';
    changes.push({ kind: 'currency', from: m, to: w });
    return w;
  });

  out = out.replace(/([০-৯]+)\.([০-৯]+)\s*%/g, (m, a, b) => {
    const w = intToWords(bnToNum(a)) + ' দশমিক ' + b.split('').map((c) => WORDS_0_99[bnToNum(c)]).join(' ') + ' শতাংশ';
    changes.push({ kind: 'percent', from: m, to: w });
    return w;
  });

  out = out.replace(/([০-৯]+)\s*%/g, (m, d) => {
    const w = intToWords(bnToNum(d)) + ' শতাংশ';
    changes.push({ kind: 'percent', from: m, to: w });
    return w;
  });

  out = out.replace(/([০-৯])\.৫\s*(লাখ|কোটি)/g, (m, d, unit) => {
    const n = bnToNum(d);
    let w;
    if (unit === 'কোটি' && n === 1) w = 'দেড় কোটি';
    else if (unit === 'লাখ' && n === 2) w = 'আড়াই লাখ';
    else w = 'সাড়ে ' + WORDS_0_99[n] + ' ' + unit;
    changes.push({ kind: 'half', from: m, to: w });
    return w;
  });

  out = out.replace(/([০-৯]+)\.([০-৯]+)/g, (m, a, b) => {
    const w = intToWords(bnToNum(a)) + ' দশমিক ' + b.split('').map((c) => WORDS_0_99[bnToNum(c)]).join(' ');
    changes.push({ kind: 'decimal', from: m, to: w });
    return w;
  });

  out = out.replace(/[০-৯]{10,}/g, (m) => {
    const w = m.split('').map((c) => WORDS_0_99[bnToNum(c)]).join(' ');
    changes.push({ kind: 'phone', from: m, to: w });
    return w;
  });

  out = out.replace(/[০-৯\d]{1,3}(?:,[০-৯\d]{2,3})+/g, (m) => {
    let w = numToWords(m);
    changes.push({ kind: 'number', from: m, to: w });
    return w;
  });

  out = out.replace(/([০-৯]+)\s*(কোটি|লাখ|হাজার)/g, (m, d, unit) => {
    const w = intToWords(bnToNum(d)) + ' ' + unit;
    changes.push({ kind: 'number', from: m, to: w });
    return w;
  });

  out = out.replace(/[০-৯]+/g, (m) => {
    const w = intToWords(bnToNum(m));
    changes.push({ kind: 'number', from: m, to: w });
    return w;
  });

  return { text: out, changes };
}
