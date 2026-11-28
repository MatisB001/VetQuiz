// Lexique commun (data/lexique.json) : abréviations, noms anglais, éponymes, valables pour toutes les questions.
// On ne touche pas au moteur de correction : on ajoute aux synonymes de chaque réponse les variantes obtenues
// en remplaçant un terme du lexique par ses équivalents. Le serveur et la maquette corrigent donc pareil.
// Usage en ligne de commande (contrôle) : node scripts/lexique.mjs <questions.json> <synonyms.json> [lexique.json]
import { readFileSync } from "node:fs";
import { norm, variants } from "../supabase/functions/quiz/matcher.js";

export const LEXIQUE_DEFAUT = new URL("../data/lexique.json", import.meta.url);
const MAX_AJOUTS = 40;   // par réponse : garde-fou si une réponse contient beaucoup de termes du lexique

export function chargeLexique(path = LEXIQUE_DEFAUT) {
  const L = JSON.parse(readFileSync(path, "utf8"));
  const groupes = L.groupes.map((g) => g.map(norm).filter(Boolean)).filter((g) => g.length >= 2);
  const vus = new Map();
  for (const g of groupes) for (const t of g) {
    if (vus.has(t)) throw new Error(`lexique : « ${t} » est dans deux groupes`);
    vus.set(t, g);
  }
  return groupes;
}

// mot entier : « irc » dans « irc terminale », jamais dans « circulation »
const contient = (texte, terme) => (" " + texte + " ").includes(" " + terme + " ");
const remplace = (texte, terme, par) => (" " + texte + " ").replace(" " + terme + " ", " " + par + " ").trim();

// Variantes ajoutées pour une réponse : libellé [0] et synonymes déjà connus.
export function variantesLexique(libelle, synonymes, groupes) {
  const base = [...new Set([...variants(libelle), ...synonymes].map(norm).filter(Boolean))];
  const deja = new Set(base), ajout = [];
  for (const texte of base) for (const g of groupes) {
    // le terme le plus long présent (« maladie d addison » plutôt que « addison »)
    const t = g.filter((x) => contient(texte, x)).sort((a, b) => b.length - a.length)[0];
    if (!t) continue;
    for (const autre of g) {
      if (autre === t || contient(texte, autre)) continue;   // « IRC (insuffisance rénale chronique) » : rien à ajouter
      const v = remplace(texte, t, autre);
      if (!deja.has(v)) { deja.add(v); ajout.push(v); }
    }
  }
  return ajout.slice(0, MAX_AJOUTS);
}

// Synonymes d'une réponse après lexique : ceux du fichier, puis les variantes ajoutées.
export function synonymesAvecLexique(libelle, synonymes, groupes) {
  return [...synonymes, ...variantesLexique(libelle, synonymes, groupes)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [qPath, synPath, lexPath] = process.argv.slice(2);
  if (!qPath || !synPath) { console.error("usage : lexique.mjs <questions.json> <synonyms.json> [lexique.json]"); process.exit(1); }
  const Q = JSON.parse(readFileSync(qPath, "utf8")), SYN = JSON.parse(readFileSync(synPath, "utf8"));
  const groupes = chargeLexique(lexPath || LEXIQUE_DEFAUT);
  let n = 0, r = 0;
  for (const q of Q) q.ans.forEach((a, i) => {
    const v = variantesLexique(a[0], SYN[q.id]?.[String(i)] ?? [], groupes);
    if (v.length) { r++; n += v.length; console.log(`${q.id} n° ${i} « ${a[0]} » : + ${v.join(" | ")}`); }
  });
  console.error(`${groupes.length} groupes ; ${n} variantes ajoutées à ${r} réponses`);
}
