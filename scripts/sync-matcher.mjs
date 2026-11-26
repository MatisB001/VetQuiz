// Copie le moteur de correction de la maquette (maquette/src/matcher.js) dans la fonction Edge,
// pour que le serveur corrige exactement comme la maquette.
// Usage : node scripts/sync-matcher.mjs <maquette/src/matcher.js>
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) { console.error("usage : sync-matcher.mjs <matcher.js>"); process.exit(1); }
const body = readFileSync(src, "utf8").replace(/\n?if\(typeof module!=="undefined"\)module\.exports=\{[^}]*\};?\s*$/, "\n");
if (/module\.exports/.test(body)) throw new Error("export CommonJS inattendu dans " + src);
writeFileSync(new URL("../supabase/functions/quiz/matcher.js", import.meta.url),
  "// Copie de maquette/src/matcher.js faite par scripts/sync-matcher.mjs : ne pas modifier ici.\n" +
  body + "export { norm, judge, prepare, variants };\n");
