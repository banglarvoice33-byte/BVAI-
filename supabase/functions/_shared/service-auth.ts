/** Never authorize decoded JWT claims without signature verification.
 * This server-to-server endpoint accepts only the exact configured service credential.
 * Hash both values before fixed-size comparison; fail closed on absent credentials.
 */
export async function verifyServiceCredential(request: Request, expected: string): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!expected || !supplied || supplied.length > 8192) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([expected, supplied].map(async value =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))));
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
