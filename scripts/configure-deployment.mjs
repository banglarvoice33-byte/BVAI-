// Requires the NEW project service key. Sends only two public origins to its RLS-protected table.
const env = process.env;
for (const name of ['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
 if (!env[name]) throw new Error(`Missing ${name}`);
}
for (const name of ['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_URL']) {
 const url = new URL(env[name]);
 if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /example|YOUR-|localhost/i.test(url.hostname)) throw new Error(`Invalid production origin: ${name}`);
}
const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const res = await fetch(`${base}/rest/v1/deployment_settings?on_conflict=key`, {
 method:'POST', headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates'},
 body:JSON.stringify(['SITE_URL','SUPABASE_URL'].map((key,i)=>({key,value:env[i ? 'NEXT_PUBLIC_SUPABASE_URL':'NEXT_PUBLIC_SITE_URL'].replace(/\/$/, '')}))),
 signal:AbortSignal.timeout(15000)
});
if (!res.ok) throw new Error(`Deployment settings rejected: ${res.status}`);
console.log('New deployment origins saved; schedulers remain disabled until reviewed.');
