// Copie les pages juridiques (Markdown du dossier partagé « juridique ») dans le gabarit du site, entre
// <!--LEGAL:start--> et <!--LEGAL:end-->. Les trois builds (site test, production, démo) les reprennent ainsi telles quelles.
// Usage : node scripts/sync-legal.mjs <juridique> <maquette/src/site.tpl.html>
// Avant publication : on retire les notes internes (lignes « Projet… », citations « Note interne », phrases en
// italique « Clause… » ou « Si une mesure… ») et on remplace les crochets que le code du site permet de trancher.
// Tout autre crochet restant est signalé : il doit être rempli dans le Markdown, pas ici.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, tpl] = process.argv.slice(2);
if (!tpl) { console.error("usage : sync-legal.mjs <juridique> <site.tpl.html>"); process.exit(1); }

const DOCS = [
  ["mentions", "mentions-legales.md", "Mentions légales"],
  ["confidentialite", "politique-confidentialite.md", "Confidentialité"],
  ["cgu", "cgu.md", "CGU"],
];
const LINK = { "mentions-legales.md": "mentions", "politique-confidentialite.md": "confidentialite", "cgu.md": "cgu" };

// Remplacements vérifiés dans le code (27/11/2026). Chacun doit trouver son texte, sinon le script s'arrête.
const FIX = {
  mentions: [
    // licence : l'article 9 des CGU dit déjà « tous droits réservés »
    [" `[À FOURNIR : licence choisie, ex. tous droits réservés ou Creative Commons]`", " Tous droits réservés (voir l'article 9 des CGU)."],
  ],
  confidentialite: [
    // web/live.js : persistSession + autoRefreshToken ; offre gratuite Supabase : session sans durée maximale
    // (« By default, it lasts indefinitely », jeton d'accès d'une heure : supabase.com/docs/guides/auth/sessions)
    ["`[à confirmer par le fil technique : ex. 30 jours]`", "jusqu'à la déconnexion ou l'effacement des données du navigateur (le jeton d'accès, valable 1 heure, est renouvelé automatiquement)"],
    // clés réellement écrites par le site (site.tpl.html et web/live.js)
    ["| `sb-…-auth-token` (stockage local, clé de session Supabase) `[nom exact à confirmer]` | Retrouver votre partie, avec ou sans compte | Jusqu'à déconnexion, effacement par vous ou suppression de la session |\n| `[clé des préférences, à confirmer]` (stockage local) | Mémoriser vos préférences d'affichage | Jusqu'à effacement par vous |",
     "| `vq-auth` (stockage local, session Supabase) | Retrouver votre partie, avec ou sans compte | Jusqu'à déconnexion, effacement par vous ou suppression de la session |\n" +
     "| `vq-site-2` (stockage local) | Afficher sans attendre la partie du jour, vos cartes et votre série | Jusqu'à effacement par vous |\n" +
     "| `vq-missed` (stockage local) | Lister vos réponses refusées sur cet appareil (500 au plus), dans « Règles » ; cette liste n'est jamais envoyée | Jusqu'à « Vider la liste » ou effacement par vous |\n" +
     "| `vq-sound` (stockage local) | Mémoriser si le son est activé | Jusqu'à effacement par vous |\n" +
     "| `vq-howto` (stockage local) | Ne montrer qu'une fois la fenêtre « Comment jouer » | Jusqu'à effacement par vous |"],
  ],
  cgu: [
    // aucun outil de modération automatique dans le code (table reports, traitée à la main)
    [" `[à confirmer]`", ""],
  ],
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/\*([^*]+)\*/g, "<i>$1</i>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => LINK[u] ? `<a href="#${LINK[u]}" data-legal="${LINK[u]}">${t}</a>` : `<a href="${u}" rel="noopener">${t}</a>`)
  .replace(/(^|[\s(])(www\.cnil\.fr)/g, '$1<a href="https://www.cnil.fr" rel="noopener">$2</a>')
  .replace(/contact@vetquiz\.net/g, '<a href="mailto:contact@vetquiz.net">contact@vetquiz.net</a>');

function toHTML(md) {
  const out = [], L = md.split("\n");
  let para = [], list = [], table = [];
  let quote = false, skipQuote = false;
  const flushPara = () => { if (para.length) out.push(quote ? `<div class="callout"><p>${para.map(inline).join("<br>")}</p></div>` : `<p>${para.map(inline).join("<br>")}</p>`); para = []; quote = false; };
  const flushList = () => {
    if (!list.length) return;
    let h = "<ul>", depth = 0;
    list.forEach(([d, t], i) => {
      if (d > depth) { h = h.replace(/<\/li>$/, ""); h += "<ul>"; depth = d; }
      else if (d < depth) { h += "</ul></li>"; depth = d; }
      h += `<li>${inline(t)}</li>`;
    });
    if (depth) h += "</ul></li>";
    out.push(h + "</ul>"); list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|[\s|:-]+\|$/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    out.push(`<div class="tablewrap"><table><thead><tr>${rows[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    table = [];
  };
  const flush = () => { flushPara(); flushList(); flushTable(); };
  for (const raw of L) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flush(); skipQuote = false; continue; }
    if (/^>\s*Note interne/.test(line)) { flush(); skipQuote = true; continue; }       // notes internes
    if (line.startsWith(">")) { if (skipQuote) continue; flushList(); flushTable(); if (!quote) flushPara(); quote = true; para.push(line.replace(/^>\s?/, "")); continue; }
    if (/^\*Projet/.test(line)) { flush(); continue; }                                  // en-têtes « Projet… »
    let m;
    if ((m = line.match(/^(#{1,3}) (.*)$/))) { flush(); out.push(m[1].length === 1 ? `<h2>${inline(m[2])}</h2>` : `<h3>${inline(m[2])}</h3>`); continue; }
    if (line.startsWith("|")) { flushPara(); flushList(); table.push(line); continue; }
    if ((m = line.match(/^(\s*)- (.*)$/))) { flushPara(); flushTable(); list.push([m[1].length >= 2 ? 1 : 0, m[2]]); continue; }
    if (/^\*Dernière mise à jour/.test(line)) { flush(); out.push(`<p class="upd">${inline(line.replace(/^\*|\*$/g, ""))}</p>`); continue; }
    skipQuote = false; if (quote) flushPara(); flushList(); flushTable(); para.push(line);
  }
  flush();
  return out.join("\n");
}

let html = "", left = [];
for (const [id, file, label] of DOCS) {
  let md = readFileSync(join(dir, file), "utf8").replace(/\r/g, "");
  for (const [a, b] of FIX[id] || []) {
    if (!md.includes(a)) { console.error(`${file} : texte à remplacer introuvable (le Markdown a changé ?) :\n  ${a.slice(0, 90)}`); process.exit(1); }
    md = md.replace(a, () => b);
  }
  md = md.replace(/ ?\*(?:Clause|Si une mesure)[^*]*\*/g, "");
  md = md.replace(/^\*Projet.*\n?/gm, "");                         // phrases internes en italique
  for (const m of md.matchAll(/\[(?:À FOURNIR|à confirmer)[^\]]*\]/gi)) left.push(`${file} : ${m[0]}`);
  html += `<article class="legal-doc" id="legal-${id}" data-doc="${id}" hidden>\n${toHTML(md)}\n</article>\n`;
}

const A = "<!--LEGAL:start-->", B = "<!--LEGAL:end-->";
let t = readFileSync(tpl, "utf8");
const i = t.indexOf(A), j = t.indexOf(B);
if (i < 0 || j < i) { console.error("marqueurs LEGAL absents du gabarit"); process.exit(1); }
t = t.slice(0, i + A.length) + "\n" + html + t.slice(j);
writeFileSync(tpl, t);
console.log(`${tpl} : 3 pages juridiques copiées (${Math.round(html.length / 1024)} Kio).`);
if (left.length) console.log("Crochets encore à remplir dans le Markdown :\n  " + left.join("\n  "));
