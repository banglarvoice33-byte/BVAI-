/**
 * BVAI news pipeline: slot logic. Every decision is made in Asia/Dhaka time.
 *
 * Why Intl and not Date#getHours: getHours() returns the hour in the PROCESS's
 * local time zone (MDN: "according to local time"). Render/Vercel/GitHub runners
 * normally run in UTC, so getHours() would be 6 hours off.
 *
 * The same rules exist in SQL (public.pipeline_due_slots). Keep both in sync;
 * sql/02_verify.sql is generated from this file by pipeline/gen-verify-sql.mjs.
 */

const FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Day articles: first slot 06:00, then every 14 minutes, last slot 23:44. */
export const ARTICLE_DAY_START_MIN = 6 * 60;
export const ARTICLE_INTERVAL_MIN = 14;
export const ARTICLE_LAST_DAY_INDEX = 76; // 06:00 + 76 * 14 min = 23:44
/** Night articles (00:00 to 05:00): one per hour on the hour. */
export const ARTICLE_NIGHT_END_MIN = 6 * 60;

/**
 * Video PUBLISH slots (Asia/Dhaka). 12 slots = the "at least 12 videos a day" goal.
 * These are a starting point, not a measurement: replace with the hours shown in
 * YouTube Studio ("When your viewers are on YouTube") and Meta Insights.
 */
export const VIDEO_PUBLISH_SLOTS = [
  '07:00', '08:30', '10:00', '12:00', '13:30', '15:00',
  '17:00', '18:30', '20:00', '21:00', '22:00', '23:00',
];

/** A video job is created this many minutes before its publish slot. */
export const VIDEO_LEAD_MINUTES = 60;

/** @param {Date} date */
export function dhakaParts(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('A valid Date is required');
  }
  const p = {};
  for (const part of FMT.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

/** @param {Date} date */
export function minutesOfDayDhaka(date) {
  const p = dhakaParts(date);
  return p.hour * 60 + p.minute;
}

/** @param {Date} date */
export function formatHHMMDhaka(date) {
  const p = dhakaParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** True when an article should start at this minute. @param {Date} date */
export function isArticleSlot(date) {
  const minutes = minutesOfDayDhaka(date);
  if (minutes >= ARTICLE_DAY_START_MIN) {
    const offset = minutes - ARTICLE_DAY_START_MIN;
    return offset % ARTICLE_INTERVAL_MIN === 0 && offset / ARTICLE_INTERVAL_MIN <= ARTICLE_LAST_DAY_INDEX;
  }
  return minutes % 60 === 0; // 00:00, 01:00 ... 05:00
}

/** True when a video is scheduled to PUBLISH at this minute. @param {Date} date */
export function isVideoPublishSlot(date) {
  return VIDEO_PUBLISH_SLOTS.includes(formatHHMMDhaka(date));
}

/** True when a video job must be created now (publish slot is VIDEO_LEAD_MINUTES away). @param {Date} date */
export function isVideoJobDue(date) {
  return isVideoPublishSlot(new Date(date.getTime() + VIDEO_LEAD_MINUTES * 60_000));
}
