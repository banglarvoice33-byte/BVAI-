import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIDEO_PUBLISH_SLOTS,
  dhakaParts,
  isArticleSlot,
  isVideoJobDue,
  isVideoPublishSlot,
} from '../schedule.mjs';

const at = (hhmm, day = '2026-11-27') => new Date(`${day}T${hhmm}:00+06:00`);

test('dhakaParts reads Asia/Dhaka time whatever the process time zone is', () => {
  const p = dhakaParts(new Date('2026-11-26T18:00:00Z')); // = 00:00 on 27 Nov in Dhaka
  assert.deepEqual(p, { year: 2026, month: 11, day: 27, hour: 0, minute: 0 });
});

test('article day grid: 06:00 then every 14 minutes, last 23:44', () => {
  for (const ok of ['06:00', '06:14', '06:28', '06:42', '06:56', '07:10', '23:44']) {
    assert.equal(isArticleSlot(at(ok)), true, ok);
  }
  // the old "minute % 14" rule fired at 07:00 and left a 4 minute gap after 06:56
  for (const no of ['05:59', '06:13', '07:00', '07:01', '23:58']) {
    assert.equal(isArticleSlot(at(no)), false, no);
  }
});

test('article night grid: hourly on the hour from 00:00 to 05:00', () => {
  for (const ok of ['00:00', '01:00', '03:00', '05:00']) assert.equal(isArticleSlot(at(ok)), true, ok);
  for (const no of ['00:01', '00:30', '05:30']) assert.equal(isArticleSlot(at(no)), false, no);
});

test('a full Dhaka day has 83 article slots and no gap shorter than 14 minutes', () => {
  const start = at('00:00').getTime();
  const slots = [];
  for (let i = 0; i < 1440; i += 1) {
    if (isArticleSlot(new Date(start + i * 60_000))) slots.push(i);
  }
  assert.equal(slots.length, 83); // 77 day slots (06:00..23:44) + 6 night slots (00:00..05:00)
  const gaps = slots.slice(1).map((v, i) => v - slots[i]);
  assert.ok(Math.min(...gaps) >= 14, `min gap ${Math.min(...gaps)}`);
  assert.equal(Math.max(...gaps), 60); // night hourly grid
});

test('12 video publish slots, job is created 60 minutes earlier', () => {
  assert.equal(VIDEO_PUBLISH_SLOTS.length, 12);
  assert.equal(isVideoPublishSlot(at('07:00')), true);
  assert.equal(isVideoPublishSlot(at('07:01')), false);
  assert.equal(isVideoJobDue(at('06:00')), true); // for the 07:00 slot
  assert.equal(isVideoJobDue(at('22:00')), true); // for the 23:00 slot
  assert.equal(isVideoJobDue(at('23:00')), false); // no 00:00 slot
  let due = 0;
  const start = at('00:00').getTime();
  for (let i = 0; i < 1440; i += 1) if (isVideoJobDue(new Date(start + i * 60_000))) due += 1;
  assert.equal(due, 12);
});
