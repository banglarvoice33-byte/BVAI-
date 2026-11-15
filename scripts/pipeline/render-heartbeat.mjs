// One heartbeat in flight per render; an expired/revoked lease is never silently ignored.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRenderHeartbeat(db, claim, { intervalMs = 45000, timeoutMs = 15000 } = {}) {
  if (![claim?.job_id, claim?.article_id, claim?.claim_token].every((value) => typeof value === 'string' && UUID.test(value))) throw new Error('Invalid render claim UUIDs');
  if (!Number.isFinite(intervalMs) || intervalMs < 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid heartbeat timing');
  const controller = new AbortController();
  let timer; let inFlight; let failure; let stopped = false;
  const renew = () => {
    if (failure) return Promise.reject(failure);
    if (stopped) return Promise.reject(new Error('Render heartbeat stopped'));
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let deadline;
      try {
        // Timeout the actual network request as well as awaiting it. Test doubles may be plain promises.
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
        let request = db.rpc('heartbeat_reviewed_render', { p_job_id: claim.job_id, p_claim_token: claim.claim_token });
        if (typeof request.abortSignal === 'function') request = request.abortSignal(signal);
        const timeout = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Heartbeat timeout')), timeoutMs); });
        const result = await Promise.race([request, timeout]);
        if (result?.error || result?.data !== true) throw new Error('Render claim not renewed');
      } catch {
        // Do not log raw provider responses, credentials, or the fencing token.
        failure = Object.assign(new Error('Render lease heartbeat failed or lease lost; verify heartbeat migration and database connectivity'), { code: 'RENDER_LEASE_LOST' });
        controller.abort(failure);
        throw failure;
      } finally { clearTimeout(deadline); }
    })();
    // Attach both handlers synchronously so timer-triggered failures cannot become unhandled rejections.
    inFlight.then(() => { inFlight = undefined; }, () => { inFlight = undefined; });
    return inFlight;
  };
  return {
    renew,
    signal: controller.signal,
    start() {
      if (stopped || timer) return;
      timer = setInterval(() => { void renew().catch(() => {}); }, intervalMs);
      timer.unref();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      // Settle an already-running bounded request before releasing job resources.
      if (inFlight) await inFlight.catch(() => {});
    },
  };
}
