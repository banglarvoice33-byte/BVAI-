// Offline proof for the Groq Whisper caption client: a mock loopback API mimics Cloudflare (403 for the default
// Python-urllib agent, 403 for a model the key cannot use) and checks the key never leaks into error text.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../whisper-caption.py');
const KEY = 'gsk_TESTKEYTESTKEYTESTKEYTESTKEYTESTKEYTESTKEYTESTKEY12';
let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); } catch { hasFfmpeg = false; }

function startApi(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const model = /name="model"\r\n\r\n([^\r]+)/.exec(body)?.[1];
      // The body is read as latin1, so the captured prompt's length is its UTF-8 byte length (what Groq measures).
      const promptBytes = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--BVAI/.exec(body)?.[1]?.length ?? null;
      seen.push({ ua: req.headers['user-agent'], model, auth: req.headers.authorization, promptBytes });
      handler(req, res, { model, ua: req.headers['user-agent'], promptBytes });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

const words = Array.from({ length: 8 }, (_, i) => ({ word: ['দেশের', 'সর্বশেষ', 'সংবাদ', 'বিস্তারিত', 'জানতে', 'বাংলার', 'ভয়েস', 'দেখুন'][i], start: i * 0.5, end: i * 0.5 + 0.45 }));
const ok = (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: words.map((w) => w.word).join(' '), words })); };

function runPython(base, dir, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, GROQ_API_KEY: KEY, GROQ_API_BASE: base, OPENAI_API_BASE: base, ...extraEnv };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const child = spawn('python3', ['-I', script, path.join(dir, 'a.mp3'), path.join(dir, 'out.vtt'), '--script-file', path.join(dir, 's.txt')], { env });
    let stderr = ''; let stdout = '';
    child.stderr.on('data', (d) => { stderr += d; }); child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}
function fixture(scriptText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-test-'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4.2', '-c:a', 'libmp3lame', path.join(dir, 'a.mp3')]);
  fs.writeFileSync(path.join(dir, 's.txt'), scriptText ?? words.map((w) => w.word).join(' '), 'utf8');
  return dir;
}

test('sends a descriptive User-Agent (Cloudflare blocks the urllib default)', { skip: !hasFfmpeg }, async () => {
  const api = await startApi((req, res, { ua }) => (/^Python-urllib/i.test(ua || '') || !ua ? (res.writeHead(403), res.end('error code: 1010')) : ok(res)));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(api.seen[0].ua, /^BVAI-Renderer\//);
    assert.match(fs.readFileSync(path.join(dir, 'out.vtt'), 'utf8'), /^WEBVTT/);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('falls back to whisper-large-v3 when the turbo model is forbidden', { skip: !hasFfmpeg }, async () => {
  const api = await startApi((req, res, { model }) => (model === 'whisper-large-v3-turbo' ? (res.writeHead(403), res.end('{"error":{"message":"model access"}}')) : ok(res)));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.seen.map((s) => s.model), ['whisper-large-v3-turbo', 'whisper-large-v3']);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('surfaces the API error body but never the key; stops on 401', { skip: !hasFfmpeg }, async () => {
  const api = await startApi((req, res) => { res.writeHead(401); res.end(`invalid key ${KEY}`); });
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Groq HTTP 401/);
    assert.match(result.stderr, /invalid key/);
    assert.ok(!result.stderr.includes(KEY) && !result.stderr.includes('gsk_TESTKEY'));
    assert.equal(api.seen.length, 1, '401 must not retry another model');
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ignores a non-loopback GROQ_API_BASE / OPENAI_API_BASE so a key cannot be redirected', () => {
  const source = fs.readFileSync(script, 'utf8');
  assert.match(source, /startswith\(\('http:\/\/127\.0\.0\.1:', 'http:\/\/localhost:'\)\)/);
  assert.match(source, /'https:\/\/api\.groq\.com\/openai\/v1'/);
  assert.match(source, /'https:\/\/api\.openai\.com\/v1'/);
});

const VAULT_KEY = 'gsk_VAULTKEYVAULTKEYVAULTKEYVAULTKEYVAULTKEYVAULTKEY99';
const OPENAI_KEY = 'sk-proj-OPENAIKEYOPENAIKEYOPENAIKEYOPENAIKEY1234567890';
const byKey = (handlers) => (req, res, ctx) => {
  const key = (req.headers.authorization || '').replace('Bearer ', '');
  return (handlers[key] || ((_, r) => { r.writeHead(500); r.end('unexpected key'); }))(req, res, ctx);
};
const reject401 = (_req, res) => { res.writeHead(401); res.end('{"error":{"message":"Invalid API Key"}}'); };

test('a stale primary key falls through to the vault Groq key', { skip: !hasFfmpeg }, async () => {
  const api = await startApi(byKey({ [KEY]: reject401, [VAULT_KEY]: (_q, r) => ok(r) }));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir, { GROQ_API_KEY_VAULT: VAULT_KEY });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.seen.map((s) => s.auth), [`Bearer ${KEY}`, `Bearer ${VAULT_KEY}`]);
    assert.match(result.stdout, /Groq-vault/);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('uses OpenAI whisper-1 when every Groq key fails', { skip: !hasFfmpeg }, async () => {
  const api = await startApi(byKey({ [KEY]: reject401, [OPENAI_KEY]: (_q, r) => ok(r) }));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir, { CAPTION_OPENAI_API_KEY: OPENAI_KEY });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.seen.map((s) => s.model), ['whisper-large-v3-turbo', 'whisper-1']);
    assert.match(result.stdout, /OpenAI/);
    assert.match(fs.readFileSync(path.join(dir, 'out.vtt'), 'utf8'), /^WEBVTT/);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('works with only the OpenAI key (no Groq key at all)', { skip: !hasFfmpeg }, async () => {
  const api = await startApi(byKey({ [OPENAI_KEY]: (_q, r) => ok(r) }));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir, { GROQ_API_KEY: undefined, CAPTION_OPENAI_API_KEY: OPENAI_KEY });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.seen.map((s) => s.model), ['whisper-1']);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('when all providers fail, every cause is reported and no key leaks', { skip: !hasFfmpeg }, async () => {
  const api = await startApi((req, res) => { res.writeHead(401); res.end(`bad key ${(req.headers.authorization || '').slice(7)}`); });
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir, { GROQ_API_KEY_VAULT: VAULT_KEY, CAPTION_OPENAI_API_KEY: OPENAI_KEY });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Groq HTTP 401/);
    assert.match(result.stderr, /Groq-vault HTTP 401/);
    assert.match(result.stderr, /OpenAI HTTP 401/);
    for (const secret of [KEY, VAULT_KEY, OPENAI_KEY, 'gsk_TESTKEY', 'gsk_VAULT', 'sk-proj-OPENAI']) assert.ok(!result.stderr.includes(secret), `leaked ${secret.slice(0, 8)}`);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('without any key the error says so', { skip: !hasFfmpeg }, async () => {
  const dir = fixture();
  try {
    const result = await runPython('http://127.0.0.1:1', dir, { GROQ_API_KEY: undefined });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /no caption API key/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Groq's real rule (observed in production): HTTP 400 when the prompt is over 896 characters, counted in UTF-8 bytes.
const groqPromptRule = (limit = 896) => (req, res, { promptBytes }) => (promptBytes !== null && promptBytes > limit
  ? (res.writeHead(400, { 'content-type': 'application/json' }), res.end(JSON.stringify({ error: { message: `prompt length must be ${limit} characters or fewer, but provided prompt contains ${promptBytes} character(s)`, type: 'invalid_request_error' } })))
  : ok(res));
const longBengaliScript = Array.from({ length: 120 }, (_, i) => words[i % words.length].word).join(' ') + ' ' + 'সংবাদ '.repeat(80); // > 1200 chars, ~3 bytes each

test('a long Bengali script is fitted under Groq\'s byte limit instead of failing with HTTP 400', { skip: !hasFfmpeg }, async () => {
  const api = await startApi(groqPromptRule());
  const dir = fixture(longBengaliScript);
  try {
    assert.ok(Buffer.byteLength(longBengaliScript) > 2400, 'fixture must exceed the limit by a wide margin');
    const result = await runPython(api.base, dir, { CAPTION_MIN_SCRIPT_MATCH: '0' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(api.seen.length, 1, 'no retry needed');
    assert.ok(api.seen[0].promptBytes > 0 && api.seen[0].promptBytes <= 800, `prompt was ${api.seen[0].promptBytes} bytes`);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('if a provider still rejects the prompt, captions are retried without it', { skip: !hasFfmpeg }, async () => {
  const api = await startApi((req, res, { promptBytes }) => (promptBytes !== null
    ? (res.writeHead(400), res.end('{"error":{"message":"prompt is not accepted here"}}')) : ok(res)));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.seen.map((x) => x.promptBytes !== null), [true, false]);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a non-auth failure (400) does not retry another key of the same API but still reaches OpenAI', { skip: !hasFfmpeg }, async () => {
  const api = await startApi(byKey({
    [KEY]: (_q, r) => { r.writeHead(400); r.end('{"error":{"message":"could not process audio"}}'); },
    [VAULT_KEY]: (_q, r) => { r.writeHead(500); r.end('vault key must not be tried'); },
    [OPENAI_KEY]: (_q, r) => ok(r),
  }));
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir, { GROQ_API_KEY_VAULT: VAULT_KEY, CAPTION_OPENAI_API_KEY: OPENAI_KEY });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(api.seen.map((x) => x.auth), [`Bearer ${KEY}`, `Bearer ${OPENAI_KEY}`]);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the failure text stays short and readable (fits the 300-char job error with 3 providers)', { skip: !hasFfmpeg }, async () => {
  const api = await startApi((req, res) => { res.writeHead(401); res.end('{"error":{"message":"Invalid API Key provided and it is long enough to need trimming for the stored job error text"}}'); });
  const dir = fixture();
  try {
    const result = await runPython(api.base, dir, { GROQ_API_KEY_VAULT: VAULT_KEY, CAPTION_OPENAI_API_KEY: OPENAI_KEY });
    const line = result.stderr.replace(/^Caption failed:\s*/, '').trim();
    assert.ok(line.length <= 3 * 95 + 6, `message was ${line.length} chars`);
    assert.match(line, /Invalid API Key/);
  } finally { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
