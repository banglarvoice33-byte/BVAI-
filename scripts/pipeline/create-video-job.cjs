const { Client } = require('pg');
const fs = require('node:fs');

async function main() {
  const db = process.env.SUPABASE_DB_URL;
  if (!db) throw new Error('SUPABASE_DB_URL is required');
  const requested = (process.env.ARTICLE_ID || '').trim() || null;
  const client = new Client({ connectionString: db, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('SELECT public.recover_expired_video_generation_jobs()');
    const { rows } = await client.query(
      'SELECT article_id, job_id, claim_token FROM public.claim_video_generation_job($1::uuid)',
      [requested]
    );
    if (!rows.length) throw new Error('No eligible published article is available; it may already have a video or active job');
    const { article_id: articleId, job_id: jobId, claim_token: claimToken } = rows[0];
    console.log(`article_id=${articleId}`);
    console.log(`video_job_id=${jobId}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${claimToken}`);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `article_id=${articleId}\nvideo_job_id=${jobId}\nclaim_token=${claimToken}\n`,
        { mode: 0o600 });
    }
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
