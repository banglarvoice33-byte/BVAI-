import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', '..', 'temp_assets');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function upload() {
  const manifestPath = path.join(TMP, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('ℹ️  No manifest — nothing to upload.');
    return;
  }
  let m;
  try {
    m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error('Manifest corrupt: ' + e.message);
  }
  if (!m.article_id || !m.video_path) throw new Error('Manifest missing article_id/video_path');
  if (!fs.existsSync(m.video_path)) throw new Error('Video file missing: ' + m.video_path);

  console.log('📤 Uploading for article ' + m.article_id + '...');
  const buf = fs.readFileSync(m.video_path);
  const storagePath = m.article_id + '/' + Date.now() + '.mp4';

  const { error: upErr } = await supabase.storage
    .from('videos')
    .upload(storagePath, buf, { contentType: 'video/mp4', upsert: false });
  if (upErr) throw new Error('Storage upload: ' + upErr.message);

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;
  console.log('✅ URL: ' + publicUrl);

  const { error: insErr } = await supabase.from('videos').insert({
    article_id: m.article_id,
    video_url: publicUrl,
    duration_seconds: Math.round(m.audio_duration || 0),
    platform_posted: {},
  });
  if (insErr) throw new Error('videos insert: ' + insErr.message);
  console.log('✅ videos row inserted');

  const { error: updErr } = await supabase.from('articles')
    .update({ video_generated: true, updated_at: new Date().toISOString() })
    .eq('id', m.article_id);
  if (updErr) throw new Error('articles update: ' + updErr.message);
  console.log('✅ article marked video_generated=true');
}

upload().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
