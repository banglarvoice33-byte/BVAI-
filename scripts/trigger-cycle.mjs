const base = process.env.NEXT_PUBLIC_SITE_URL || '';
const secret = process.env.NEWSROOM_INGEST_KEY || '';
const url = new URL(base);
if (url.protocol !== 'https:' || url.username || url.password || /example|localhost|YOUR-/i.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || secret.length < 32) throw new Error('New production HTTPS origin and strong ingest secret required');
// No retry after an uncertain POST: the server pipeline owns idempotency.
const result = await fetch(new URL('/api/newsroom/cron-trigger', url), {
 method:'POST', redirect:'error', headers:{Authorization:`Bearer ${secret}`, 'Content-Type':'application/json'},
 body:'{}',signal:AbortSignal.timeout(65000)
});
console.log(`Newsroom cycle HTTP ${result.status}`);
if (!result.ok) process.exitCode = 1;
