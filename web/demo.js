/* ---------- Démo dans Claude : 7 questions d'essai, corrigées dans la page ----------
   Injecté au marqueur LIVE_JS du gabarit partagé par scripts/build-demo.mjs (jamais sur le site de production).
   Une page Claude ne peut joindre ni Supabase ni aucun serveur pour des visiteurs extérieurs : les réponses
   refusées et les contestations restent dans le navigateur du joueur, qui les copie et les envoie à Seb.
   La fin de partie (barre en grand, sachet, résumé, « Revenez demain ») vient du gabarit, comme sur le site ;
   la démo n'ajoute que ce qui lui est propre : rejouer (exceptionnel), retours à copier, onglet Joueurs en aperçu. */
(() => {
  const CKEY = "vq-contest";
  const getC = () => { try { return JSON.parse(localStorage.getItem(CKEY) || "[]"); } catch (e) { return []; } };
  const addC = (q, s) => { try { const L = getC(); if (!L.some((x) => x.q === q && x.s === s)) { L.push({ q, s, d: todayKey }); localStorage.setItem(CKEY, JSON.stringify(L.slice(-300))); } } catch (e) {} };
  const ids = new Set(QBANK.map((q) => q.id));

  /* accueil : une ligne discrète en bas à la place de la note de la maquette */
  const note = document.querySelector("#v-home > p.note");
  if (note) note.innerHTML = "<b>Démo</b> : questions d'essai, réponses pas encore relues. Exceptionnellement, vous pouvez rejouer pour ouvrir d'autres sachets.";

  /* onglet Joueurs : aperçu seulement (choix de Seb, 27/11) ; ni compte ni amis dans la démo, champs et envois désactivés.
     On peut changer de rubrique (Profil, Amis, Ligues, Écoles) pour voir à quoi elles ressemblent. */
  const pv = $("v-players");
  if (pv) {
    const info = document.createElement("p");
    info.className = "note";
    info.innerHTML = "<b>Aperçu</b> : comptes, amis et ligues arriveront au lancement. Rien ne peut être saisi dans la démo.";
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
    if (src) src.textContent = `Référence générale de la question : ${q.ref || "aucune"}. Démo : réponses non vérifiées une à une, niveaux estimés.`;
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

  /* rejouer (demande de Seb, 27/11), seulement dans la démo : mêmes 7 questions, nouveau sachet ; les cartes déjà
     gagnées restent dans le classeur, et comme il n'y a jamais de doublon, le sachet suivant donne une autre race.
     Sur le site, un seul sachet par jour : à la place du « Revenez demain », la démo explique l'exception. */
  function replay() { S.answers = []; S.done = false; S.packId = null; S.opened = false; save(); syncDay(); startGame(); }
  fillTomorrow(`<div class="minipack" aria-hidden="true"></div><p><b>Démo : rejouez !</b>Sur le site, ce sera un seul sachet par jour, avec 7 nouvelles questions. Pendant la démo, exceptionnellement, vous pouvez rejouer pour ouvrir d'autres sachets.</p><button class="btn" type="button" data-replay>Rejouer</button>`);
  document.addEventListener("click", (e) => { if (e.target.closest("[data-replay]")) replay(); });

  /* écran de score : retours à envoyer */
  const res = $("copy") && $("copy").closest(".panel");
  if (res) {
    const panel = document.createElement("div");
    panel.className = "panel demo-panel";
    panel.innerHTML = `<p class="eyebrow">Démo</p><h2>Vos retours</h2><p id="demoCount"></p>
      <div class="row"><button class="btn" id="demoCopy" type="button">Copier mes retours</button><span id="demoMsg" role="status" style="font-size:12px"></span></div>`;
    res.after(panel);
    const lists = () => ({ miss: getMissed().filter((m) => ids.has(m.q)), cont: getC().filter((m) => ids.has(m.q)) });
    const count = () => { const { miss, cont } = lists(); $("demoCount").textContent = `${miss.length} réponse${miss.length > 1 ? "s" : ""} refusée${miss.length > 1 ? "s" : ""}, dont ${cont.length} signalée${cont.length > 1 ? "s" : ""} comme bonne${cont.length > 1 ? "s" : ""}. Copiez la liste et envoyez-la à Seb : elle reste sur votre appareil, sans votre nom.`; $("demoCopy").disabled = !miss.length && !cont.length; };
    const renderResults0 = renderResults;
    renderResults = function () { renderResults0(); count(); };
    $("demoCopy").onclick = () => {
      const { miss, cont } = lists(), qs = Object.fromEntries(QBANK.map((q) => [q.id, q.q]));
      const line = (m) => `${m.q} (${qs[m.q]}) : « ${m.s} »`;
      const txt = ["VetQuiz démo : mes retours", "", "Signalées comme bonnes :", ...(cont.length ? cont.map(line) : ["(aucune)"]),
        "", "Toutes les réponses refusées :", ...(miss.length ? miss.map(line) : ["(aucune)"])].join("\n");
      const ok = () => { $("demoMsg").textContent = "Copié. Collez-le dans un message à Seb."; };
      try { navigator.clipboard.writeText(txt).then(ok, () => { $("demoMsg").textContent = "Copie impossible ici : faites une capture d'écran de cette liste."; }); }
      catch (e) { $("demoMsg").textContent = "Copie impossible ici."; }
    };
  }

  /* « Prochain quiz dans » n'a pas de sens ici : la démo garde les 7 mêmes questions d'essai */
  const st = document.createElement("style");
  st.textContent = ".next{display:none}.contest{display:grid;gap:8px;margin:12px 0}.contest p{margin:0}.contest .btn{text-align:left;white-space:normal}.demo-panel .row{flex-wrap:wrap;gap:8px}#plBody :disabled{opacity:.5;cursor:not-allowed}";
  document.head.appendChild(st);
})();
