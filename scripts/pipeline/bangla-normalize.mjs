// Speech-only normalization: preserve display spelling and never rewrite conjuncts blindly.
const DIGITS = '০১২৩৪৫৬৭৮৯';
const WORDS = 'শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আটাশ উনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ উনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ উনপঞ্চাশ পঞ্চাশ একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন উনষাট ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি উনসত্তর সত্তর একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর উনআশি আশি একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি আটাশি উননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই'.split(' ');
const MONTHS = 'জানুয়ারি ফেব্রুয়ারি মার্চ এপ্রিল মে জুন জুলাই আগস্ট সেপ্টেম্বর অক্টোবর নভেম্বর ডিসেম্বর'.split(' ');
export const englishDigits = text => String(text).replace(/[০-৯]/g, d => String(DIGITS.indexOf(d)));
export function numberToBangla(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Unsupported or unsafe integer');
  if (n < 0) return 'ঋণাত্মক ' + numberToBangla(-n);
  if (n < 100) return WORDS[n];
  for (const [unit, name] of [[10000000,'কোটি'],[100000,'লাখ'],[1000,'হাজার'],[100,'শ']]) {
    if (n >= unit) {
      const prefix = numberToBangla(Math.floor(n / unit)) + (unit === 100 ? '' : ' ') + name;
      return prefix + (n % unit ? ' ' + numberToBangla(n % unit) : '');
    }
  }
}
function ordinal(n) {
  const map = {1:'পহেলা',2:'দোসরা',3:'তেসরা',4:'চৌঠা',5:'পাঁচই',6:'ছয়ই',7:'সাতই',8:'আটই',9:'নয়ই',10:'দশই',11:'এগারোই',12:'বারোই',13:'তেরোই',14:'চৌদ্দই',15:'পনেরোই',16:'ষোলোই',17:'সতেরোই',18:'আঠারোই',19:'উনিশে',20:'বিশে',21:'একুশে',22:'বাইশে',23:'তেইশে',24:'চব্বিশে',25:'পঁচিশে',26:'ছাব্বিশে',27:'সাতাশে',28:'আটাশে',29:'উনত্রিশে',30:'ত্রিশে',31:'একত্রিশে'};
  if (!map[n]) throw new Error('Invalid day');
  return map[n];
}
export function normalizeBanglaForTts(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Empty narration');
  let text = englishDigits(raw.normalize('NFC').replace(/[\u200b\ufeff]/g,''));
  for (const [a,b] of [['বি:দ্র:','বিশেষ দ্রষ্টব্য'],['ডঃ','ডক্টর'],['ডা:','ডাক্তার'],['মোঃ','মোহাম্মদ'],['মো:','মোহাম্মদ'],['লিঃ','লিমিটেড']]) text = text.replaceAll(a,b);
  text=text.replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g,(_,y,m,d)=>`${d}/${m}/${y}`);
  text = text.replace(/(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g, (_,d,m,y) => {
    const date = new Date(Date.UTC(+y,+m-1,+d));
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m-1 || date.getUTCDate() !== +d) throw new Error('Invalid calendar date');
    return `${ordinal(+d)} ${MONTHS[+m-1]} ${numberToBangla(+y)}`;
  });
  text = text.replace(/(?<!\d)(?:\+88)?01[3-9](?:[ -]?\d){8}(?!\d)/g, value => value.replace(/\D/g,'').split('').map(d => WORDS[+d]).join(' '));
  text=text.replace(/(?<!\d)(\d{1,2})(?:শে|ই|লা|রা|ঠা)(?![\u0980-\u09ff])/g,(_,n)=>ordinal(+n));
  // Numeric grouping must be valid; dollar signs must never become taka.
  text = text.replace(/\d(?:[\d,]*\d)?(?:\.\d+)?/g, token => {
    const [integer, frac] = token.split('.');
    if (integer.includes(',') && !/^\d{1,3}(?:,\d{3})+$/.test(integer) && !/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(integer)) throw new Error('Invalid digit grouping');
    return numberToBangla(integer.replaceAll(',','')) + (frac ? ' দশমিক ' + [...frac].map(d => WORDS[+d]).join(' ') : '');
  });
  text = text.replace(/৳\s*/g,'টাকা ').replace(/\$\s*/g,'ডলার ').replace(/%/g,' শতাংশ');
  text = text.replace(/\bFacebook\b/gi,'ফেসবুক').replace(/\bYouTube\b/gi,'ইউটিউব');
  return text.replace(/\s+/g,' ').trim();
}
