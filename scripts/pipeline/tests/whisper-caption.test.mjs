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
      seen.push({ ua: req.headers['user-agent'], model, auth: req.headers.authorization });
      handler(req, res, { model, ua: req.headers['user-agent'] });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

const words = Array.from({ length: 8 }, (_, i) => ({ word: ['দেশের', 'সর্বশেষ', 'সংবাদ', 'বিস্তারিত', 'জানতে', 'বাংলার', 'ভয়েস', 'দেখুন'][i], start: i * 0.5, end: i * 0.5 + 0.45 }));
const ok = (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: words.map((w) => w.word).join(' '), words })); };

function runPython(base, dir) {
  return new Promise((resolve) => {
    const child = spawn('python3', ['-I', script, path.join(dir, 'a.mp3'), path.join(dir, 'out.vtt'), '--script-file', path.join(dir, 's.txt')],
      { env: { ...process.env, GROQ_API_KEY: KEY, GROQ_API_BASE: base } });
    let stderr = ''; let stdout = '';
    child.stderr.on('data', (d) => { stderr += d; }); child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-test-'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4.2', '-c:a', 'libmp3lame', path.join(dir, 'a.mp3')]);
  fs.writeFileSync(path.join(dir, 's.txt'), words.map((w) => w.word).join(' '), 'utf8');
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

test('ignores a non-loopback GROQ_API_BASE so the key cannot be redirected', () => {
  const source = fs.readFileSync(script, 'utf8');
  assert.match(source, /startswith\(\('http:\/\/127\.0\.0\.1:', 'http:\/\/localhost:'\)\)/);
  assert.match(source, /base = 'https:\/\/api\.groq\.com\/openai\/v1'/);
});
