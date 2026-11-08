const { Client } = require('pg');

async function main() {
  const db = process.env.SUPABASE_DB_URL;
  const jobId = process.env.VIDEO_JOB_ID;
  const claimToken = process.env.VIDEO_CLAIM_TOKEN;
  if (!db || !jobId || !claimToken) {
    throw new Error('SUPABASE_DB_URL, VIDEO_JOB_ID and VIDEO_CLAIM_TOKEN are required to mark the job failed');
  }
  const client = new Client({ connectionString: db, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT public.fail_video_generation_job($1::uuid, $2::uuid, $3::text) AS updated',
      [jobId, claimToken, (process.env.FAILURE_REASON || 'GitHub Actions render/upload failed').slice(0, 1000)]
    );
    if (!rows[0]?.updated) {
      console.error('Failure handler did not update the job; it may already be finalized or its claim has changed');
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
