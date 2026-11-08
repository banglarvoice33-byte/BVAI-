const { Client } = require('pg');

async function main() {
  const db = process.env.SUPABASE_DB_URL;
  if (!db) throw new Error('SUPABASE_DB_URL is required');
  const client = new Client({ connectionString: db, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    const requested = (process.env.ARTICLE_ID || '').trim();
    const articleQuery = requested
      ? { text: "SELECT id FROM public.articles WHERE id=$1 AND status='published' AND length(content_bn)>200", values: [requested] }
      : { text: "SELECT a.id FROM public.articles a WHERE a.status='published' AND length(a.content_bn)>200 AND NOT EXISTS (SELECT 1 FROM public.videos v WHERE v.article_id=a.id) AND NOT EXISTS (SELECT 1 FROM public.video_generation_jobs j WHERE j.article_id=a.id AND j.status IN ('queued','processing','needs_review')) ORDER BY a.published_at DESC NULLS LAST LIMIT 1", values: [] };
    const { rows } = await client.query(articleQuery);
    if (!rows.length) throw new Error('No eligible published article is available for video generation');
    const articleId = rows[0].id;
    const existing = await client.query(
      "SELECT id FROM public.video_generation_jobs WHERE article_id=$1 AND status IN ('queued','processing','needs_review') ORDER BY created_at DESC LIMIT 1",
      [articleId]
    );
    let jobId;
    if (existing.rows.length) {
      jobId = existing.rows[0].id;
      await client.query("UPDATE public.video_generation_jobs SET status='processing',attempt_count=attempt_count+1,updated_at=now() WHERE id=$1", [jobId]);
    } else {
      const inserted = await client.query(
        "INSERT INTO public.video_generation_jobs(article_id,status,attempt_count) VALUES($1,'processing',1) RETURNING id",
        [articleId]
      );
      jobId = inserted.rows[0].id;
    }
    console.log(`article_id=${articleId}`);
    console.log(`video_job_id=${jobId}`);
    if (process.env.GITHUB_OUTPUT) {
      const fs = require('fs');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `article_id=${articleId}\nvideo_job_id=${jobId}\n`);
    }
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exit(1); });
