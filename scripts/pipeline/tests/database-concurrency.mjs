// TEST DATABASE ONLY. Never reads SUPABASE_DB_URL or .env.
import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const raw=process.env.TEST_DATABASE_URL;
if(!raw)throw new Error('TEST_DATABASE_URL required for isolated integration database');
const url=new URL(raw);
if(!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test'))throw new Error('Refusing non-local/non-test database');
const a=new pg.Client({connectionString:raw}),b=new pg.Client({connectionString:raw});
const id=randomUUID();
await a.connect();await b.connect();
try {
  await a.query("INSERT INTO public.articles(id,title_bn,content_bn,status,published_at,human_verified,verification_status,source_published_at) VALUES($1,'পরীক্ষা',repeat('বিশ্বস্ত সংবাদ ',40),'published',now(),true,'verified',now())",[id]);
  await a.query('BEGIN');await b.query('BEGIN');
  await b.query('SET LOCAL statement_timeout=10000');
  const first=await a.query('SELECT * FROM public.claim_reviewed_video_job($1)',[id]);
  assert.equal(first.rows.length,1);
  const second=b.query('SELECT * FROM public.claim_reviewed_video_job($1)',[id]);
  await new Promise(resolve=>setTimeout(resolve,100));
  await a.query('COMMIT');
  assert.equal((await second).rows.length,0);
  await b.query('COMMIT');
  const jobs=await a.query('SELECT count(*)::integer AS n FROM public.video_generation_jobs WHERE article_id=$1',[id]);
  assert.equal(jobs.rows[0].n,1);
  console.log('PASS real two-session PostgreSQL concurrency: exactly one generation job claimed');
} finally {
  await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});
  await a.query('DELETE FROM public.video_generation_jobs WHERE article_id=$1',[id]);
  await a.query('DELETE FROM public.articles WHERE id=$1',[id]);
  await a.end();await b.end();
}
