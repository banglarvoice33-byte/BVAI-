#!/usr/bin/env node
/**
 * Live smoke: content-aware candidates for one headline.
 * Usage:
 *   PIXABAY_API_KEY=... PEXELS_API_KEY=... node scripts/pipeline/smoke-candidates.mjs
 *   node scripts/pipeline/smoke-candidates.mjs "ঢাকায় ক্রিকেট ম্যাচে বৃষ্টি" sports
 *
 * Never prints secrets. Keys stay in env only — never commit them.
 */
import { buildQueries, candidates, licenseOk } from './media-sources.mjs';
import { rankVisuals } from './enhanced/composer.mjs';

const title_bn = process.argv[2] || 'ঢাকায় ক্রিকেট ম্যাচে বৃষ্টি';
const category_key = process.argv[3] || 'sports';
const limit = Number(process.env.SMOKE_LIMIT || 12);

const brief = buildQueries({ title_bn, category_key });
console.log(JSON.stringify({ title_bn, category_key, brief: { topics: brief.topics.map((t) => t[0]), queries: brief.queries, sensitive: brief.sensitive } }, null, 2));

if (brief.sensitive) {
  console.log('SKIP: sensitive story — no stock media');
  process.exit(0);
}

const keys = {
  PIXABAY_API_KEY: Boolean(process.env.PIXABAY_API_KEY),
  PEXELS_API_KEY: Boolean(process.env.PEXELS_API_KEY),
};
console.log('keys_present', keys);

const seen = [];
const providers = {};
for await (const hit of candidates({ title_bn, category_key })) {
  if (!licenseOk(hit.license)) continue;
  const rank = rankVisuals({ spoken_text: title_bn }, [hit], { context: title_bn })[0];
  providers[hit.provider] = (providers[hit.provider] || 0) + 1;
  if (rank.score <= 0) continue;
  seen.push({
    provider: hit.provider,
    kind: hit.kind,
    license: hit.license,
    query: hit.query,
    score: rank.score,
    method: rank.method,
    title: String(hit.title || '').slice(0, 60),
  });
  if (seen.length >= limit) break;
}

console.log(JSON.stringify({ accepted: seen.length, providers, sample: seen.slice(0, 8) }, null, 2));
if (!seen.length) {
  console.error('FAIL: zero accepted candidates (check keys + network + ranking)');
  process.exit(2);
}
console.log('OK: content-aware candidates accepted');
