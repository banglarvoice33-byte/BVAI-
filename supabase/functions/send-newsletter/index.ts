import {
  constantTimeEqual,
  deliveryFailureCode,
  idempotencyKey,
  NEWSLETTER_MAX_ATTEMPTS,
  parseNewsletterMessage,
  retryDelaySeconds,
  shouldDeadLetter,
} from './worker-helpers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function rpc<T>(base: string, serviceKey: string, name: string, args: unknown): Promise<T> {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`queue_rpc_${name}_${response.status}`);
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: unknown;
};

class ProviderFailure extends Error {
  constructor(readonly status?: number, readonly timedOut = false) {
    super('newsletter_provider_failure');
  }
}

async function retryOrDeadLetter(
  base: string,
  serviceKey: string,
  item: QueueMessage,
  message: ReturnType<typeof parseNewsletterMessage>,
  code: string,
): Promise<'deferred' | 'dead-lettered'> {
  const attempts = Math.max(1, Math.trunc(Number(item.read_ct)) || 1);
  if (shouldDeadLetter(attempts) && message) {
    try {
      await rpc(base, serviceKey, 'dead_letter_newsletter_message', {
        p_msg_id: item.msg_id,
        p_failure_code: code,
        p_attempt_count: Math.min(attempts, 100),
      });
      return 'dead-lettered';
    } catch {
      // Until the additive DLQ migration is applied, preserve the message and retry later.
    }
  }

  try {
    await rpc(base, serviceKey, 'defer_newsletter_message', {
      p_msg_id: item.msg_id,
      p_seconds: retryDelaySeconds(attempts),
    });
  } catch {
    // The queue visibility timeout will make the claim visible again if defer itself fails.
  }
  return 'deferred';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Both the DB scheduler flag and this Edge Function flag default OFF.
  // Enabling this handler can send real email and requires an explicit operator action.
  if (Deno.env.get('NEWSLETTER_SEND_ENABLED') !== 'true') {
    return json({ error: 'newsletter_worker_disabled' }, 503);
  }

  const workerSecret = Deno.env.get('NEWSLETTER_WORKER_SECRET') || '';
  const supplied = request.headers.get('x-worker-secret') || '';
  if (!workerSecret || !constantTimeEqual(supplied, workerSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('NEWSLETTER_FROM_EMAIL') || '';
  if (!base || !serviceKey || !resendKey || !from) {
    return json({ error: 'worker_not_configured' }, 503);
  }

  let messages: QueueMessage[];
  try {
    messages = await rpc<QueueMessage[]>(base, serviceKey, 'read_newsletter_queue', {
      p_visibility_seconds: 180,
      p_batch: 5,
    });
    if (!Array.isArray(messages)) messages = [];
  } catch {
    return json({ error: 'queue_unavailable' }, 503);
  }

  let sent = 0;
  let deferred = 0;
  let deadLettered = 0;
  let invalid = 0;

  for (const item of messages) {
    const msgId = Number(item?.msg_id);
    const message = parseNewsletterMessage(item?.message);
    if (!Number.isSafeInteger(msgId) || msgId <= 0 || !message) {
      if (Number.isSafeInteger(msgId) && msgId > 0) {
        try {
          await rpc(base, serviceKey, 'archive_newsletter_message', { p_msg_id: msgId });
        } catch {
          deferred += 1;
          continue;
        }
      }
      invalid += 1;
      continue;
    }

    let providerMessageId: string;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${resendKey}`,
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey(msgId),
        },
        body: JSON.stringify({
          from,
          to: [message.email],
          subject: 'Welcome to the Banglar Voice newsletter',
          text: 'Thank you for subscribing to Banglar Voice. You will receive our editorial newsletter when it is sent.',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new ProviderFailure(response.status);
      const providerResult = await response.json().catch(() => null);
      if (!providerResult || typeof providerResult.id !== 'string' || providerResult.id.length > 256) {
        throw new ProviderFailure(502);
      }
      providerMessageId = providerResult.id;
    } catch (error) {
      const providerError = error instanceof ProviderFailure ? error : null;
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      const code = deliveryFailureCode(providerError?.status, providerError?.timedOut || timedOut);
      const outcome = await retryOrDeadLetter(base, serviceKey, item, message, code);
      if (outcome === 'dead-lettered') deadLettered += 1;
      else deferred += 1;
      continue;
    }

    try {
      // This RPC atomically records provider success and deletes the queue message.
      await rpc(base, serviceKey, 'complete_newsletter_delivery', {
        p_msg_id: msgId,
        p_provider_message_id: providerMessageId,
      });
      sent += 1;
    } catch {
      // Resend's stable Idempotency-Key makes this retry safe while the DB ack recovers.
      const outcome = await retryOrDeadLetter(base, serviceKey, item, message, 'queue_ack_failed');
      if (outcome === 'dead-lettered') deadLettered += 1;
      else deferred += 1;
    }
  }

  return json({
    ok: true,
    processed: messages.length,
    sent,
    deferred,
    deadLettered,
    invalid,
    maxAttempts: NEWSLETTER_MAX_ATTEMPTS,
  });
});
