// deno test --allow-net=0.0.0.0 allowlist_test.ts   (no net actually used; fetch is stubbed)
import { assertEquals } from "jsr:@std/assert@1";
import { readAllowlist } from "./allowlist.ts";

const ENV = ["treebird7/fallback"];
const H = { apikey: "x" };

function stubFetch(impl: () => Promise<Response> | Response) {
  const real = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return () => { globalThis.fetch = real; };
}

Deno.test("table rows win, normalised and lowercased", async () => {
  const restore = stubFetch(() =>
    new Response(JSON.stringify([{ repo_name: " treebird7/Treebird " }, { repo_name: "treebird7/toak" }]))
  );
  try {
    assertEquals(await readAllowlist("u", H, ENV), {
      repos: ["treebird7/treebird", "treebird7/toak"],
      source: "table",
    });
  } finally { restore(); }
});

Deno.test("empty table falls back to env, not to allow-nobody", async () => {
  const restore = stubFetch(() => new Response("[]"));
  try {
    assertEquals(await readAllowlist("u", H, ENV), { repos: ENV, source: "env-fallback" });
  } finally { restore(); }
});

Deno.test("non-ok response falls back to env", async () => {
  const restore = stubFetch(() => new Response("nope", { status: 500 }));
  try {
    assertEquals(await readAllowlist("u", H, ENV), { repos: ENV, source: "env-fallback" });
  } finally { restore(); }
});

Deno.test("thrown fetch falls back to env", async () => {
  const restore = stubFetch(() => { throw new Error("dns"); });
  try {
    assertEquals(await readAllowlist("u", H, ENV), { repos: ENV, source: "env-fallback" });
  } finally { restore(); }
});

Deno.test("both sources empty fails closed", async () => {
  const restore = stubFetch(() => new Response("[]"));
  try {
    assertEquals((await readAllowlist("u", H, [])).repos, []);
  } finally { restore(); }
});
