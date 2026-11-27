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
const logCount = () => Number(sql("select coalesce(sum(n), 0) from public.answer_stats"));

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
logs = logCount();
await play(A, { action: "answer", qi: 0, text: "jean.dupont@exemple.fr" });
await play(A, { action: "answer", qi: 0, text: "06 12 34 56 78" });
ok(logCount() === logs, "essai refusé : e-mail ou numéro jamais compté");
r = await play(A, { action: "answer", qi: 0, text: "écho" });
ok(r.kind === "ok" && r.tier === 5 && r.label === "Echo (écho)" && r.done === false, "réponse acceptée : niveau 5");
ok(r.accepted === undefined && r.alts === undefined, "réponse acceptée : liste cachée jusqu'au lendemain");
ok(r.share && r.share.same === 1 && r.share.total === 1 && r.share.pct === 100, "part des joueurs : seul joueur du jour, 100 %");
ok(sql("select n || ':' || tier from public.answer_stats where accepted and answer = 'Echo (écho)'") === "1:5", "réponse acceptée : comptée avec son niveau, sous son libellé");
ok(sql("select count(*) from information_schema.columns where table_name = 'answer_stats' and column_name in ('day', 'user_id')") === "0", "statistiques : ni date ni identifiant");
await rejects(play(A, { action: "answer", qi: 0, text: "Alpha" }), 409, "question déjà répondue");

// 3 bis. Un essai refusé est compté sous sa forme normalisée, sans date ni joueur.
ok(sql("select n from public.answer_stats where not accepted and answer = 'zzzz'") === "1", "essai refusé : compté une fois");

ok(sql("select count(*) from public.answer_stats_review where not accepted") === "0", "analyse : essai refusé moins de 5 fois caché");
sql("update public.answer_stats set n = 5 where not accepted and answer = 'zzzz'");
ok(sql("select count(*) from public.answer_stats_review where not accepted") === "1", "analyse : essai refusé 5 fois visible");

// 3 ter. « Ma réponse était bonne » : signalement d'un essai refusé, compteur sans joueur ni date.
const q0 = sql(`select question_ids[1] from public.quiz_runs where user_id = '${A}' and day = public.paris_today()`);
r = await play(A, { action: "contest", qi: 0, text: "ZZZZ" });
ok(r.ok === true && sql("select contested from public.answer_stats where not accepted and answer = 'zzzz'") === "1", "signalement : compté sous la forme normalisée");
ok((await play(A, { action: "contest", qi: 0, text: "jamais tapé" })).ok === false, "signalement : texte jamais refusé ignoré");
ok((await play(A, { action: "contest", qi: 1, text: "zzzz" })).ok === false, "signalement : question pas encore terminée refusée");
ok((await play(A, { action: "contest", qi: 0, text: "jean.dupont@exemple.fr" })).ok === false, "signalement : e-mail ignoré");
await rejects(play(A, { action: "contest", qi: 8, text: "zzzz" }), 400, "signalement : numéro invalide refusé");
ok((await play(B, { action: "contest", qi: 0, text: "zzzz" })).ok === false, "signalement : sans partie du jour, rien");
sql(`insert into public.answer_stats (question_id, accepted, answer, tier, n) values (${lit(q0)}, false, 'yyyy', 0, 1)`);
ok(sql("select count(*) from public.answer_review where reponse_refusee = 'yyyy'") === "0", "revue : essai tapé une fois et non signalé caché");
await play(A, { action: "contest", qi: 0, text: "yyyy" });
ok(sql("select signalements || ':' || fois_tapee from public.answer_review where reponse_refusee = 'yyyy'") === "1:1", "revue : essai signalé visible, avec la question");
ok(sql("select string_agg(reponse_refusee, ',') from public.answer_review") === "zzzz,yyyy", "revue : les plus signalés d'abord, puis les plus tapés");
ok(sql("select count(*) from public.answer_stats_review where answer = 'yyyy'") === "1", "analyse : essai signalé visible");
sql(`update public.quiz_runs set contests = public.quiz_contest_max() where user_id = '${A}' and day = public.paris_today()`);
ok((await play(A, { action: "contest", qi: 0, text: "zzzz" })).ok === false, "signalement : au plus 10 par joueur et par jour");
ok(sql("select count(*) from information_schema.columns where table_name = 'quiz_runs' and column_name like 'contest%' and data_type <> 'smallint'") === "0", "partie : seulement un nombre de signalements, aucun texte");
ok(sql("select has_table_privilege('authenticated', 'public.answer_review', 'select') or has_function_privilege('authenticated', 'public.quiz_contest(uuid, int, text)', 'execute')") === "f", "revue et signalement : réservés au serveur");

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
const shares = [];
for (let qi = 0; qi < 7; qi++) {
  await play(B, { action: "start", qi });
  r = await play(B, { action: "answer", qi, text: "Echo" });
  shares.push(r.share);
}
ok(r.done === true && r.score === 35 && typeof r.card_id === "string", "partie parfaite : 35 points et une carte");

// 12. « X % des joueurs ont répondu cela » : deux nombres seulement, calculés sur les parties du jour.
const aAns = JSON.parse(sql(`select answers::text from public.quiz_runs where user_id = '${A}' and day = public.paris_today()`));
ok(shares.every((s, qi) => {
  const a = aAns[qi], total = a ? 2 : 1, same = 1 + (a && a.label === "Echo (écho)" ? 1 : 0);
  return s && s.total === total && s.same === same && s.pct === Math.round(100 * same / total) && Object.keys(s).length === 3;
}), "part des joueurs : même réponse / joueurs du jour, sans autre donnée");
ok(shares[0].same === 2 && shares[0].pct === 100, "part des joueurs : deux joueurs, même réponse à la question 1");
ok(sql(`select public.quiz_share('${B}', 7) is null and public.quiz_share('20000000-0000-0000-0000-0000000000ff', 0) is null`) === "t", "part des joueurs : rien hors partie ou hors question");
ok(sql("select has_function_privilege('anon', 'public.quiz_share(uuid,integer)', 'execute') or has_function_privilege('authenticated', 'public.quiz_share(uuid,integer)', 'execute')") === "f", "part des joueurs : réservée au serveur");
const C = "20000000-0000-0000-0000-0000000000c1";
sql(`insert into auth.users (id, is_anonymous) values ('${C}', true)`);
const sansPart = (fn, args) => (fn === "quiz_share" ? Promise.reject(new Error("fonction absente")) : rpc(fn, args));
await handle(sansPart, C, { action: "state" }); await handle(sansPart, C, { action: "start", qi: 0 });
r = await handle(sansPart, C, { action: "answer", qi: 0, text: "Echo" });
ok(r.kind === "ok" && r.tier === 5 && r.share === undefined, "part des joueurs : une base sans la fonction ne bloque pas la réponse");

console.log(`  Tests partie (fonction de correction) passés : ${n}.`);
