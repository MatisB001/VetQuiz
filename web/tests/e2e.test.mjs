// Test de bout en bout du site de production dans Chromium (Playwright), contre un faux Supabase :
// l'authentification est imitée, mais la fonction de correction (core.js) et la base de test sont les vraies.
// Lancé par scripts/test-db.sh quand les fichiers de la maquette sont disponibles (variable VQ_SITE).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { handle, QuizError } from "../../supabase/functions/quiz/core.js";
const { chromium } = createRequire(import.meta.url)("playwright");   // installation globale (NODE_PATH)

const SITE = process.env.VQ_SITE, SB = "http://faux-supabase.test", WEB = "http://site.test";
const lit = (v) => v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const psql = (sql, pre = []) => execFileSync("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", ...pre.flatMap((c) => ["-c", c]), "-c", sql],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const rpc = async (fn, args) => {
  const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  try { return JSON.parse(psql(`select coalesce(to_jsonb(public.${fn}(${named}))::text, 'null')`, ["set role service_role"])); }
  catch (e) { const m = /ERROR:\s+(\w{5}):\s+(.*)/.exec(e.stderr || ""); if (m && m[1] === "P0001") throw new QuizError(409, m[2]); throw e; }
};

// ---------- Faux Supabase : authentification anonyme, fonction « quiz », lecture des tables ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenFor = (id) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, role: "authenticated", aud: "authenticated", is_anonymous: true, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const uidOf = (h) => { try { return JSON.parse(Buffer.from((h || "").replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub; } catch { return null; } };
const sessionFor = (id) => ({ access_token: tokenFor(id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "r-" + id, user: { id, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString() } });
const calls = [], players = [];
async function fakeSupabase(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  calls.push(req.method() + " " + path);
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (path === "/auth/v1/signup") {
    const id = randomUUID(); psql(`insert into auth.users (id, is_anonymous) values ('${id}', true)`); players.push(id);
    return json(200, sessionFor(id));
  }
  if (path === "/auth/v1/token") { const id = JSON.parse(req.postData() || "{}").refresh_token?.slice(2); return json(200, sessionFor(id)); }
  const uid = uidOf(req.headers()["authorization"]);
  if (path === "/auth/v1/user") return json(200, sessionFor(uid).user);
  if (path === "/functions/v1/quiz") {
    if (!uid) return json(401, { error: "non connecté" });
    try { return json(200, await handle(rpc, uid, JSON.parse(req.postData()))); }
    catch (e) { return json(e instanceof QuizError ? e.status : 500, { error: e.message }); }
  }
  const m = /^\/rest\/v1\/(\w+)$/.exec(path);
  if (m) {   // lecture avec les droits du joueur (RLS), comme PostgREST
    const cols = (url.searchParams.get("select") || "*").split(",").map((c) => c.replace(/[^\w*]/g, "")).join(", ");
    const ord = url.searchParams.get("order"), lim = url.searchParams.get("limit");
    const [oc, od] = (ord || "").split(".");
    const sql = `select coalesce(json_agg(t), '[]') from (select ${cols} from public.${m[1]}${ord ? ` order by ${oc.replace(/\W/g, "")} ${od === "desc" ? "desc" : "asc"}` : ""}${lim ? ` limit ${Number(lim)}` : ""}) t`;
    const claims = JSON.stringify({ sub: uid, role: "authenticated" }).replace(/'/g, "''");
    try { return json(200, JSON.parse(psql(sql, [`set request.jwt.claim.sub = '${uid || ""}'`, `set request.jwt.claims = '${claims}'`, `set role ${uid ? "authenticated" : "anon"}`]))); }
    catch (e) { return json(400, { message: String(e.stderr || e) }); }
  }
  return json(404, { error: "inconnu : " + path });
}

// ---------- Scénario ----------
let n = 0;
const shot = (name) => process.env.VQ_SHOTS ? page.screenshot({ path: join(process.env.VQ_SHOTS, name + ".png") }) : null;
const ok = (cond, what) => { assert.ok(cond, what); n++; console.log("  ok : " + what); };
const browser = await chromium.launch();
const ctx = await browser.newContext();
const foreign = [];
await ctx.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.origin === WEB) {
    const f = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    return route.fulfill({ status: 200, contentType: f.endsWith(".js") ? "text/javascript" : "text/html"   /* sans charset : la page doit le déclarer elle-même */, body: readFileSync(join(SITE, f)) });
  }
  if (u.origin === SB) return fakeSupabase(route);
  if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
  foreign.push(u.href); return route.abort();
});
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const logs = []; page.on("console", (m) => logs.push(m.type() + " : " + m.text()));
process.on("exit", (code) => { if (code) console.error("Requêtes :\n  " + calls.join("\n  ") + "\nConsole :\n  " + logs.join("\n  ") + "\nErreurs :\n  " + errors.join("\n  ")); });
await page.goto(WEB + "/");
await page.waitForTimeout(400);
ok(!calls.some((c) => c.includes("/signup")), "visite sans jouer : aucune session créée");
ok(await page.locator("#play").isVisible(), "accueil : bouton Jouer"); await shot("1-accueil");

await page.click("#play");
await page.waitForFunction(() => /alphabet radio/.test(document.getElementById("qText").textContent));
ok(calls.filter((c) => c.includes("/signup")).length === 1, "Jouer : une session invitée créée");
ok(await page.locator("#qNum").textContent() === "Question 1/7", "question 1/7 affichée");
const t1 = Number(await page.locator("#tnum").textContent());
ok(t1 >= 28 && t1 <= 30, "chronomètre lancé (" + t1 + " s)");
ok(!(await page.content()).includes("Bravo"), "aucune réponse acceptée dans la page");

await page.fill("#ans", "zzzz"); await page.click("#submit");
await page.waitForFunction(() => !document.getElementById("qhint").hidden);
ok(/Pas dans la liste/.test(await page.locator("#qhint").textContent()), "essai refusé : on peut réessayer");
await page.fill("#ans", "Echo"); await page.click("#submit");
await page.waitForSelector("#fb:not([hidden])");
ok(/Echo/.test(await page.locator("#fb").textContent()) && /\+5/.test(await page.locator("#fb .pts").textContent()), "réponse acceptée : niveau 5");
ok(/visibles demain/.test(await page.locator("#fb").textContent()), "liste des réponses annoncée pour demain"); await shot("2-reponse");

// Rechargement en pleine question : le chronomètre continue.
await page.click("#next");
await page.waitForFunction(() => /Question 2\/7/.test(document.getElementById("qNum").textContent) && /alphabet/.test(document.getElementById("qText").textContent));
await page.waitForTimeout(2200);
await page.reload(); await page.waitForTimeout(500);
ok(/question 2\/7/i.test(await page.locator("#play").textContent()), "rechargement : partie à reprendre à la question 2");
await page.click("#play");
await page.waitForFunction(() => /Question 2\/7/.test(document.getElementById("qNum").textContent) && /alphabet/.test(document.getElementById("qText").textContent));
const t2 = Number(await page.locator("#tnum").textContent());
ok(t2 <= 28, "rechargement : le chronomètre n'est pas remis à zéro (" + t2 + " s)");

await page.click("#skip");
await page.waitForSelector("#fb:not([hidden])");
ok(/Question passée/.test(await page.locator("#fb").textContent()), "question passée : 0 point");
for (let q = 3; q <= 7; q++) {
  await page.click("#next");
  await page.waitForFunction((k) => document.getElementById("qNum").textContent === `Question ${k}/7` && /alphabet/.test(document.getElementById("qText").textContent), q);
  await page.fill("#ans", "Delta"); await page.click("#submit");
  await page.waitForSelector("#fb:not([hidden])");
}
await page.click("#next");
await page.waitForSelector("#v-results:not([hidden])");
ok(await page.locator("#rScore").textContent() === "25", "résultat : 5 + 0 + 5 × 4 = 25 points");
const uid = players[0];
const card = psql(`select card_id from public.quiz_runs where user_id = '${uid}'`);
ok(card.length > 0 && psql(`select score from public.daily_results where user_id = '${uid}'`) === "25", "serveur : score 25 et carte " + card);

await page.click("#openPack");
await page.waitForSelector("#v-pack:not([hidden])");
ok(await page.evaluate(() => CARD && CARD.id) === card, "sachet : la carte tirée par le serveur");

await page.reload(); await page.waitForTimeout(600);
ok(await page.locator("#doneScore").textContent() === "25", "rechargement : partie terminée, 25 points");

// Réponses d'hier : visibles seulement pour un jour joué.
await page.click("#toReview");
await page.waitForFunction(() => !/Chargement/.test(document.getElementById("rvNote").textContent));
ok(/pas joué hier/.test(await page.locator("#rvNote").textContent()), "réponses d'hier : rien si on n'a pas joué hier");
psql(`insert into public.quiz_runs (user_id, day, question_ids, answers, done) values ('${uid}', public.paris_today() - 1,
      public.quiz_day_questions(public.paris_today() - 1), '[{"tier":2,"label":"Bravo"}]', true)`);
await page.click("#rvBack"); await page.click("#toReview");
await page.waitForFunction(() => document.querySelectorAll("#rvList .panel").length === 7);
await shot("3-hier");
ok(/Echo/.test(await page.locator("#rvList").textContent()) && (await page.locator("#rvList mark").first().textContent()) === "Bravo", "réponses d'hier : liste complète et réponse du joueur");

ok(foreign.length === 0, "aucune requête vers un autre site" + (foreign.length ? " : " + foreign.join(", ") : ""));
ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
await browser.close();
console.log(`  Tests du site passés : ${n}.`);
