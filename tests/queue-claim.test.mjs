import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Requires a local Supabase/Postgres with the migration applied:
//   DATABASE_URL=postgres://... node --test tests/queue-claim.test.mjs
const DB = process.env.DATABASE_URL;
test('claim_agnes_job returns NULL on empty queue', { skip: !DB }, () => {
  const out = execFileSync('psql', [DB, '-tAc', "select (public.claim_agnes_job('w1', 60)).id is null"], { encoding: 'utf8' });
  assert.equal(out.trim(), 't');
});
