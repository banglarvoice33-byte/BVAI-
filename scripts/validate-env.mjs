import { pathToFileURL } from 'node:url';
export function validateEnv(env) {
 const errors = [];
 for (const name of ['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_URL']) {
  try { const u = new URL(env[name] || '');
   if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || /example|YOUR-|localhost|127\.0\.0\.1/i.test(u.hostname)) throw 0;
  } catch { errors.push(`${name}: real HTTPS origin required`); }
 }
 const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
 if (!key || /YOUR-|change-me|your-anon/i.test(key)) errors.push('Public Supabase key missing');
 if (key.startsWith('sb_secret_')) errors.push('Secret key must never be public');
 if (key.startsWith('eyJ')) {
  try { if (JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role !== 'anon') errors.push('Browser JWT must be anon'); }
  catch { errors.push('Malformed browser JWT'); }
 }
 for (const name of ['NEWSROOM_INGEST_KEY','CRON_SECRET']) {
  if (!env[name] || env[name].length < 32 || /change-me|example|YOUR-/i.test(env[name])) errors.push(`${name}: use a new random secret >=32 characters`);
 }
 if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push('Server service-role key missing');
 return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const errors = validateEnv(process.env);
 if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
 else console.log('Required deployment configuration passed. No secrets printed.');
}
