// The register-branch auth gate, split out from index.ts only so it can be
// tested without standing up Deno.serve. index.ts:15 — this list IS the gate.

export type Allowlist = { repos: string[]; source: "table" | "env-fallback" };

/**
 * Read the allowlist from public.registry_allowed_repos, falling back to the
 * REGISTRY_ALLOWED_REPOS env var (sp-uuyg). The fallback exists so one bad
 * table read cannot 403 every repo at once; drop it after a release.
 *
 * An empty table counts as a failed read, not as "allow nobody" — a truncated
 * table should not lock the fleet out while the env var still holds the list.
 * If BOTH are empty the result is an empty list, i.e. fail closed.
 */
export async function readAllowlist(
  restUrl: string,
  headers: Record<string, string>,
  envFallback: string[],
): Promise<Allowlist> {
  try {
    const res = await fetch(`${restUrl}?select=repo_name`, { headers });
    if (res.ok) {
      const rows = (await res.json()) as Array<{ repo_name: string }>;
      const repos = rows
        .map((r) => String(r.repo_name ?? "").trim().toLowerCase())
        .filter(Boolean);
      if (repos.length) return { repos, source: "table" };
      console.warn("allowlist table empty — falling back to REGISTRY_ALLOWED_REPOS");
    } else {
      console.warn(`allowlist table read failed: ${res.status} — falling back to env`);
    }
  } catch (e) {
    console.warn(`allowlist table read threw: ${e} — falling back to env`);
  }
  return { repos: envFallback, source: "env-fallback" };
}
