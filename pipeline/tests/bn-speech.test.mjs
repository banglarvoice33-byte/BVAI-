import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS_0_99, intToWords, normalizeBanglaForSpeech } from '../bn-speech.mjs';

const n = (s) => normalizeBanglaForSpeech(s).text;

test('word table is complete, unique and has no digits', () => {
  assert.equal(WORDS_0_99.length, 100);
  assert.equal(new Set(WORDS_0_99).size, 100);
  for (const w of WORDS_0_99) assert.ok(w.length > 0 && !/[0-9০-৯]/.test(w), w);
});

test('spot checks confirmed against published Bengali number lists', () => {
  const expected = {
    20: 'বিশ', 21: 'একুশ', 22: 'বাইশ', 26: 'ছাব্বিশ', 30: 'ত্রিশ',
    43: 'তেতাল্লিশ', 73: 'তিয়াত্তর', 81: 'একাশি', 84: 'চুরাশি', 88: 'আটাশি',
    90: 'নব্বই', 91: 'একানব্বই', 98: 'আটানব্বই', 99: 'নিরানব্বই',
  };
  for (const [num, word] of Object.entries(expected)) assert.equal(WORDS_0_99[num], word, num);
});

test('integers, years and Indian grouping', () => {
  assert.equal(n('৭৩'), 'তিয়াত্তর');
  assert.equal(n('৪৩'), 'তেতাল্লিশ');
  assert.equal(n('২০২৬'), 'দুই হাজার ছাব্বিশ');
  assert.equal(n('১৯৭১'), 'এক হাজার নয়শো একাত্তর');
  assert.equal(n('১০ কোটি'), 'দশ কোটি');
  assert.equal(n('১,২৫,০০০'), 'এক লাখ পঁচিশ হাজার');
  assert.equal(n('1,250'), 'এক হাজার দুইশো পঞ্চাশ');
  assert.equal(intToWords(100), 'একশো');
  assert.equal(intToWords(1000), 'এক হাজার');
});

test('decimals, percent and the half idioms', () => {
  assert.equal(n('১২.৫%'), 'বারো দশমিক পাঁচ শতাংশ');
  assert.equal(n('৫০ শতাংশ'), 'পঞ্চাশ শতাংশ');
  assert.equal(n('৩.৫ লাখ'), 'সাড়ে তিন লাখ');
  assert.equal(n('১.৫ কোটি'), 'দেড় কোটি');
  assert.equal(n('২.৫ লাখ'), 'আড়াই লাখ');
  assert.equal(n('৩.১৪'), 'তিন দশমিক এক চার');
});

test('currency', () => {
  assert.equal(n('৳৫০০'), 'পাঁচশো টাকা');
  assert.equal(n('£১০০'), 'একশো পাউন্ড');
  assert.equal(n('$৫০ মিলিয়ন'), 'পঞ্চাশ মিলিয়ন ডলার');
});

test('clock times use সোয়া/সাড়ে/পৌনে, never "চারটা থার্টি"', () => {
  assert.equal(n('সকাল ৯টা'), 'সকাল নয়টা');
  assert.equal(n('দুপুর ১২টা'), 'দুপুর বারোটা');
  assert.equal(n('বিকেল ৪:৩০'), 'বিকেল সাড়ে চারটা');
  assert.equal(n('সন্ধ্যা ৭টা'), 'সন্ধ্যা সাতটা');
  assert.equal(n('রাত ১১টা'), 'রাত এগারোটা');
  assert.equal(n('ভোর ৫টা'), 'ভোর পাঁচটা');
  assert.equal(n('১:৩০'), 'দেড়টা');
  assert.equal(n('২:৩০'), 'আড়াইটা');
  assert.equal(n('৪:১৫'), 'সোয়া চারটা');
  assert.equal(n('৪:৪৫'), 'পৌনে পাঁচটা');
  assert.equal(n('১২:৪৫'), 'পৌনে একটা');
  assert.equal(n('৯:১০'), 'নয়টা দশ');
  assert.equal(n('১৬:৩০'), 'বিকেল সাড়ে চারটা');
  assert.equal(n('০০:৩০'), 'রাত সাড়ে বারোটা');
  assert.equal(n('৯টায়'), 'নয়টায়');
});

test('surrounding words and spaces are preserved', () => {
  assert.equal(n('এখন ৪:৩০ বাজে'), 'এখন সাড়ে চারটা বাজে');
  assert.equal(n('আজ ৭৩ জন'), 'আজ তিয়াত্তর জন');
});

test('phone-like runs are read digit by digit; Latin-glued digits stay', () => {
  assert.equal(n('০১৭১২৩৪৫৬৭৮'), 'শূন্য এক সাত এক দুই তিন চার পাঁচ ছয় সাত আট');
  assert.equal(n('COVID-19 এর'), 'COVID-19 এর');
  assert.equal(n('F-16 বিমান'), 'F-16 বিমান');
});

test('changes are reported for audit', () => {
  const { changes } = normalizeBanglaForSpeech('বিকেল ৪:৩০');
  assert.deepEqual(changes.map((c) => c.kind), ['time']);
});
