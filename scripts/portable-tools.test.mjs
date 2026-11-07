import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateEnv} from './validate-env.mjs';
const source = await readFile(new URL('../deploy/cloudflare-pages/functions/[[path]].js',import.meta.url),'utf8');
const {onRequest} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const valid={NEXT_PUBLIC_SITE_URL:'https://news.test',NEXT_PUBLIC_SUPABASE_URL:'https://backend.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_testpublickey',SUPABASE_SERVICE_ROLE_KEY:'server-test-only',NEWSROOM_INGEST_KEY:'a'.repeat(48),CRON_SECRET:'b'.repeat(48)};
test('accepts complete new configuration',()=>assert.deepEqual(validateEnv(valid),[]));
test('rejects public secret key',()=>assert.ok(validateEnv({...valid,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_secret_test'}).length));
test('rejects missing secrets and fake origins',()=>assert.ok(validateEnv({}).length>=6));
test('rejects origin credentials and URL path',()=>assert.ok(validateEnv({...valid,NEXT_PUBLIC_SITE_URL:'https://user:password@news.test/path'}).length));
test('gateway fails closed without origin',async()=>assert.equal((await onRequest({request:new Request('https://edge.test/'),env:{}})).status,503));
test('gateway blocks loop',async()=>assert.equal((await onRequest({request:new Request('https://edge.test/'),env:{APP_ORIGIN:'https://edge.test'}})).status,503));
test('gateway preserves method, body, query and response stream without following redirects',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://origin.test/api/example?q=1');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(await new Response(init.body).text(),'payload');assert.equal(init.headers.get('x-pages-origin-key'),'fresh-secret');return new Response('ok',{status:201,headers:{'Set-Cookie':'session=abc; Secure; HttpOnly'}});};
 try {const res=await onRequest({request:new Request('https://edge.test/api/example?q=1',{method:'POST',body:'payload'}),env:{APP_ORIGIN:'https://origin.test',ORIGIN_SHARED_SECRET:'fresh-secret'}});assert.equal(res.status,201);assert.equal(await res.text(),'ok');assert.ok(res.headers.get('set-cookie'));assert.equal(res.headers.get('cache-control'),'private, no-store');} finally{globalThis.fetch=original;}
});
test('gateway rewrites only own origin redirects',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://origin.test/login?next=1'}});
 try{const res=await onRequest({request:new Request('https://edge.test/admin'),env:{APP_ORIGIN:'https://origin.test'}});assert.equal(res.headers.get('location'),'https://edge.test/login?next=1');}finally{globalThis.fetch=original;}
});
