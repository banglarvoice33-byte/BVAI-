import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQueries } from '../media-sources.mjs';
import { assignVisuals, rankVisuals } from '../enhanced/composer.mjs';
import { sportDetail } from '../visual-topics.mjs';

const asset = (title, extra = {}) => ({
  title,
  author: 'Creator',
  license: 'CC BY 4.0',
  kind: 'video',
  source_url: 'https://commons.wikimedia.org/wiki/File:Example',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  ...extra,
});

test('Champions League implies football; ambiguous World Cup does not imply cricket or football', () => {
  const title_bn = 'আর্সেনাল–ডর্টমুন্ড: চ্যাম্পিয়ন্স লিগের ম্যাচ';
  const brief = buildQueries({ title_bn, category_key: 'sports' });
  assert.deepEqual(brief.topics.map((t) => t[0]), ['football']);
  assert.equal(sportDetail(title_bn), 'চ্যাম্পিয়ন্স লিগ');
  assert.deepEqual(buildQueries({ title_bn: 'আজ বিশ্বকাপ শুরু', category_key: 'sports' }).queries, []);
});

test('cricket + rain is sport+rain, never flood disaster footage', () => {
  const title_bn = 'ঢাকায় ক্রিকেট ম্যাচে বৃষ্টি';
  const brief = buildQueries({ title_bn, category_key: 'sports' });
  const ids = brief.topics.map((t) => t[0]);
  assert.ok(ids.includes('cricket'), `expected cricket in ${ids}`);
  assert.ok(ids.includes('rain'), `expected rain modifier in ${ids}`);
  assert.ok(!ids.includes('flood'), `rain must not invent flood: ${ids}`);
  assert.ok(brief.queries.includes('cricket stadium'));
  assert.ok(brief.queries.includes('monsoon rain street'));
  assert.ok(!brief.queries.some((q) => /flooded|flood water/i.test(q)), brief.queries);
});

test('true flood language still yields flood queries without sport', () => {
  const brief = buildQueries({
    title_bn: 'সিলেটে বন্যায় জলাবদ্ধতা, রাস্তা ডুবে গেছে',
    category_key: 'national',
  });
  assert.ok(brief.topics.some((t) => t[0] === 'flood'));
  assert.ok(brief.queries.some((q) => /flooded|flood water|waterlogging/i.test(q)));
});

test('rejects the search-query echo, unrelated weather and wrong sport', () => {
  const scene = { spoken_text: 'ক্রিকেট ম্যাচে বৃষ্টি' };
  const list = [
    asset('A city scene', { query: 'cricket stadium' }),
    asset('Monsoon rain and football'),
    asset('Cricket wicket'),
    asset('Football match'),
  ];
  const ranks = rankVisuals(scene, list);
  assert.deepEqual(
    ranks.filter((r) => r.score).map((r) => r.index),
    [2],
  );
});

test('rejects baseball, music-stand and generic stadium when target is cricket', () => {
  const scene = { spoken_text: 'ঢাকায় ক্রিকেট ম্যাচে বৃষ্টি' };
  const list = [
    asset('baseball, field, stadium, bleachers, sports', {
      provider: 'pixabay',
      query: 'cricket stadium',
      license_url: 'https://pixabay.com/service/license/',
    }),
    asset('music stand, instrument, music, old music, musical, stadium', {
      provider: 'pixabay',
      query: 'cricket stadium',
      license_url: 'https://pixabay.com/service/license/',
    }),
    asset('montreal, aerial view, stadium, city, streets', {
      provider: 'pixabay',
      query: 'cricket stadium',
      license_url: 'https://pixabay.com/service/license/',
    }),
    asset('stadium, cricket, top view, drone', {
      provider: 'pixabay',
      query: 'cricket stadium',
      license_url: 'https://pixabay.com/service/license/',
    }),
    asset('stadium, british, cricket, somerset, taunton', {
      provider: 'pixabay',
      query: 'cricket stadium',
      license_url: 'https://pixabay.com/service/license/',
    }),
  ];
  const ranks = rankVisuals(scene, list, { context: scene.spoken_text });
  const byIndex = Object.fromEntries(ranks.map((r) => [r.index, r]));
  const accepted = ranks.filter((r) => r.score > 0).map((r) => r.index).sort((a, b) => a - b);
  assert.deepEqual(accepted, [3, 4], `accepted=${accepted} methods=${JSON.stringify(byIndex)}`);
  assert.equal(byIndex[0].method, 'wrong_sport_reject');
  assert.equal(byIndex[0].score, 0);
  assert.equal(byIndex[1].method, 'offtopic_reject');
  assert.equal(byIndex[1].score, 0);
  // Generic stadium without cricket token: not accepted under sport target.
  assert.equal(byIndex[2].score, 0);
  assert.ok(byIndex[3].score > 0);
  assert.ok(byIndex[4].score > 0);
});

test('coverage is scene-local, assets unique, and sensitive footage not inferred', () => {
  const scenes = [
    { spoken_text: 'জলাবদ্ধতা দেখা গেছে' },
    { spoken_text: 'ট্রেন চলাচল বন্ধ' },
    { spoken_text: 'নতুন খবর' },
  ];
  const library = [asset('Flooded village'), asset('Railway train station')];
  const assignment = assignVisuals(scenes, library, { context: 'বৃষ্টি এবং ট্রেন' });
  assert.equal(assignment[0].asset, library[0]);
  assert.equal(assignment[1].asset, library[1]);
  assert.equal(assignment[2].asset, null);
  assert.ok(assignVisuals(scenes, library, { sensitive: true }).every((x) => x.asset === null));
  assert.equal(buildQueries({ title_bn: 'জাহাজে হামলা' }).sensitive, true);
});
