// Offline checks for the caption plumbing: secrets never reach a job row/annotation, and the vault hydrate loads the
// video key even when a (possibly stale) GitHub secret already set GROQ_API_KEY.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, captionKeysPresent } from '../voice-captions.js';
import { loadVaultEnv } from '../load-vault-env.mjs';

test('scrubSecrets removes Groq/OpenAI keys and bearer tokens and bounds the length', () => {
  const text = 'Groq HTTP 401: Authorization: Bearer abc.def-123 gsk_ABCDEFGH12345678 sk-proj-ABCDEFGH12345678\n  more';
  const out = scrubSecrets(text, 200);
  assert.ok(!/gsk_ABCDEFGH|sk-proj-ABCDEFGH|abc\.def-123/.test(out), out);
  assert.ok(!out.includes('\n'));
  assert.equal(scrubSecrets('x'.repeat(500), 150).length, 150);
  assert.equal(scrubSecrets(undefined), '');
});

test('captionKeysPresent accepts any of the three key variables', () => {
  assert.equal(captionKeysPresent({}), false);
  assert.equal(captionKeysPresent({ GROQ_API_KEY: 'a' }), true);
  assert.equal(captionKeysPresent({ GROQ_API_KEY_VAULT: 'a' }), true);
  assert.equal(captionKeysPresent({ CAPTION_OPENAI_API_KEY: 'a' }), true);
});

function fakeClient(secrets) {
  return () => ({
    from: () => {
      const filters = {};
      const q = { select: () => q, eq: (k, v) => { filters[k] = v; return q; },
        maybeSingle: async () => (secrets[filters.service_name] ? { data: { key_encrypted: `ref:${filters.service_name}` }, error: null } : { data: null, error: null }) };
      return q;
    },
    rpc: async (_name, { p_secret_id }) => ({ data: secrets[p_secret_id.replace('ref:', '')] ?? null, error: null }),
  });
}

test('vault hydrate loads GROQ_API_KEY_VAULT / CAPTION_OPENAI_API_KEY even when GROQ_API_KEY is already set', async () => {
  const saved = { ...process.env };
  try {
    for (const k of ['GROQ_API_KEY_VAULT', 'CAPTION_OPENAI_API_KEY']) delete process.env[k];
    Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-role-test-value', GROQ_API_KEY: 'github-secret-value' });
    const result = await loadVaultEnv(['GROQ_API_KEY'], { makeClient: fakeClient({ GROQ_API_KEY: 'vault-groq-value-123', OPENAI_API_KEY: 'vault-openai-value-123' }) });
    assert.equal(process.env.GROQ_API_KEY, 'github-secret-value', 'explicit env must still win for the plain name');
    assert.equal(process.env.GROQ_API_KEY_VAULT, 'vault-groq-value-123');
    assert.equal(process.env.CAPTION_OPENAI_API_KEY, 'vault-openai-value-123');
    assert.deepEqual(result.loaded.sort(), ['CAPTION_OPENAI_API_KEY', 'GROQ_API_KEY_VAULT']);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
