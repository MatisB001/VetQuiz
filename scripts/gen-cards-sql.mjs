// Produit supabase/seed_cards.sql à partir des fichiers de la série de cartes (dossier partagé du projet).
// Usage : node scripts/gen-cards-sql.mjs <carddata2.js> <img2.js> > supabase/seed_cards.sql
// Seules les cartes qui ont un dessin peuvent sortir d'un sachet, comme dans la maquette.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const [cardsPath, imgPath] = process.argv.slice(2);
if (!cardsPath || !imgPath) { console.error("usage : gen-cards-sql.mjs <carddata2.js> <img2.js>"); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(readFileSync(cardsPath, "utf8") + ";this.CARDS=CARDS;", ctx);
vm.runInContext(readFileSync(imgPath, "utf8") + ";this.IMG=IMG;", ctx);
const cards = ctx.CARDS.filter((c) => ctx.IMG[c.id]);
for (const c of cards) {
  if (!/^[a-z0-9_-]+$/.test(c.id) || !["c", "r", "e", "l"].includes(c.tier) || !["dog", "cat"].includes(c.sp))
    throw new Error("carte invalide : " + JSON.stringify({ id: c.id, tier: c.tier, sp: c.sp }));
}
const rows = cards.map((c) => `  ('${c.id}', '${c.tier}', '${c.sp}')`).join(",\n");
const count = (sp, t) => cards.filter((c) => c.sp === sp && c.tier === t).length;
process.stdout.write(`-- Cartes de la série 1 (identifiant, rareté, espèce). Fichier produit par scripts/gen-cards-sql.mjs : ne pas modifier à la main.
-- ${cards.length} cartes : chiens ${["c", "r", "e", "l"].map((t) => count("dog", t)).join("/")}, chats ${["c", "r", "e", "l"].map((t) => count("cat", t)).join("/")} (commune/rare/épique/légendaire).
-- Une carte retirée de la série n'est pas supprimée ici : des joueurs peuvent déjà l'avoir.
insert into public.cards (id, tier, species) values
${rows}
on conflict (id) do update set tier = excluded.tier, species = excluded.species;
`);
