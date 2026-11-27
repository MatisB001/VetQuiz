/* ---------- Bêta dans Claude : 7 questions d'essai, corrigées dans la page ----------
   Injecté au marqueur LIVE_JS du gabarit partagé par scripts/build-beta.mjs (jamais sur le site de production).
   Une page Claude ne peut joindre ni Supabase ni aucun serveur pour des visiteurs extérieurs : les réponses
   refusées et les contestations restent dans le navigateur du joueur, qui les copie et les envoie à Seb. */
(() => {
  const CKEY = "vq-contest";
  const getC = () => { try { return JSON.parse(localStorage.getItem(CKEY) || "[]"); } catch (e) { return []; } };
  const addC = (q, s) => { try { const L = getC(); if (!L.some((x) => x.q === q && x.s === s)) { L.push({ q, s, d: todayKey }); localStorage.setItem(CKEY, JSON.stringify(L.slice(-300))); } } catch (e) {} };
  const ids = new Set(QBANK.map((q) => q.id));

  /* accueil : une ligne discrète en bas à la place de la note de la maquette */
  const note = document.querySelector("#v-home > p.note");
  if (note) note.innerHTML = "<b>Bêta</b> : questions d'essai, réponses pas encore relues. Refusé à tort ? Signalez-le après la question.";

  /* onglet Joueurs : aperçu seulement (choix de Seb, 27/11) ; ni compte ni amis dans la bêta, champs et envois désactivés.
     On peut changer de rubrique (Profil, Amis, Ligues, Écoles) pour voir à quoi elles ressemblent. */
  const pv = $("v-players");
  if (pv) {
    const info = document.createElement("p");
    info.className = "note";
    info.innerHTML = "<b>Aperçu</b> : comptes, amis et ligues arriveront au lancement. Rien ne peut être saisi dans la bêta.";
    pv.prepend(info);
    const NAV = ["login", "back", "openL", "goProfil", "cancelCode"].map((a) => `:not([data-act="${a}"])`).join("");
    const lock = () => pv.querySelectorAll(`#plBody input, #plBody select, #plBody textarea, #plBody form button, #plBody button[data-act]${NAV}`)
      .forEach((el) => { el.disabled = true; });
    pv.addEventListener("submit", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    new MutationObserver(lock).observe(pv, { childList: true, subtree: true });
    lock();
  }

  /* après chaque question : contestation des essais refusés, source de la question */
  const submit0 = submit;
  submit = function (input, timeout) {
    const was = answered;
    submit0(input, timeout);
    if (was || !answered) return;
    const q = Q[qi], fb = $("fb"), next = $("next");
    const src = fb.querySelector(".src");
    if (src) src.textContent = `Référence générale de la question : ${q.ref || "aucune"}. Bêta : réponses non vérifiées une à une, niveaux estimés.`;
    const refused = [...new Set(tries.filter((t) => t.k === "miss").map((t) => t.s))];
    if (!refused.length || !next) return;
    const box = document.createElement("div");
    box.className = "contest";
    box.innerHTML = `<p><b>Une réponse refusée était bonne ?</b> Touchez-la pour la signaler. Elle sera relue avant d'être ajoutée.</p>` +
      refused.map((s, i) => `<button class="btn ghost" type="button" data-i="${i}">« ${esc(s)} » : ma réponse était bonne</button>`).join("");
    box.querySelectorAll("button").forEach((b) => {
      const s = refused[+b.dataset.i];
      if (getC().some((x) => x.q === q.id && x.s === s)) { b.disabled = true; b.textContent = `« ${s} » : signalée, merci`; }
      b.onclick = () => { addC(q.id, s); b.disabled = true; b.textContent = `« ${s} » : signalée, merci`; };
    });
    next.before(box);
  };

  /* écran de score : retours à envoyer, et rejouer pour tester */
  const res = $("copy") && $("copy").closest(".panel");
  if (res) {
    const panel = document.createElement("div");
    panel.className = "panel beta-panel";
    panel.innerHTML = `<p class="eyebrow">Bêta</p><h2>Vos retours</h2><p id="betaCount"></p>
      <div class="row"><button class="btn" id="betaCopy" type="button">Copier mes retours</button><button class="btn ghost" id="betaReplay" type="button">Rejouer les 7 questions</button><span id="betaMsg" role="status" style="font-size:12px"></span></div>`;
    res.after(panel);
    const lists = () => ({ miss: getMissed().filter((m) => ids.has(m.q)), cont: getC().filter((m) => ids.has(m.q)) });
    const count = () => { const { miss, cont } = lists(); $("betaCount").textContent = `${miss.length} réponse${miss.length > 1 ? "s" : ""} refusée${miss.length > 1 ? "s" : ""}, dont ${cont.length} signalée${cont.length > 1 ? "s" : ""} comme bonne${cont.length > 1 ? "s" : ""}. Copiez la liste et envoyez-la à Seb : elle reste sur votre appareil, sans votre nom.`; $("betaCopy").disabled = !miss.length && !cont.length; };
    const renderResults0 = renderResults;
    renderResults = function () { renderResults0(); count(); };
    $("betaCopy").onclick = () => {
      const { miss, cont } = lists(), qs = Object.fromEntries(QBANK.map((q) => [q.id, q.q]));
      const line = (m) => `${m.q} (${qs[m.q]}) : « ${m.s} »`;
      const txt = ["VetQuiz bêta : mes retours", "", "Signalées comme bonnes :", ...(cont.length ? cont.map(line) : ["(aucune)"]),
        "", "Toutes les réponses refusées :", ...(miss.length ? miss.map(line) : ["(aucune)"])].join("\n");
      const ok = () => { $("betaMsg").textContent = "Copié. Collez-le dans un message à Seb."; };
      try { navigator.clipboard.writeText(txt).then(ok, () => { $("betaMsg").textContent = "Copie impossible ici : faites une capture d'écran de cette liste."; }); }
      catch (e) { $("betaMsg").textContent = "Copie impossible ici."; }
    };
    $("betaReplay").onclick = () => { S.answers = []; S.done = false; S.packId = null; S.opened = false; save(); startGame(); };
  }

  /* onglet Règles : description de la base de la bêta */
  const renderRules0 = renderRules;
  renderRules = function () {
    renderRules0();
    const tot = QBANK.reduce((s, q) => s + q.ans.length, 0), syn = QBANK.reduce((s, q) => s + q.ans.reduce((t, a) => t + (a[3] || []).length, 0), 0);
    $("baseInfo").textContent = `Bêta : ${QBANK.length} questions d'essai, ${tot} réponses acceptées, ${syn.toLocaleString("fr-FR")} synonymes (dont abréviations, noms anglais et éponymes du lexique commun). Une référence générale par question ; réponses non vérifiées une à une, niveaux estimés par Claude, à relire par un vétérinaire.`;
  };

  const st = document.createElement("style");
  st.textContent = ".contest{display:grid;gap:8px;margin:12px 0}.contest p{margin:0}.contest .btn{text-align:left;white-space:normal}.beta-panel .row{flex-wrap:wrap;gap:8px}#plBody :disabled{opacity:.5;cursor:not-allowed}";
  document.head.appendChild(st);
})();
