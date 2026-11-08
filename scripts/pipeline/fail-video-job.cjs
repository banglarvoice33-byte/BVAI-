const { Client } = require('pg');
(async () => {
  if (!process.env.SUPABASE_DB_URL || !process.env.VIDEO_JOB_ID) process.exit(0);
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    await client.query(
      "UPDATE public.video_generation_jobs SET status='failed',error_message=$2,updated_at=now() WHERE id=$1 AND status='processing'",
      [process.env.VIDEO_JOB_ID, (process.env.FAILURE_REASON || 'GitHub Actions render/upload failed').slice(0,1000)]
    );
  } finally { await client.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
