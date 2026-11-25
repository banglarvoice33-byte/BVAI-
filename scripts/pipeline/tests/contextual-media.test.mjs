import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQueries } from '../media-sources.mjs';
import { assignVisuals, rankVisuals } from '../enhanced/composer.mjs';
import { sportDetail } from '../visual-topics.mjs';
const asset = (title, extra = {}) => ({ title, author: 'Creator', license: 'CC BY 4.0', kind: 'video', source_url: 'https://commons.wikimedia.org/wiki/File:Example', license_url: 'https://creativecommons.org/licenses/by/4.0/', ...extra });

test('Champions League implies football; ambiguous World Cup does not imply cricket or football', () => {
  const title_bn = 'আর্সেনাল–ডর্টমুন্ড: চ্যাম্পিয়ন্স লিগের ম্যাচ';
  const brief = buildQueries({ title_bn, category_key: 'sports' });
  assert.deepEqual(brief.topics.map(t => t[0]), ['football']);
  assert.equal(sportDetail(title_bn), 'চ্যাম্পিয়ন্স লিগ');
  assert.deepEqual(buildQueries({ title_bn: 'আজ বিশ্বকাপ শুরু', category_key: 'sports' }).queries, []);
});

test('rejects the search-query echo, unrelated weather and wrong sport', () => {
  const scene = { spoken_text: 'ক্রিকেট ম্যাচে বৃষ্টি' };
  const list = [asset('A city scene', { query: 'cricket stadium' }), asset('Monsoon rain and football'), asset('Cricket wicket'), asset('Football match')];
  const ranks = rankVisuals(scene, list);
  assert.deepEqual(ranks.filter(r => r.score).map(r => r.index), [2]);
});

test('coverage is scene-local, assets unique, and sensitive footage not inferred', () => {
  const scenes = [{ spoken_text: 'জলাবদ্ধতা দেখা গেছে' }, { spoken_text: 'ট্রেন চলাচল বন্ধ' }, { spoken_text: 'নতুন খবর' }];
  const library = [asset('Flooded village'), asset('Railway train station')];
  const assignment = assignVisuals(scenes, library, { context: 'বৃষ্টি এবং ট্রেন' });
  assert.equal(assignment[0].asset, library[0]);
  assert.equal(assignment[1].asset, library[1]);
  assert.equal(assignment[2].asset, null);
  assert.ok(assignVisuals(scenes, library, { sensitive: true }).every(x => x.asset === null));
  assert.equal(buildQueries({ title_bn: 'জাহাজে হামলা' }).sensitive, true);
});
