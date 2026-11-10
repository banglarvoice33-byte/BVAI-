/**
 * Load active prod secrets from public.api_vault into process.env when missing.
 * Service-role only. Never logs secret values.
 * Keys already set in the environment (GitHub Actions / local .env) win.
 */
import { createClient } from '@supabase/supabase-js';

const DEFAULT_KEYS = [
  'GROQ_API_KEY',
  'PIXABAY_API_KEY',
  'VIDEO_RECOVERY_KEY',
  'TTS_SARVAM_1', 'TTS_SARVAM_2', 'TTS_SARVAM_3',
  'TTS_SONEXLABS_1', 'TTS_SONEXLABS_2', 'TTS_SONEXLABS_3',
  'TTS_CARTESIA_1', 'TTS_CARTESIA_2',
  'TTS_ELEVENLABS_1', 'TTS_ELEVENLABS_2', 'TTS_ELEVENLABS_3', 'TTS_ELEVENLABS_4', 'TTS_ELEVENLABS_5',
  'CARTESIA_VOICE_ID', 'ELEVENLABS_VOICE_ID',
  'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN',
  'SOCIAL_FACEBOOK_PAGE_TOKEN', 'SOCIAL_INSTAGRAM_ACCESS_TOKEN',
  'TIKTOK_ACCESS_TOKEN', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
  'NEWSROOM_INGEST_KEY',
];

export async function loadVaultEnv(keys = DEFAULT_KEYS) {
  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    console.warn('[vault] SUPABASE_URL/SERVICE_ROLE_KEY missing; skip vault hydrate');
    return { loaded: [], skipped: keys.slice() };
  }
  const need = keys.filter((k) => !process.env[k]);
  if (!need.length) {
    console.log('[vault] all requested keys already present in env');
    return { loaded: [], skipped: [] };
  }
  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const loaded = [];
  const missing = [];
  for (const name of need) {
    try {
      const { data: row, error } = await db
        .from('api_vault')
        .select('key_encrypted')
        .eq('service_name', name)
        .eq('environment', 'prod')
        .eq('is_active', true)
        .maybeSingle();
      if (error || !row?.key_encrypted) {
        missing.push(name);
        continue;
      }
      const { data: plain, error: decErr } = await db.rpc('decrypt_vault_secret', {
        p_secret_id: row.key_encrypted,
      });
      if (decErr || typeof plain !== 'string' || !plain) {
        missing.push(name);
        continue;
      }
      process.env[name] = plain;
      loaded.push(name);
    } catch {
      missing.push(name);
    }
  }
  console.log(`[vault] hydrated ${loaded.length} keys` + (missing.length ? `; still missing: ${missing.join(',')}` : ''));
  return { loaded, skipped: missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadVaultEnv().then(() => process.exit(0)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
