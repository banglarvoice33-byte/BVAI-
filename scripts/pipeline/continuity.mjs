// Content failures are isolated. Infrastructure/lease/auth failures stop this run.
// This is bounded per invocation; durable scheduling remains owned by the existing DB queue.
export function failureAction(error, { requested = false } = {}) {
  if (requested) return 'stop';
  if (error?.code === 'RENDER_LEASE_LOST') return 'stop';
  const message = String(error?.message || '');
  if (/401|403|429|credentials|API key|All TTS providers|No TTS provider|caption API key|network|fetch failed|ENOSPC|ENOENT|lease|claim_mismatch|Story reservation:/i.test(message)) return 'stop';
  if (error?.code === 'QUALITY_REPAIR_EXHAUSTED') return 'next_story';
  if (error?.skip || /article_too_short|narration_too_long|duplicate_story_or_script|article_missing_bengali|Invalid calendar date|Invalid digit grouping|Unsupported or unsafe integer|Script\/transcript agreement|production_plan_content/i.test(message)) return 'next_story';
  return 'stop';
}

export async function runContinuity({ claim, render, fail, report = () => {}, maxClaims = 4, requested = false }) {
  if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > 10) throw new Error('Invalid claim budget');
  const seen = new Set();
  for (let attempt = 1; attempt <= maxClaims; attempt++) {
    const job = await claim();
    if (!job) return { status: 'no_eligible_story', attempted: seen.size };
    if (seen.has(job.article_id)) throw new Error('Queue returned the same failed article; refusing repeated spend');
    seen.add(job.article_id);
    try { return { status: 'rendered', attempted: seen.size, manifest: await render(job) }; }
    catch (error) {
      // A failed DB acknowledgement must not be ignored or mistaken for an available replacement slot.
      await fail(job, error);
      const action = failureAction(error, { requested });
      report({ attempt, action, error });
      if (action === 'stop') throw error;
    }
  }
  throw new Error('Replacement story budget exhausted; no substandard video published');
}
