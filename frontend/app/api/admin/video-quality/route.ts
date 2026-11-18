import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {editorialContext,EditorialAuthError} from '@/lib/server/editorial-context';
import { assertBoundReview } from '@/lib/video-review.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  // Same-origin cookie session or verified native Admin/Studio bearer JWT. No key from the request body is accepted.
  if (Number(request.headers.get('content-length') || 0) > 262144) return reply({ error: 'review_too_large' }, 413);
  try {
    const {actor,session} = await editorialContext(request);
    const text = await request.text();
    if (text.length > 262144) return reply({ error: 'review_too_large' }, 413);
    const body = JSON.parse(text);
    if (!UUID.test(body.job_id || '') || !body.review || typeof body.review !== 'object') return reply({ error: 'invalid_review' }, 400);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!key || !url) return reply({ error: 'review_unconfigured' }, 503);
    const admin = createAdminClient(url, key, { auth: { persistSession: false } });
    const { data: job, error: jobError } = await admin.from('video_generation_jobs').select('id,render_path,status').eq('id', body.job_id).single();
    const { data: asset, error: assetError } = await admin.from('video_delivery_assets').select('sha256,manifest').eq('job_id', body.job_id).single();
    if (jobError || assetError || !job || !asset || !['needs_review', 'completed'].includes(job.status)) return reply({ error: 'review_asset_unavailable' }, 409);
    const script = asset.manifest?.production_plan?.spoken_script;
    if (typeof script !== 'string' || !script || !(asset.manifest?.size_bytes > 0 && asset.manifest.size_bytes <= 100 * 1024 * 1024)) return reply({ error: 'new_review_manifest_required' }, 409);
    const { data: bytes, error: downloadError } = await admin.storage.from('reels').download(job.render_path);
    if (downloadError || !bytes || bytes.size !== asset.manifest.size_bytes) return reply({ error: 'stored_asset_unavailable' }, 409);
    const review = { ...body.review, reviewer_id: actor.id, reviewed_at: new Date().toISOString() };
    assertBoundReview(review, new Uint8Array(await bytes.arrayBuffer()), script);
    if (review.video_sha256 !== asset.sha256 || review.script_sha256 !== asset.manifest.spoken_script_hash) return reply({ error: 'asset_binding_changed' }, 409);
    // User JWT, not the service-role client: the database records auth.uid() and checks the editor role again.
    const { error } = await session.rpc('record_video_quality_review', { p_job_id: job.id, p_review: review });
    if (error) return reply({ error: 'review_recording_failed_check_migration_and_role' }, 409);
    return reply({ ok: true, job_id: job.id, status: 'quality_approved_not_published' });
  } catch (error) {
    if(error instanceof EditorialAuthError)return reply({error:error.message},error.status);
    return reply({ error: 'review_invalid_or_unavailable_check_claims_qc_and_asset_hashes' }, 400);
  }
}
