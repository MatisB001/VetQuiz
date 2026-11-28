// Produit le SQL qui charge les questions et leurs réponses acceptées dans Supabase.
// Usage : node scripts/gen-questions-sql.mjs <questions.json> <synonyms.json> <sortie.sql> [lexique.json]
// Le lexique commun (data/lexique.json par défaut) ajoute aux synonymes les abréviations, noms anglais et éponymes.
// Ce fichier contient toutes les réponses : ne jamais le committer dans le dépôt public.
// L'ordre de questions.json donne l'ordre de rotation, comme dans la maquette. Une question absente
// du fichier garde une position négative : elle sort de la rotation sans casser les parties passées.
import { readFileSync, writeFileSync } from "node:fs";
import { chargeLexique, synonymesAvecLexique, LEXIQUE_DEFAUT } from "./lexique.mjs";

const [qPath, synPath, out, lexPath] = process.argv.slice(2);
if (!qPath || !synPath || !out) { console.error("usage : gen-questions-sql.mjs <questions.json> <synonyms.json> <sortie.sql>"); process.exit(1); }
const Q = JSON.parse(readFileSync(qPath, "utf8"));
const SYN = JSON.parse(readFileSync(synPath, "utf8"));
const LEX = chargeLexique(lexPath || LEXIQUE_DEFAUT);
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ids = new Set();
const rows = Q.map((q, pos) => {
  if (!q.id || ids.has(q.id)) throw new Error("identifiant absent ou en double : " + q.id);
  ids.add(q.id);
  if (!q.q || !q.dom || !Array.isArray(q.ans) || !q.ans.length) throw new Error("question incomplète : " + q.id);
  const answers = q.ans.map((a, i) => {
    if (typeof a[0] !== "string" || !(a[1] >= 1 && a[1] <= 5)) throw new Error(`réponse invalide : ${q.id} n° ${i}`);
    return [a[0], a[1], a[2] ?? "", synonymesAvecLexique(a[0], SYN[q.id]?.[String(i)] ?? [], LEX)];
  });
  return `  (${lit(q.id)}, ${pos}, ${lit(q.dom)}, ${lit(q.q)}, ${lit(JSON.stringify(answers))}::jsonb)`;
});
if (rows.length < 7) throw new Error("il faut au moins 7 questions");
writeFileSync(out, `-- Questions VetQuiz et réponses acceptées : CONFIDENTIEL, ne pas publier ni committer.
-- Produit par scripts/gen-questions-sql.mjs (${rows.length} questions). À coller dans le SQL Editor de Supabase.
begin;
update public.questions set pos = (select least(coalesce(min(pos), 0), 0) from public.questions) - 1 - pos where pos >= 0;
insert into public.questions (id, pos, dom, q, answers) values
${rows.join(",\n")}
on conflict (id) do update set pos = excluded.pos, dom = excluded.dom, q = excluded.q, answers = excluded.answers;
commit;
`);
console.error(`${out} : ${rows.length} questions`);
