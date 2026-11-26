// Fonction Edge « quiz » : corrige les réponses côté serveur (voir core.js et la migration 20261126010000_quiz.sql).
// Appel : POST avec l'en-tête Authorization du joueur (compte ou session anonyme) et un corps JSON
//   { action: "state" } | { action: "start", qi } | { action: "answer", qi, text, final? } | { action: "review", day } | { action: "contest", qi, text }
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle, QuizError } from "./core.js";

// Clé serveur : nouvelle clé secrète si le projet en a une, sinon l'ancienne clé service_role.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* variable absente ou illisible */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Origines autorisées (secret QUIZ_ORIGINS, séparées par des virgules), par exemple l'adresse du site sur Cloudflare.
const ORIGINS = (Deno.env.get("QUIZ_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ORIGINS.includes("*") ? "*" : ORIGINS.includes(origin) ? origin : ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const reply = (data: unknown, status: number, headers: Record<string, string>) =>
  Response.json(data, { status, headers: { ...headers, "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return reply({ error: "méthode non permise" }, 405, h);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return reply({ error: "non connecté" }, 401, h);

  let body: unknown;
  try { body = await req.json(); } catch { return reply({ error: "requête invalide" }, 400, h); }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw error.code === "P0001" ? new QuizError(409, error.message) : error;
    return data;
  };
  try {
    return reply(await handle(rpc, auth.user.id, body), 200, h);
  } catch (e) {
    if (e instanceof QuizError) return reply({ error: e.message }, e.status, h);
    console.error(e);
    return reply({ error: "erreur serveur" }, 500, h);
  }
});
