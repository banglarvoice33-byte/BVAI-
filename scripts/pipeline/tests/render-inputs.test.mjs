import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapLines, renderSegment, composeFinal } from '../video-compose.mjs';
const segmenter = new Intl.Segmenter('bn', { granularity: 'grapheme' });
const length = (text) => [...segmenter.segment(text)].length;

test('headline wrapping bounds single unbroken words and URLs, including one-line titles', () => {
  for (const title of ['ক্রীড়া'.repeat(100), 'https://example.org/' + 'a'.repeat(200), 'A very long headline with several ordinary words '.repeat(10)]) {
    for (const lines of [1, 2, 4]) {
      const result = wrapLines(title, 23, lines);
      assert.ok(result.length <= lines);
      assert.ok(result.every((line) => length(line) <= 23));
      assert.match(result.at(-1), /…$/);
    }
  }
});
test('headline wrapping handles empty titles and invalid budgets', () => {
  assert.deepEqual(wrapLines(null, 23, 4), ['']);
  assert.deepEqual(wrapLines('দেশের সংবাদ', 23, 4), ['দেশের সংবাদ']);
  for (const [width, lines] of [[0, 4], [23, 0], [NaN, 4], [3.5, 4]]) assert.throws(() => wrapLines('headline', width, lines), /budget/);
});
test('rendering rejects invalid duration/kind before spawning FFmpeg', async () => {
  for (const duration of [NaN, Infinity, -1, 0, 0.001, 121, '14']) await assert.rejects(renderSegment({ duration, kind: 'brand' }), /duration|frame/);
  await assert.rejects(renderSegment({ duration: 1, kind: 'unsupported' }), /Unsupported segment/);
  await assert.rejects(composeFinal({ total: 42, outFile: 'a.png', segments: [] }), /MP4/);
  await assert.rejects(composeFinal({ total: 42, outFile: 'a.mp4', segments: [] }), /At least one/);
});
