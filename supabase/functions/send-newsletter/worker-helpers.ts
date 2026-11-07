export const NEWSLETTER_MAX_ATTEMPTS = 8;

export type NewsletterMessage = {
  email: string;
  subscriber_id?: string;
};

export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0 && a.length > 0;
}

export function parseNewsletterMessage(value: unknown): NewsletterMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const email = (value as Record<string, unknown>).email;
  if (typeof email !== 'string') return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return null;
  const subscriberId = (value as Record<string, unknown>).subscriber_id;
  return {
    email: normalizedEmail,
    ...(typeof subscriberId === 'string' && subscriberId.length <= 64 ? { subscriber_id: subscriberId } : {}),
  };
}

export function idempotencyKey(messageId: number): string {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('invalid_message_id');
  return `bv-newsletter-${messageId}`;
}

export function retryDelaySeconds(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.min(NEWSLETTER_MAX_ATTEMPTS, Math.trunc(attempt) || 1));
  return Math.min(3600, 15 * (2 ** (normalizedAttempt - 1)));
}

export function shouldDeadLetter(attempt: number): boolean {
  return Math.trunc(attempt) >= NEWSLETTER_MAX_ATTEMPTS;
}

export function deliveryFailureCode(status?: number, timedOut = false): string {
  if (timedOut) return 'provider_timeout';
  if (status === 429) return 'provider_rate_limited';
  if (status !== undefined && status >= 500) return 'provider_server_error';
  if (status !== undefined && status >= 400) return 'provider_request_error';
  return 'provider_network_error';
}
