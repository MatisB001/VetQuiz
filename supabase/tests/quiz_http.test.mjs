// Teste l'enveloppe HTTP de la fonction Edge (index.ts) avec Node 22 : CORS, connexion, erreurs, choix de la clé.
// Le client Supabase est remplacé par un double qui appelle la base de test ; Deno.serve et Deno.env sont imités.
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const U = "40000000-0000-0000-0000-000000000001";
execFileSync("psql", ["-X", "-q", "-c", `insert into auth.users (id, email) values ('${U}', 'http@exemple.fr')`]);

const dir = mkdtempSync(join(tmpdir(), "quiz-http-"));
writeFileSync(join(dir, "fake-supabase.mjs"), `
import { execFileSync } from "node:child_process";
const lit = (v) => v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
export const seen = {};
export function createClient(url, key) {
  seen.url = url; seen.key = key;
  return {
    auth: { getUser: async (t) => t === "jeton-valide" ? { data: { user: { id: "${U}" } }, error: null }
                                                     : { data: { user: null }, error: { message: "invalid JWT" } } },
    rpc: async (fn, args) => {
      const named = Object.entries(args).map(([k, v]) => k + " => " + lit(v)).join(", ");
      try {
        const out = execFileSync("psql", ["-X", "-q", "-t", "-A", "-v", "VERBOSITY=verbose", "-c", "set role service_role",
          "-c", "select coalesce(to_jsonb(public." + fn + "(" + named + "))::text, 'null')"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return { data: JSON.parse(out.trim()), error: null };
      } catch (e) {
        const m = /ERROR:\\s+(\\w{5}):\\s+(.*)/.exec(e.stderr || "");
        return { data: null, error: { code: m && m[1], message: m ? m[2] : String(e.stderr) } };
      }
    },
  };
}`);
const src = readFileSync(new URL("../functions/quiz/index.ts", import.meta.url), "utf8")
  .replace('"npm:@supabase/supabase-js@2"', JSON.stringify(pathToFileURL(join(dir, "fake-supabase.mjs")).href))
  .replace('"./core.js"', JSON.stringify(new URL("../functions/quiz/core.js", import.meta.url).href));
assert.ok(!src.includes("npm:") && !src.includes('"./core.js"'), "imports remplacés");
writeFileSync(join(dir, "index.ts"), src);

const env = { SUPABASE_URL: "http://local", SUPABASE_SERVICE_ROLE_KEY: "ancienne-cle",
              SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_test" }), QUIZ_ORIGINS: "https://vetquiz.example, http://localhost:8000" };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(join(dir, "index.ts")).href);
const { seen } = await import(pathToFileURL(join(dir, "fake-supabase.mjs")).href);

let n = 0;
const ok = (cond, what) => { assert.ok(cond, what); n++; console.log("  ok : " + what); };
const call = (init = {}, body) => handler(new Request("http://local/functions/v1/quiz", {
  method: init.method ?? "POST", headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
const auth = { authorization: "Bearer jeton-valide", origin: "https://vetquiz.example" };

ok(seen.key === "sb_secret_test", "clé : nouvelle clé secrète préférée à l'ancienne");
let r = await call({ method: "OPTIONS", headers: { origin: "http://localhost:8000" } });
ok(r.status === 204 && r.headers.get("access-control-allow-origin") === "http://localhost:8000", "CORS : origine autorisée");
r = await call({ method: "OPTIONS", headers: { origin: "https://ailleurs.example" } });
ok(r.headers.get("access-control-allow-origin") === "https://vetquiz.example", "CORS : autre origine non reprise");
ok(/authorization/.test(r.headers.get("access-control-allow-headers")), "CORS : en-tête Authorization permis");
r = await call({ method: "GET", headers: auth });
ok(r.status === 405, "GET refusé");
r = await call({}, { action: "state" });
ok(r.status === 401, "sans jeton : refusé");
r = await call({ headers: { authorization: "Bearer faux" } }, { action: "state" });
ok(r.status === 401, "jeton invalide : refusé");
r = await call({ headers: auth }, "{pas du json");
ok(r.status === 400, "corps illisible : refusé");
r = await call({ headers: auth }, { action: "state" });
let j = await r.json();
ok(r.status === 200 && j.next === 0 && r.headers.get("cache-control") === "no-store", "état du jour : 200, sans cache");
r = await call({ headers: auth }, { action: "start", qi: 3 });
j = await r.json();
ok(r.status === 409 && j.error === "question hors ordre", "erreur de partie : 409 avec message");
r = await call({ headers: auth }, { action: "start", qi: 0 });
ok(r.status === 200 && typeof (await r.json()).q === "string", "départ : 200 avec la question");
r = await call({ headers: auth }, { action: "answer", qi: 0, text: "Delta" });
j = await r.json();
ok(r.status === 200 && j.kind === "ok" && j.tier === 4, "réponse : corrigée par le serveur");

delete env.SUPABASE_SECRET_KEYS;
console.log(`  Tests HTTP passés : ${n}.`);
