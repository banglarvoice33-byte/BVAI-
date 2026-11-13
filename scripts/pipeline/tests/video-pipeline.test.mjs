import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseOk, buildQueries } from '../media-sources.mjs';
import { sourceNameBn, contentKey, scriptHash, speakableSentences, CTA } from '../video-script.mjs';
import { planSlots } from '../generate-video.js';
import { wrapLines } from '../video-compose.mjs';
import { parseLoudnormJson, loudnessOk, loudnormFilter } from '../audio-qc.mjs';

test('only CC0 / public domain / plain CC BY licences are usable for symbolic B-roll', () => {
  for (const ok of ['CC0', 'Public domain', 'CC BY 4.0', 'CC BY 2.0', 'CC-BY-3.0', 'Public domain (NASA)', 'PDM 1.0']) assert.equal(licenseOk(ok), true, ok);
  for (const bad of ['CC BY-SA 4.0', 'CC BY-NC 2.0', 'CC BY-ND 4.0', 'GFDL', 'Fair use', 'All rights reserved', '', null]) assert.equal(licenseOk(bad), false, String(bad));
});

test('queries are topical, bounded and always end with a safe generic fallback', () => {
  const { category, queries } = buildQueries({ category_key: 'sports', title_bn: 'ঢাকায় ক্রিকেট ম্যাচে বৃষ্টি', content_bn: '' });
  assert.equal(category, 'sports');
  assert.ok(queries.includes('cricket stadium') && queries.includes('monsoon rain street'));
  assert.ok(queries.length <= 12 && queries.at(-1) === 'Bangladesh');
  assert.equal(buildQueries({ category_key: 'অজানা', title_bn: 'x', content_bn: '' }).category, 'national');
});

test('source names are spoken in Bengali; unknown Latin names are never mispronounced', () => {
  assert.equal(sourceNameBn('Prothom Alo'), 'প্রথম আলো');
  assert.equal(sourceNameBn('BBC Technology'), 'বিবিসি');
  assert.equal(sourceNameBn('Some Unknown Daily'), null);
  assert.equal(sourceNameBn('যুগান্তর'), 'যুগান্তর');
});

test('story identity is stable across punctuation and case, scripts hash differently', () => {
  assert.equal(contentKey({ title_bn: 'ঢাকায় বৃষ্টি!' }), contentKey({ title_bn: ' ঢাকায়  বৃষ্টি ' }));
  assert.notEqual(scriptHash('ক'), scriptHash('খ'));
  assert.ok(CTA.startsWith('বিস্তারিত দেখতে বাংলার ভয়েস ওয়েব সাইট ভিজিট করুন'));
});

test('long sentences are split at commas, short fragments dropped', () => {
  const long = Array.from({ length: 40 }, (_, i) => `শব্দ${i}`).join(' ');
  const parts = speakableSentences(`${long.slice(0, 120)}, ${long.slice(120)}। ছোট।`);
  assert.ok(parts.length >= 2 && parts.every((p) => p.endsWith('।')) && !parts.includes('ছোট।'));
});

test('slot plan covers the whole timeline with at least three cuts and never more slots than assets', () => {
  for (const [total, assets] of [[41, 99], [61.4, 2], [61.4, 0], [113, 99], [113, 4]]) {
    const { count, durations } = planSlots(total, assets);
    assert.ok(count >= 3 && count <= 10 && (assets >= 3 ? count <= assets : true));
    assert.ok(Math.abs(durations.reduce((a, b) => a + b, 0) - total) < 1e-6);
  }
});

test('headline wrapping never exceeds its line budget', () => {
  const lines = wrapLines('ঢাকায় আজ বিকেলে ভারী বৃষ্টিতে জলাবদ্ধতা যান চলাচলে চরম দুর্ভোগ এবং ভোগান্তি বেড়েছে '.repeat(3), 23, 4);
  assert.ok(lines.length <= 4);
});

test('loudness helpers parse ffmpeg output and enforce the upload gate', () => {
  const stderr = 'noise\n{\n\t"input_i" : "-14.20",\n\t"input_tp" : "-2.10",\n\t"input_lra" : "5.00",\n\t"input_thresh" : "-24.50",\n\t"target_offset" : "0.10"\n}\n';
  const m = parseLoudnormJson(stderr);
  assert.equal(loudnessOk(m), true);
  assert.equal(loudnessOk({ input_i: '-20', input_tp: '-2' }), false);
  assert.equal(loudnessOk({ input_i: '-14', input_tp: '-0.5' }), false);
  assert.match(loudnormFilter(m), /measured_I=-14.2.*linear=true/);
  assert.throws(() => parseLoudnormJson('no json here'));
});
