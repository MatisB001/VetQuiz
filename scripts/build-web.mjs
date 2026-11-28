// Construit le site de production (dossier public/, servi tel quel par Cloudflare Pages) à partir du gabarit
// partagé de la maquette et de la série de cartes, sans aucune question ni réponse dans la page.
// Usage : node scripts/build-web.mjs <maquette/src> <cartes/build> [public]
// Les fichiers de la maquette vivent dans le dossier partagé du projet ; relancer ce script quand ils changent.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [src, cards, out = new URL("../public/", import.meta.url).pathname] = process.argv.slice(2);
if (!src || !cards) { console.error("usage : build-web.mjs <maquette/src> <cartes/build> [public]"); process.exit(1); }
const root = new URL("../", import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, "web/config.json"), "utf8"));
if (process.env.VQ_URL) config.url = process.env.VQ_URL;   // tests : faux Supabase
if (process.env.VQ_KEY) config.key = process.env.VQ_KEY;
const read = (p) => readFileSync(p, "utf8");
// Ne garde que les blocs PNG utiles à l'affichage : le dossier partagé du projet ajoute un bloc caBX (~6 Kio) à chaque PNG copié.
function pngMin(d) {
  const keep = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]), parts = [d.subarray(0, 8)];
  for (let i = 8; i < d.length;) { const n = d.readUInt32BE(i), t = d.toString("latin1", i + 4, i + 8); if (keep.has(t)) parts.push(d.subarray(i, i + 12 + n)); i += 12 + n; }
  return Buffer.concat(parts);
}

let t = read(join(src, "site.tpl.html"));
const once = (marker, value) => {
  if (t.split(marker).length !== 2) throw new Error("marqueur absent ou en double : " + marker);
  t = t.replace(marker, () => value);
};
once("/*__CARDDATA__*/", read(join(cards, "carddata2.js")));
once("/*__IMG__*/", read(join(cards, "img2.js")));
once("/*__QBANK__*/", "[]");                     // jamais les questions ni les réponses dans la page
once("<!--__PLAYERS_VIEW__-->", "");             // onglet Joueurs : étape suivante (comptes)
once("/*__PLAYERS_JS__*/", "");
once("/*__LIVE_JS__*/", read(join(root, "web/live.js")));
once("<script>", `<script>window.VQ_CONFIG=${JSON.stringify(config)};</script>\n<script src="supabase.js"></script>\n<script>`);

// Le gabarit est un fragment (l'aperçu claude.ai ajoute lui-même l'en-tête) : on écrit ici la page complète.
t = t.replace(/<meta name="claude:[^>]*>\n?/g, "").replace(/<title>[^<]*<\/title>/, "<title>VetQuiz</title>");
t = `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  t;   // <head> et <body> se ferment d'eux-mêmes (balises facultatives en HTML)

// Garde-fous : aucune réponse, aucune ressource externe chargée par la page.
if (/"ans"\s*:\s*\[/.test(t)) throw new Error("des réponses se trouvent dans la page");
const ext = [...t.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
if (ext.length) throw new Error("ressources externes : " + ext.join(", "));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), t);
copyFileSync(join(root, "web/vendor/supabase.js"), join(out, "supabase.js"));
// Grands dessins des cartes (planches de Seb, 27/11/2026) : fichiers séparés, chargés seulement quand une carte s'affiche.
rmSync(join(out, "dessins"), { recursive: true, force: true });
if (existsSync(join(cards, "dessins"))) {
  cpSync(join(cards, "dessins"), join(out, "dessins"), { recursive: true });
  for (const f of readdirSync(join(out, "dessins"), { recursive: true })) if (f.endsWith(".png")) writeFileSync(join(out, "dessins", f), pngMin(readFileSync(join(out, "dessins", f))));
}
writeFileSync(join(out, "_headers"), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${config.url}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`);
console.error(`${join(out, "index.html")} : ${Math.round(t.length / 1024)} Kio`);
