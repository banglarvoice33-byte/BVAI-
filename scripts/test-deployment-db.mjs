// Only a disposable DB: never point this at production.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const url=process.env.TEST_DATABASE_URL;
if (!url || process.env.ALLOW_DISPOSABLE_DB_TEST !== 'true' || !new URL(url).pathname.endsWith('_test')) throw new Error('Explicit disposable *_test database opt-in required');
const pool=new pg.Pool({connectionString:url,max:8});
try{
 for(const name of ['20260801000000_portable_deployment.sql','20261107010000_gateway_atomic_daily_budget.sql']) await pool.query(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await pool.query('truncate public.ai_gateway_daily_budget, public.deployment_settings');
 await pool.query("insert into public.deployment_settings(key,value) values ('SITE_URL','https://news.test')");
 assert.equal((await pool.query("select public.deployment_setting('SITE_URL') as origin")).rows[0].origin,'https://news.test');
 console.log('PASS new site origin resolved without an old account');
 const reservations=await Promise.all(Array.from({length:24},()=>pool.query("select public.reserve_ai_gateway_request('test_task',7) as allowed")));
 assert.equal(reservations.filter(r=>r.rows[0].allowed===true).length,7);
 assert.equal((await pool.query("select requests from public.ai_gateway_daily_budget where task='test_task'")).rows[0].requests,7);
 console.log('PASS 24 concurrent requests allow exactly 7 reservations');
 assert.equal((await pool.query("select public.reserve_ai_gateway_request('test_task',0) as allowed")).rows[0].allowed,false);
 console.log('PASS invalid limits fail closed');
 const client=await pool.connect();
 try{await client.query('set role anon');await assert.rejects(client.query("select public.reserve_ai_gateway_request('test_task',100)"));await assert.rejects(client.query('select * from public.deployment_settings'));console.log('PASS anonymous callers cannot read settings or reserve gateway budget');}
 finally{await client.query('reset role');client.release();}
}finally{await pool.end();}
