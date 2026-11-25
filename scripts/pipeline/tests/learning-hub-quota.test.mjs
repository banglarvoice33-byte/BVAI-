import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('database quota admits exactly ten per account, resets on Dhaka day, and is service-only', async () => {
  const db = new PGlite();
  const a = '10000000-0000-4000-8000-000000000001';
  const b = '10000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${a}'), ('${b}');`);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261124000000_learning_hub_quota.sql', import.meta.url), 'utf8'));
    const execute = async id => (await db.query('select public.consume_learning_hub_question($1) as n', [id])).rows[0].n;
    await db.exec('set role authenticated');
    await assert.rejects(execute(a), /permission denied/);
    await db.exec('set role service_role');
    const counts = await Promise.all(Array.from({ length: 12 }, () => execute(a)));
    assert.deepEqual(counts.sort((x,y) => y-x), [9,8,7,6,5,4,3,2,1,0,-1,-1]);
    assert.equal(await execute(b), 9);
    await db.exec('reset role');
    await db.query("update public.learning_hub_usage set quota_day = (statement_timestamp() at time zone 'Asia/Dhaka')::date - 1 where user_id = $1", [a]);
    assert.equal(await execute(a), 9);
    const state = (await db.query("select quota_day=(statement_timestamp() at time zone 'Asia/Dhaka')::date as is_today from public.learning_hub_usage where user_id=$1", [a])).rows[0];
    assert.equal(state.is_today, true);
  } finally { await db.close(); }
});
