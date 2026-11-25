import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json({ limit: '256kb' }));

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) throw new Error('ADMIN_TOKEN missing');

const auth = (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
};

app.get('/health', (_req, res) => res.json({ ok: true, service: 'bvai-api' }));

app.post('/dispatch', auth, async (req, res) => {
  const { article_id, payload = {} } = req.body || {};
  if (!article_id) return res.status(400).json({ error: 'article_id required' });
  const { data, error } = await db
    .from('agnes_video_jobs')
    .insert({ article_id, payload, status: 'queued' })
    .select('id,status').single();
  if (error) return res.status(500).json({ error: 'enqueue_failed' });
  res.json({ job_id: data.id, status: data.status });
});

app.get('/jobs/:id', auth, async (req, res) => {
  const { data, error } = await db
    .from('agnes_video_jobs')
    .select('id,status,manifest,error_message,video_sha256')
    .eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'not_found' });
  res.json(data);
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`bvai-api listening on ${port}`));
