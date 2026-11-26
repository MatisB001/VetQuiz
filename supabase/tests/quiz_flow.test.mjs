// Déroulé complet de parties avec la fonction de correction (core.js) branchée sur la base de test.
// Lancé par scripts/test-db.sh (variables PGHOST, PGPORT, PGUSER, PGDATABASE). Aucun module à installer.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { handle, QuizError } from "../functions/quiz/core.js";

const lit = (v) => v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
function psql(sql, role) {
  const args = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
  if (role) args.push("-c", `set role ${role}`);
  args.push("-c", sql);
  try {
    return execFileSync("psql", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const m = /ERROR:\s+(\w{5}):\s+(.*)/.exec(e.stderr || "");
    const err = new Error(m ? m[2] : e.stderr); err.code = m?.[1]; throw err;
  }
}
const sql = (s) => psql(s);
// Même contrat que l'appel supabase.rpc() de index.ts, avec le rôle service_role.
const rpc = async (fn, args) => {
  const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  try {
    const out = psql(`select coalesce(to_jsonb(public.${fn}(${named}))::text, 'null')`, "service_role");
    return JSON.parse(out);
  } catch (e) {
    throw e.code === "P0001" ? new QuizError(409, e.message) : e;
  }
};
let n = 0;
const ok = (cond, what) => { assert.ok(cond, what); n++; console.log("  ok : " + what); };
const rejects = async (p, status, what) => {
  try { await p; } catch (e) { assert.ok(e instanceof QuizError && e.status === status, what + " : " + e.message); n++; console.log("  ok : " + what); return; }
  assert.fail(what + " : aucune erreur");
};

const A = "20000000-0000-0000-0000-0000000000a1";   // invité
const B = "20000000-0000-0000-0000-000000000001";   // joueur parfait
sql(`insert into auth.users (id, is_anonymous) values ('${A}', true); insert into auth.users (id, email) values ('${B}', 'b@exemple.fr')`);
const play = (uid, body) => handle(rpc, uid, body);
const logCount = () => Number(sql("select count(*) from public.answer_log"));

// 1. État initial : aucune question ni réponse visible avant de démarrer.
let st = await play(A, { action: "state" });
ok(st.next === 0 && st.current === null && st.done === false, "état initial");
ok(st.questions.length === 0 && !JSON.stringify(st).includes("Alpha"), "état : ni question ni réponse avant le départ");
await rejects(play(A, { action: "answer", qi: 0, text: "Echo" }), 409, "réponse avant le départ refusée");
await rejects(play(A, { action: "start", qi: 1 }), 409, "question hors ordre refusée");
await rejects(play(A, { action: "start", qi: 9 }), 400, "numéro invalide refusé");
await rejects(play(A, { action: "hack" }), 400, "action inconnue refusée");

// 2. Démarrage : le texte arrive, sans les réponses ; recharger ne remet pas le chrono à zéro.
let s0 = await play(A, { action: "start", qi: 0 });
ok(/alphabet radio/.test(s0.q) && !JSON.stringify(s0).includes("Alpha"), "départ : texte sans réponses");
ok(Date.parse(s0.deadline) - Date.parse(s0.started_at) === 30000, "départ : 30 secondes");
const again = await play(A, { action: "start", qi: 0 });
ok(again.started_at === s0.started_at, "rechargement : même heure de départ");
st = await play(A, { action: "state" });
ok(st.questions.length === 1 && st.current.qi === 0, "état : la question en cours seulement");

// 3. Essais refusés puis réponse acceptée.
let logs = logCount();
let r = await play(A, { action: "answer", qi: 0, text: "zzzz" });
ok(r.kind === "miss" && r.tries === 1, "essai raté : on peut réessayer");
ok(logCount() === logs + 1, "essai raté : journalisé");
r = await play(A, { action: "answer", qi: 0, text: "chien" });
ok(r.kind === "vague", "réponse trop vague");
r = await play(A, { action: "answer", qi: 0, text: "Bravo Charlie" });
ok(r.kind === "multi", "deux réponses d'un coup refusées");
r = await play(A, { action: "answer", qi: 0, text: "écho" });
ok(r.kind === "ok" && r.tier === 5 && r.label === "Echo (écho)" && r.done === false, "réponse acceptée : niveau 5");
ok(r.accepted === undefined && r.alts === undefined, "réponse acceptée : liste cachée jusqu'au lendemain");
ok(sql("select tier from public.answer_log order by id desc limit 1") === "5", "réponse acceptée : journalisée avec son niveau");
await rejects(play(A, { action: "answer", qi: 0, text: "Alpha" }), 409, "question déjà répondue");

// 4. Passer une question (texte vide) : 0 point.
await play(A, { action: "start", qi: 1 });
r = await play(A, { action: "answer", qi: 1, text: "   " });
ok(r.kind === "pass" && r.tier === 0, "question passée : 0 point");

// 5. Réponse juste mais trop tard (au-delà de 33 secondes) : 0 point.
await play(A, { action: "start", qi: 2 });
sql(`update public.quiz_runs set started_at = now() - interval '40 seconds' where user_id = '${A}'`);
r = await play(A, { action: "answer", qi: 2, text: "Echo" });
ok(r.kind === "timeout" && r.tier === 0 && r.label === null, "réponse après le temps : 0 point");

// 6. Fin du chrono côté navigateur avec une réponse fausse : 0 point, question close.
await play(A, { action: "start", qi: 3 });
logs = logCount();
r = await play(A, { action: "answer", qi: 3, text: "nope", final: true });
ok(r.kind === "timeout" && r.tier === 0 && logCount() === logs + 1, "fin du chrono : 0 point, essai journalisé");

// 7. Trop d'essais (plus de 20) : 0 point.
await play(A, { action: "start", qi: 4 });
for (let i = 1; i <= 20; i++) {
  r = await play(A, { action: "answer", qi: 4, text: "faux" + i });
  assert.equal(r.kind, "miss");
}
r = await play(A, { action: "answer", qi: 4, text: "Echo" });
ok(r.kind === "too_many" && r.tier === 0, "21e essai : 0 point");

// 8. Synonyme accepté.
await play(A, { action: "start", qi: 5 });
r = await play(A, { action: "answer", qi: 5, text: "premier choix" });
ok(r.kind === "ok" && r.tier === 1 && r.label === "Alpha", "synonyme accepté");

// 9. Question abandonnée (onglet fermé) : comptée 0 au retour ; partie terminée, score et carte.
await play(A, { action: "start", qi: 6 });
sql(`update public.quiz_runs set started_at = now() - interval '40 seconds' where user_id = '${A}'`);
st = await play(A, { action: "state" });
ok(st.done === true && st.score === 6, "abandon : question à 0, partie finie, score 6");
ok(JSON.stringify(st.answers.map((a) => a.tier)) === "[5,0,0,0,0,1,0]", "niveaux enregistrés dans l'ordre");
ok(st.card_id && sql(`select count(*) from public.cards_owned where user_id = '${A}' and card_id = ${lit(st.card_id)}`) === "1", "carte gagnée et enregistrée");
ok(sql(`select score || ':' || array_to_string(tiers, ',') from public.daily_results where user_id = '${A}'`) === "6:5,0,0,0,0,1,0", "score du jour enregistré");
ok(st.questions.length === 7 && !JSON.stringify(st).includes("Bravo"), "fin : 7 questions, réponses toujours cachées");
await rejects(play(A, { action: "start", qi: 0 }), 409, "pas de seconde partie le même jour");

// 10. Réponses : rien le jour même, la liste complète le lendemain.
ok(await play(A, { action: "review", day: st.day }) === null, "liste des réponses : pas le jour même");
sql(`insert into public.quiz_runs (user_id, day, question_ids, answers, done)
     values ('${A}', public.paris_today() - 1, public.quiz_day_questions(public.paris_today() - 1),
             '[{"tier":2,"label":"Bravo"}]', true)`);
const hier = sql("select (public.paris_today() - 1)::text");
const rev = await play(A, { action: "review", day: hier });
ok(rev.length === 7 && rev[0].accepted.length === 5 && rev[0].mine.label === "Bravo", "liste des réponses : le lendemain");
ok(!JSON.stringify(rev).includes("premier choix"), "liste des réponses : sans les synonymes internes");
ok(await play(B, { action: "review", day: hier }) === null, "liste des réponses : seulement les jours joués");
await rejects(play(A, { action: "review", day: "hier" }), 400, "date invalide refusée");

// 11. Partie parfaite : 35 points, sachet légendaire.
await rejects(play(B, { action: "start", qi: 0 }), 409, "départ sans état du jour refusé");
await play(B, { action: "state" });
for (let qi = 0; qi < 7; qi++) {
  await play(B, { action: "start", qi });
  r = await play(B, { action: "answer", qi, text: "Echo" });
}
ok(r.done === true && r.score === 35 && typeof r.card_id === "string", "partie parfaite : 35 points et une carte");

console.log(`  Tests partie (fonction de correction) passés : ${n}.`);
