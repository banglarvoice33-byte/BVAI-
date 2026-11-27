import { englishDigits, numberToBangla, normalizeBanglaForTts } from './bangla-normalize.mjs';

// Speech pre-pass for patterns that normalizeBanglaForTts() reads in the wrong order or as decimals.
// Everything else (numbers, dates, ordinals, phone numbers, %) is delegated unchanged.
const BN_LETTER = '\\u0980-\\u09ff';
const PERIOD = '(?:ভোর|সকাল|দুপুর|বিকেল|বিকাল|সন্ধ্যা|রাত)';
const AMOUNT = '(\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?)(\\s*(?:কোটি|লাখ|হাজার|মিলিয়ন|বিলিয়ন|ট্রিলিয়ন))?';
const CLOCK = new RegExp(`(${PERIOD}\\s*)?(?<!\\d)(\\d{1,2})[:.](\\d{2})(?!\\d)(টায়|টা)?(\\s*মিনিট)?`, 'g');

/** "9:30" is a clock time only with a day-period word or a টা/টায় suffix; otherwise it may be a decimal or score. */
function clockToSpeech(match, period = '', hh, mm, suffix = '', minuteWord = '') {
  if (!period && !suffix) return match;
  const hour = Number(hh);
  const minute = Number(mm);
  if (hour > 23 || minute > 59) return match;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const h = numberToBangla(hour12);
  if (minute === 0) return `${period}${h}${suffix === 'টায়' ? 'টায়' : 'টা'}`;
  const m = numberToBangla(minute);
  if (minuteWord) return `${period}${h}টা ${m}${minuteWord}`;
  return `${period}${h}টা ${m} মিনিট${suffix === 'টায়' ? 'ে' : ''}`;
}

export function normalizeSpeechText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Empty narration');
  let text = englishDigits(raw.normalize('NFC'));
  text = text
    .replace(new RegExp(`(?<![${BN_LETTER}])ড\\.`, 'g'), 'ডক্টর')
    .replace(new RegExp(`(?<![${BN_LETTER}])মো\\.`, 'g'), 'মোহাম্মদ');
  // Bangla puts the currency word after the amount: ৳৫০০ -> ৫০০ টাকা, $৫০ মিলিয়ন -> ৫০ মিলিয়ন ডলার.
  text = text
    .replace(new RegExp(`৳\\s*${AMOUNT}`, 'g'), (_, n, unit = '') => `${n}${unit} টাকা`)
    .replace(new RegExp(`\\$\\s*${AMOUNT}`, 'g'), (_, n, unit = '') => `${n}${unit} ডলার`);
  text = text.replace(CLOCK, clockToSpeech);
  // dd.mm.yyyy is not understood by normalizeBanglaForTts(); rewrite to dd/mm/yyyy so its date path handles it.
  text = text.replace(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g, '$1/$2/$3');
  return normalizeBanglaForTts(text);
}
