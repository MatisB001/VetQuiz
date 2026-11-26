// Assemble la fonction « quiz » en un seul fichier, à coller dans l'éditeur de fonctions du tableau de bord
// Supabase (Edge Functions > Deploy a new function > Via Editor), pour qui n'utilise pas la ligne de commande.
// Usage : node scripts/bundle-quiz.mjs <sortie.ts>
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) { console.error("usage : bundle-quiz.mjs <sortie.ts>"); process.exit(1); }
const dir = new URL("../supabase/functions/quiz/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");
const matcher = read("matcher.js").replace(/^export \{[^}]*\};?\s*$/m, "");
const core = read("core.js").replace(/^import .*matcher\.js";\s*$/m, "").replace(/^export /gm, "");
const index = read("index.ts").replace(/^import \{ handle, QuizError \} from "\.\/core\.js";\s*$/m, "");
for (const [name, s] of [["matcher", matcher], ["core", core], ["index", index]])
  if (/from "\.\//.test(s) || /^export /m.test(s)) throw new Error("import ou export restant dans " + name);
writeFileSync(out, `// @ts-nocheck
// Fonction Edge « quiz » en un seul fichier, produite par scripts/bundle-quiz.mjs depuis supabase/functions/quiz/.
// Ne pas modifier ici : modifier les sources du dépôt puis relancer le script.
${index}
// ---------- core.js ----------
${core}
// ---------- matcher.js ----------
${matcher}`);
console.error(out);
