/**
 * Completion-based polling: never overlap requests or let stale work update an unmounted owner.
 * The task must pass its signal to fetch and check signal.aborted before committing state.
 */
export function startPolling(
  task: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  timeoutMs = 15_000,
): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Polling intervals must be positive finite numbers');
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const tick = async () => {
    if (stopped) return;
    const request = new AbortController();
    controller = request;
    const deadline = setTimeout(() => request.abort(), timeoutMs);
    try {
      await task(request.signal);
    } catch {
      // A transient failure must not blank already-rendered content or stop later refreshes.
    } finally {
      clearTimeout(deadline);
      if (controller === request) controller = undefined;
      if (!stopped) timer = setTimeout(() => { void tick(); }, intervalMs);
    }
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
