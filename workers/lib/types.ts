/**
 * Canonical KV record for a spidersan API key.
 *
 * Written by the keys worker at issuance; read by the api-proxy at validation.
 * Both workers must agree on this shape — it is the contract across the shared
 * VALID_API_KEYS KV namespace.
 *
 * KV key:   raw API key string (e.g. "spk_free_<40-hex>")
 * KV value: JSON-serialised ApiKeyRecord
 */
export interface ApiKeyRecord {
  tier: 'free' | 'contributor';
  /** ISO timestamp of key issuance. */
  created: string;
  /** SHA-256(email).slice(0,12) — audit trail; written by keys worker, never read by api-proxy. */
  email_hash?: string;
  label?: string;
  /** M2: ISO expiry. Absent = never expires. api-proxy lazy-expires on read. */
  expires_at?: string;
  /** M2: per-key disable flag — revoked keys are rejected without deletion (keeps audit record). */
  revoked?: boolean;
  revoked_at?: string;
  revoked_reason?: string;
}
