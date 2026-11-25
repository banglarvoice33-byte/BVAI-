import 'server-only';
import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { callAiGateway } from '../../../lib/ai-gateway';

export async function POST(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let body: { question?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 1200) {
    return NextResponse.json({ error: 'invalid_length' }, { status: 413 });
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 });

  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const quota = await service.rpc('consume_learning_hub_question', { p_user_id: user.id }).abortSignal(AbortSignal.timeout(5000));
  if (quota.error) return NextResponse.json({ error: 'quota_unavailable', remaining: 0 }, { status: 503 });
  const remaining = typeof quota.data === 'number' ? quota.data : -1;
  if (remaining < 0) {
    return NextResponse.json({ error: 'limit', remaining: 0 }, { status: 429, headers: { 'cache-control': 'private, no-store' } });
  }
  const headers = { 'cache-control': 'private, no-store' };
  if (/^(hi|hello|hey|সালাম|আসসালাম)/i.test(question)) {
    return NextResponse.json({ answer: 'ওয়ালাইকুম আসসালাম। বাংলার ভয়েসের প্রকাশিত সংবাদ নিয়ে প্রশ্ন করুন।', remaining, intent: 'greeting', sources: [] }, { status: 200, headers });
  }
  const out = await callAiGateway({
    task: 'learning-hub',
    messages: [{ role: 'user', content: question }],
  });
  return NextResponse.json({ answer: out?.answer || '', remaining, sources: [] }, { status: 200, headers });
}
