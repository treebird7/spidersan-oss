// register-branch — GitHub Actions OIDC → branch_registry writer.
//
// Replaces the retired auto-register workflow (c9a449b) without putting any
// DB credential in the public repo: CI authenticates with a short-lived
// GitHub OIDC token; this function verifies it and performs the write
// server-side with an sb_secret key held as a function secret.
//
// Deploy:  supabase functions deploy register-branch --no-verify-jwt
// Secrets: REGISTRY_SB_SECRET        sb_secret_... key (Dashboard → API keys)
//          REGISTRY_ALLOWED_REPOS    FALLBACK ONLY since sp-uuyg. The allowlist
//                                    now lives in public.registry_allowed_repos;
//                                    this var is read only if that table errors
//                                    or comes back empty, so one bad read cannot
//                                    403 every repo at once. Drop after a release.
//          REGISTRY_ALLOWED_REPO_IDS optional comma-separated numeric repo IDs
//                                    (immune to repo-name resquatting)
//
// Security model: the ONLY gate is the verified `repository` claim (aud is
// not a boundary — any GitHub repo can mint a token with our audience).
// Branch and actor come from token claims, never from the request body;
// the body contributes only `files`.
//
// To allow a repo (sp-uuyg): insert a row, service_role only —
//   insert into registry_allowed_repos (repo_name, added_by, note)
//   values ('treebird7/<repo>', '<agent>', '<why>');
// repo_name must be lowercase owner/repo. The repo also needs the
// SPIDERSAN_REGISTER_URL actions variable, or the workflow warns and skips.

import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { readAllowlist } from "./allowlist.ts";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "spidersan-registry";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SECRET = Deno.env.get("REGISTRY_SB_SECRET")!;
const ENV_ALLOWED_REPOS = (Deno.env.get("REGISTRY_ALLOWED_REPOS") ?? "treebird7/spidersan-oss")
  .split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
const ALLOWED_REPO_IDS = (Deno.env.get("REGISTRY_ALLOWED_REPO_IDS") ?? "")
  .split(",").map((r) => r.trim()).filter(Boolean);

const REST = `${SUPABASE_URL}/rest/v1/branch_registry`;
const ALLOWLIST_REST = `${SUPABASE_URL}/rest/v1/registry_allowed_repos`;
const REST_HEADERS = {
  apikey: SB_SECRET,
  Authorization: `Bearer ${SB_SECRET}`,
  "Content-Type": "application/json",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // Reject before touching JWKS — keeps unauthenticated probes cheap.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "missing bearer token" });

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(auth.slice(7), JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
    }));
  } catch {
    return json(401, { error: "token verification failed" });
  }

  const repository = String(claims.repository ?? "");
  // Read only after the token verifies — an unauthenticated probe must not be
  // able to make us hit the database. Read fresh every call, no cache: a
  // revoked repo has to stop registering immediately.
  const { repos: allowed, source } = await readAllowlist(
    ALLOWLIST_REST, REST_HEADERS, ENV_ALLOWED_REPOS,
  );
  if (!allowed.includes(repository.toLowerCase())) {
    console.log(`denied ${repository} (allowlist source: ${source}, n=${allowed.length})`);
    return json(403, { error: "repository not allowed" });
  }
  if (ALLOWED_REPO_IDS.length && !ALLOWED_REPO_IDS.includes(String(claims.repository_id ?? ""))) {
    return json(403, { error: "repository id not allowed" });
  }

  const ref = String(claims.ref ?? "");
  if (!ref.startsWith("refs/heads/")) return json(400, { error: "not a branch push" });
  const branch = ref.slice("refs/heads/".length);
  const actor = String(claims.actor ?? "github-actions");
  const agent = branch.includes("/") ? branch.split("/")[0] : actor;

  let files: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body.files)) {
      files = body.files.filter((f: unknown) => typeof f === "string").slice(0, 1000);
    }
  } catch {
    // no/invalid body → register with empty file list
  }

  // Existing row: refresh files only. Never touch state or attribution —
  // a push must not re-activate a merged branch or steal machine ownership.
  // Scoped by repo_name: branch_name is (for now) globally UNIQUE, so the
  // same branch name pushed from two allowlisted repos would otherwise
  // cross-clobber files. Until the composite-unique migration lands, the
  // second repo's insert 409s and its branch stays unregistered — visible
  // in the response, never silently corrupting another repo's row.
  const patch = await fetch(
    `${REST}?branch_name=eq.${encodeURIComponent(branch)}&repo_name=eq.${encodeURIComponent(repository)}`,
    {
      method: "PATCH",
      headers: { ...REST_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({ files_changed: files }),
    },
  );
  if (!patch.ok) return json(502, { error: `registry patch failed: ${patch.status}` });
  if (((await patch.json()) as unknown[]).length > 0) {
    return json(200, { branch, updated: true });
  }

  const insert = await fetch(REST, {
    method: "POST",
    headers: REST_HEADERS,
    body: JSON.stringify({
      branch_name: branch,
      created_by_agent: agent,
      created_by_session: "github-actions",
      repo_name: repository,
      files_changed: files,
      state: "active",
    }),
  });
  // 409 = same-repo push race (row wins, files near-identical) OR the
  // global-unique collision above — either way surfaced, not swallowed.
  if (!insert.ok && insert.status !== 409) {
    return json(502, { error: `registry insert failed: ${insert.status}` });
  }
  return json(201, { branch, created: insert.ok, collided: !insert.ok });
});
