/**
 * Agnes render worker control plane (ops/worker).
 * Uses service_role Supabase client against public.agnes_video_jobs / events / delivery_outbox.
 * claim_agnes_job is the only DB RPC required; heartbeats/finalize/fail are table updates.
 */
import crypto from 'node:crypto';

/** @param {import('@supabase/supabase-js').SupabaseClient} db */
export async function claimJob(db, workerId, leaseSeconds = 900) {
  const { data, error } = await db.rpc('claim_agnes_job', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim_agnes_job: ${error.message}`);
  // PostgREST may return object or null when no row claimed
  if (!data || (Array.isArray(data) && !data.length)) return null;
  const job = Array.isArray(data) ? data[0] : data;
  if (!job?.id) return null;
  // Move claimed → running so leases and UI reflect active work
  await db
    .from('agnes_video_jobs')
    .update({
      status: 'running',
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('worker_id', workerId);
  return { ...job, status: 'running' };
}

/** @param {import('@supabase/supabase-js').SupabaseClient} db */
export async function heartbeat(db, jobId, workerId, leaseSeconds = 900) {
  const { error } = await db
    .from('agnes_video_jobs')
    .update({
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('worker_id', workerId)
    .in('status', ['claimed', 'running']);
  if (error) throw new Error(`heartbeat: ${error.message}`);
}

/**
 * Mark render complete. Default status needs_review (human gate).
 * When VIDEO_PUBLISH_MODE=distribute and platforms include youtube, enqueue delivery_outbox.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} jobId
 * @param {string} workerId
 * @param {{ video_sha256: string, manifest?: object, storage_path?: string, status?: string }} result
 */
export async function finalizeJob(db, jobId, workerId, result = {}) {
  const status = result.status || 'needs_review';
  const patch = {
    status,
    video_sha256: result.video_sha256 || null,
    manifest: result.manifest || null,
    finished_at: new Date().toISOString(),
    lease_expires_at: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  };
  if (result.storage_path) {
    patch.manifest = {
      ...(result.manifest || {}),
      storage_path: result.storage_path,
    };
  }
  const { data: job, error } = await db
    .from('agnes_video_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('worker_id', workerId)
    .select('*')
    .single();
  if (error) throw new Error(`finalizeJob: ${error.message}`);

  // Durable outbox for YouTube when distribute mode is enabled
  const mode = String(process.env.VIDEO_PUBLISH_MODE || '').trim();
  const platforms = String(process.env.VIDEO_DELIVERY_PLATFORMS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const channelId = process.env.YOUTUBE_CHANNEL_ID || '';
  if (
    mode === 'distribute' &&
    platforms.includes('youtube') &&
    channelId &&
    result.video_sha256
  ) {
    const { error: outboxError } = await db.from('delivery_outbox').insert({
      job_id: jobId,
      platform: 'youtube',
      account_id: channelId,
      status: 'pending',
      attempt_count: 0,
    });
    if (outboxError) {
      console.error('delivery_outbox_enqueue_failed', outboxError.message);
      await logEvent(db, jobId, 'outbox_enqueue_failed', { message: outboxError.message });
    } else {
      await logEvent(db, jobId, 'outbox_enqueued', { platform: 'youtube', account_id: channelId });
      await db
        .from('agnes_video_jobs')
        .update({ status: 'delivering', updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }
  }
  return job;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} db */
export async function failJob(db, jobId, workerId, message) {
  const { error } = await db
    .from('agnes_video_jobs')
    .update({
      status: 'failed',
      error_message: String(message || 'unknown').slice(0, 2000),
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('worker_id', workerId);
  if (error) throw new Error(`failJob: ${error.message}`);
}

/** @param {import('@supabase/supabase-js').SupabaseClient} db */
export async function logEvent(db, jobId, eventType, payload = {}) {
  const { error } = await db.from('agnes_job_events').insert({
    job_id: jobId,
    event_type: eventType,
    payload: payload && typeof payload === 'object' ? payload : { value: payload },
  });
  if (error) console.error('agnes_job_events', error.message);
}

/** Stable content hash helper for scripts */
export function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}
