import 'server-only';
import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '../../../lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { callAiGateway } from '../../../lib/ai-gateway';

async function callRpc(service: any, name: string, params: any) {
  const first = service.rpc(name, params);
  if (first && typeof first.abortSignal === 'function') {
    return first.abortSignal(AbortSignal.timeout(5000));
  }
  return first;
}

export async function POST(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let body: { question?: unknown; locale?: unknown; history?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const locale = body.locale === 'en' ? 'en' : 'bn';
  if (!question || question.length > 1200) {
    return NextResponse.json({ error: 'invalid_length' }, { status: 413 });
  }

  // Conversation history: at most 9 prior user turns + this question = 10 user questions per session.
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 600) }))
    .slice(-18);
  const priorUserTurns = history.filter((m) => m.role === 'user').length;
  if (priorUserTurns >= 10) {
    return NextResponse.json(
      { error: 'session_limit', remaining: 0, answer: '' },
      { status: 429, headers: { 'cache-control': 'private, no-store' } },
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  );

  let user: { id: string } | null = null;
  let serverChecked = false;
  try {
    const server = await createServerClient();
    const res = await server.auth.getUser();
    serverChecked = true;
    user = res?.data?.user || null;
  } catch { serverChecked = false; }
  if (serverChecked && !user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  let remaining = 0;
  if (user) {
    const quota: any = await callRpc(service, 'consume_learning_hub_question', { p_user_id: user.id });
    if (quota?.error) return NextResponse.json({ error: 'quota_unavailable', remaining: 0 }, { status: 503 });
    if (typeof quota?.data === 'number') {
      remaining = quota.data;
      if (remaining < 0) {
        return NextResponse.json({ error: 'limit', remaining: 0 }, { status: 429, headers: { 'cache-control': 'private, no-store' } });
      }
    }
  }

  const headers = { 'cache-control': 'private, no-store' };
  if (/^(hi|hello|hey|সালাম|আসসালাম)/i.test(question)) {
    return NextResponse.json({ answer: 'ওয়ালাইকুম আসসালাম। বাংলার ভয়েসের প্রকাশিত সংবাদ নিয়ে প্রশ্ন করুন।', remaining, intent: 'greeting', sources: [] }, { status: 200, headers });
  }

  let embeddingText: string | undefined;
  try {
    const endpoint = process.env.NEWS_EMBEDDING_ENDPOINT || '';
    if (endpoint) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.NEWS_EMBEDDING_API_KEY || ''}` },
        body: JSON.stringify({ input: question, model: process.env.NEWS_EMBEDDING_MODEL || '' }),
      });
      const data: any = await res.json();
      const embedding = data?.data?.[0]?.embedding || data?.embedding;
      if (Array.isArray(embedding)) embeddingText = JSON.stringify(embedding);
    }
  } catch { embeddingText = undefined; }

  let rows: any[] = [];
  try {
    const hybrid: any = await callRpc(service, 'hybrid_search_articles', {
      p_query: question,
      p_query_embedding: embeddingText || '[0]',
      p_match_count: 5,
    });
    if (Array.isArray(hybrid?.data)) rows = hybrid.data;
  } catch { rows = []; }

  let contents: any[] = [];
  try {
    const ids = rows.map((r: any) => r.id).filter(Boolean);
    if (ids.length && typeof (service as any).from === 'function') {
      const res: any = await (service as any).from('articles').select('id,content_bn,content_en,excerpt_bn,excerpt_en').in('id', ids);
      if (Array.isArray(res?.data)) contents = res.data;
    }
  } catch { contents = []; }

  const sources = rows.slice(0, 5).map((r: any) => {
    const c = contents.find((x: any) => x.id === r.id) || {};
    const title = locale === 'en' ? (r.title_en || r.title || '') : (r.title_bn || r.title || '');
    const snippet = locale === 'en' ? (c.content_en || c.excerpt_en || '') : (c.content_bn || c.excerpt_bn || '');
    const url = r.slug ? `/article/${r.slug}` : (r.url || '');
    return { title: String(title), snippet: String(snippet), url: String(url) };
  }).filter((s) => s.title);

  const systemPrompt = [
    'You are বাংলার ভয়েস AI news assistant.',
    'Answer ONLY from the published sources below. If sources are insufficient, say so in the user locale.',
    'Do not invent facts, quotes, scores, or casualty numbers.',
    `Locale: ${locale}.`,
    'Sources:',
    sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${(s.snippet || '').slice(0, 400)}`).join('\n') || '(none)',
  ].join('\n');
  const out = await callAiGateway({
    task: 'learning-hub',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ],
  });
  return NextResponse.json({ answer: out?.answer || '', remaining, sources }, { status: 200, headers });
}
