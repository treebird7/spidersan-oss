/**
 * Shared constants for the api-proxy and keys workers.
 * Single source of truth — both workers import from here.
 */

/** Key format regex — used at issuance (keys) and validation (api-proxy). */
export const KEY_REGEX = /^spk_(free|contributor)_[0-9a-f]{40}$/;

/** B2: max new keys issued per IP per calendar day. */
export const IP_KEY_DAILY_LIMIT = 5;

/**
 * M2: free keys expire after this window — bounds the accumulation of permanent
 * credentials. Written as expires_at in the record AND as the KV expirationTtl so
 * storage auto-cleans; api-proxy lazy-checks expires_at as the authoritative gate.
 */
export const FREE_KEY_TTL_DAYS = 90;
export const FREE_KEY_TTL_SECONDS = FREE_KEY_TTL_DAYS * 24 * 60 * 60;

/** Free tier usage ceiling per key per calendar day (api-proxy rate limiter). */
export const FREE_TIER_DAILY_LIMIT = 50;

/**
 * C1 (cost): hard ceilings so a backend swap to a metered provider can't become
 * an unbounded bill. These are code constants by design — not a property of
 * today's local-MLX wiring. Tune as needed; the point is that a ceiling exists.
 */
export const MAX_OUTPUT_TOKENS = 4096;
export const MAX_REQUEST_BYTES = 256 * 1024;
