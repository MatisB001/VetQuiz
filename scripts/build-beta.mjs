// Assemble la bêta « à essayer entre amis » publiée dans Claude : le gabarit partagé du site, corrigé dans la page
// (comme le site test), avec 7 questions d'essai, le lexique commun et web/beta.js (contestations, retours à copier).
// Usage : node scripts/build-beta.mjs <maquette/src> <cartes/build> <questions.json> <synonyms.json> <sortie.html>
// La sortie contient les réponses des questions d'essai : ne pas la committer.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chargeLexique, synonymesAvecLexique } from "./lexique.mjs";

const [src, cards, qPath, synPath, out] = process.argv.slice(2);
if (!out) { console.error("usage : build-beta.mjs <maquette/src> <cartes/build> <questions.json> <synonyms.json> <sortie.html>"); process.exit(1); }
let t = readFileSync(join(src, "site.tpl.html"), "utf8");
const Q = JSON.parse(readFileSync(qPath, "utf8")), SYN = JSON.parse(readFileSync(synPath, "utf8")), LEX = chargeLexique();
if (Q.length !== 7) throw new Error("la bêta attend exactement 7 questions (les mêmes chaque jour)");
for (const q of Q) q.ans = q.ans.map((a, i) => [a[0], a[1], a[2], synonymesAvecLexique(a[0], SYN[q.id]?.[String(i)] ?? [], LEX)]);
const qb = JSON.stringify(Q).replace(/<\//g, "<\\/");
const part = (f) => (existsSync(join(src, f)) ? readFileSync(join(src, f), "utf8") : "");
const beta = readFileSync(new URL("../web/beta.js", import.meta.url), "utf8");
for (const [k, v] of [["<!--__PLAYERS_VIEW__-->", part("players.html")], ["/*__PLAYERS_JS__*/", part("players.js")]]) if (t.includes(k)) t = t.split(k).join(v);
for (const [k, v] of [["/*__CARDDATA__*/", readFileSync(join(cards, "carddata2.js"), "utf8")], ["/*__IMG__*/", readFileSync(join(cards, "img2.js"), "utf8")],
  ["/*__QBANK__*/", qb], ["/*__LIVE_JS__*/", beta]]) {
  if (t.split(k).length !== 2) throw new Error("marqueur absent ou en double : " + k);
  t = t.split(k).join(v);   // split/join : aucun motif « $& » interprété, contrairement à replace
}
t = t.replace(/<title>[^<]*<\/title>/, "<title>VetQuiz bêta</title>");
writeFileSync(out, t);
const syn = Q.reduce((s, q) => s + q.ans.reduce((u, a) => u + a[3].length, 0), 0);
console.error(`${out} : ${Math.round(t.length / 1024)} Kio, ${Q.length} questions, ${Q.reduce((s, q) => s + q.ans.length, 0)} réponses, ${syn} synonymes`);
