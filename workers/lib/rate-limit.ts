/**
 * Advisory daily counter backed by KV. Not atomic — eventually consistent.
 *
 * KV key format: `{prefix}:{id}:{YYYY-MM-DD}` (UTC date)
 * TTL: 48 h so the record outlives any UTC-day clock skew and auto-cleans.
 *
 * On KV read failure the function allows the request — rate limiting here is
 * advisory friction, not a hard security gate.
 *
 * Caller responsibilities:
 *   - Contributor/bypass logic (e.g. skip for contributor tier) — do it before calling.
 *   - Missing-id guard (e.g. empty IP string) — do it before calling.
 *
 * @param kv     KV namespace binding
 * @param prefix Counter key prefix (e.g. 'rl' for per-key, 'ip_rl' for per-IP)
 * @param id     The subject being rate-limited (API key string or IP address)
 * @param max    Max allowed hits per UTC calendar day
 */
export async function checkDailyLimit(
  kv: KVNamespace,
  prefix: string,
  id: string,
  max: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const bucketKey = `${prefix}:${id}:${today}`;
  const resetAt = new Date().setUTCHours(24, 0, 0, 0); // UTC midnight tonight (ms)

  let count = 0;
  try {
    const raw = await kv.get(bucketKey, { type: 'text' });
    count = raw ? parseInt(raw, 10) : 0;
  } catch {
    return { allowed: true, remaining: max - 1, resetAt };
  }

  if (count >= max) {
    return { allowed: false, remaining: 0, resetAt };
  }

  kv.put(bucketKey, String(count + 1), { expirationTtl: 172800 }).catch(() => {});
  return { allowed: true, remaining: max - count - 1, resetAt };
}
