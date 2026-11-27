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
    if (qi === 6 && next) next.textContent = "Voir mon sachet";
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

  /* fin de partie (demande de Seb, 27/11, à tester dans la bêta avant le site) : le sachet s'ouvre tout de suite
     après la 7e question, et le résumé du score ne vient qu'après l'ouverture. */
  const intro = document.createElement("p");
  intro.className = "hint"; intro.id = "packIntro"; intro.hidden = true;
  $("v-pack").prepend(intro);
  nextQ = function () {
    if (qi < 6) { qi++; showQ(); }
    else { S.done = true; save(); showTally(); }
  };

  /* entre la fin des questions et le sachet (demande de Seb, 27/11) : la barre de progression en grand se remplit
     point par point ; chaque palier franchi s'allume (commun, rare, épique, légendaire), puis on ouvre le sachet. */
  const tally = document.createElement("div");
  tally.className = "tally"; tally.hidden = true;
  tally.setAttribute("role", "dialog"); tally.setAttribute("aria-modal", "true"); tally.setAttribute("aria-label", "Votre sachet du jour");
  tally.innerHTML = `<div class="tally-box">
      <p class="eyebrow">Partie terminée</p>
      <div class="tally-score"><b id="tScore">0</b><span>points</span></div>
      <div class="pbar" id="pbarT"></div>
      <p class="tally-rule" id="tRule"></p>
      <p class="tally-res" id="tRes" hidden></p>
      <button class="btn big" id="tOpen" type="button" hidden>Ouvrir mon sachet</button>
    </div>`;
  document.body.appendChild(tally);
  $("tRule").textContent = "Votre score choisit le sachet : plus il est haut, plus le sachet est rare, et plus il a de chances de contenir une carte rare.";
  let tTimer = 0, tStep = null;
  function showTally() {
    const sc = score(), el = $("pbarT"), pk = packFor(sc);
    el.innerHTML = ""; $("tRes").hidden = true; $("tOpen").hidden = true; $("tScore").textContent = "0";
    tally.hidden = false; document.body.classList.add("tally-on");
    const end = () => {
      clearInterval(tTimer); tStep = null;
      $("tScore").textContent = sc;
      const r = $("tRes"); r.style.setProperty("--c", RAR[pk.k].t);
      r.innerHTML = `<i></i>Vous gagnez un <b>${esc(pk.name.toLowerCase())}</b> !`; r.hidden = false;
      $("tOpen").hidden = false; $("tOpen").focus({ preventScroll: true });
    };
    paintPbar(el, 0);
    if (RM || sc === 0) { paintPbar(el, sc, null, true); end(); return; }
    let s = 0;
    tStep = () => { s++; $("tScore").textContent = s; paintPbar(el, s, s - 1, s === sc); SFX.tick(); if (s >= sc) end(); };
    setTimeout(() => { if (tStep) tTimer = setInterval(() => tStep && tStep(), Math.max(70, Math.min(140, 2400 / sc))); }, 650);
    // toucher l'écran pendant l'animation la termine tout de suite
    tally.onclick = (e) => { if (!tStep || e.target.closest("#tOpen")) return; clearInterval(tTimer); paintPbar(el, sc, null, true); end(); };
  }
  $("tOpen").onclick = () => { tally.hidden = true; document.body.classList.remove("tally-on"); openPackView(); };
  const openPackView0 = openPackView;
  openPackView = function () {
    const sc = score();
    intro.textContent = `Partie terminée : ${sc} point${sc > 1 ? "s" : ""}. Ouvrez votre ${packFor(sc).name.toLowerCase()} !`;
    intro.hidden = false;
    openPackView0();
  };
  $("packToBinder").textContent = "Voir mon résumé";
  $("packToBinder").onclick = () => go("results");
  const startGame0 = startGame;
  startGame = function () { if (S.done && !S.opened) { openPackView(); return; } startGame0(); };

  /* rejouer (demande de Seb, 27/11) : mêmes 7 questions, nouveau sachet ; les cartes déjà gagnées restent dans le
     classeur, et comme il n'y a jamais de doublon, le sachet suivant donne une autre race */
  function replay() { S.answers = []; S.done = false; S.packId = null; S.opened = false; save(); startGame(); }
  const doneRow = $("doneMain") && $("doneMain").parentElement;
  if (doneRow) {
    const rb = document.createElement("button");
    rb.className = "btn ghost"; rb.id = "betaReplayHome"; rb.type = "button"; rb.textContent = "Rejouer";
    rb.onclick = replay;
    doneRow.appendChild(rb);
    const renderHome0 = renderHome;
    renderHome = function () {
      renderHome0();
      if (S.done && S.opened) $("donePack").textContent = "Sachet ouvert. Rejouez les questions pour gagner une autre carte.";
    };
  }

  /* écran de score : retours à envoyer, et rejouer pour tester */
  const res = $("copy") && $("copy").closest(".panel");
  if (res) {
    const panel = document.createElement("div");
    panel.className = "panel beta-panel";
    panel.innerHTML = `<p class="eyebrow">Bêta</p><h2>Vos retours</h2><p id="betaCount"></p>
      <div class="row"><button class="btn" id="betaCopy" type="button">Copier mes retours</button><button class="btn ghost" id="betaReplay" type="button">Rejouer pour une autre carte</button><span id="betaMsg" role="status" style="font-size:12px"></span></div>`;
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
    $("betaReplay").onclick = replay;
  }

  /* onglet Règles : description de la base de la bêta */
  const renderRules0 = renderRules;
  renderRules = function () {
    renderRules0();
    const tot = QBANK.reduce((s, q) => s + q.ans.length, 0), syn = QBANK.reduce((s, q) => s + q.ans.reduce((t, a) => t + (a[3] || []).length, 0), 0);
    $("baseInfo").textContent = `Bêta : ${QBANK.length} questions d'essai, ${tot} réponses acceptées, ${syn.toLocaleString("fr-FR")} synonymes (dont abréviations, noms anglais et éponymes du lexique commun). Une référence générale par question ; réponses non vérifiées une à une, niveaux estimés par Claude, à relire par un vétérinaire.`;
  };

  const st = document.createElement("style");
  st.textContent = ".contest{display:grid;gap:8px;margin:12px 0}.contest p{margin:0}.contest .btn{text-align:left;white-space:normal}.beta-panel .row{flex-wrap:wrap;gap:8px}#plBody :disabled{opacity:.5;cursor:not-allowed}#packIntro{margin:0 0 6px;text-align:center;font-weight:600}#heroDone .row{flex-wrap:wrap;gap:8px}" +
    ".tally{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(9,12,24,.9);padding:16px max(16px,env(safe-area-inset-right,0px)) 16px max(16px,env(safe-area-inset-left,0px))}" +
    ".tally[hidden]{display:none}body.tally-on{overflow:hidden}" +
    ".tally-box{width:min(520px,100%);background:var(--night-2);color:var(--paper);border:3px solid var(--line);box-shadow:6px 6px 0 var(--ink);padding:18px 16px;display:grid;gap:12px;animation:tzoom .6s cubic-bezier(.2,1.5,.4,1)}" +
    "@keyframes tzoom{from{transform:scale(.5);opacity:0}}" +
    ".tally .eyebrow{margin:0;color:var(--muted)}.tally p{margin:0}" +
    ".tally-score{display:flex;align-items:baseline;gap:8px}.tally-score b{font-family:var(--font-display);font-size:54px;line-height:1;font-variant-numeric:tabular-nums}.tally-score span{font-family:var(--font-display);font-size:18px}" +
    ".tally .pbar{padding:10px 12px 6px;gap:9px}.tally .pb-now{font-size:21px}.tally .pb-next{font-size:13px}.tally .pb-track{height:24px}" +
    ".tally .pb-gem{width:18px;height:18px;margin:-9px 0 0 -9px}.tally .pb-gem:last-child{margin-left:-11px}" +
    ".tally-rule{font-size:13px;color:var(--muted)}" +
    ".tally-res{font-family:var(--font-display);font-size:18px;line-height:1.35;animation:tstamp .45s cubic-bezier(.2,1.4,.4,1)}@keyframes tstamp{from{opacity:0;transform:scale(1.8)}}.tally-res b{color:var(--c)}" +
    ".tally-res i{display:inline-block;width:14px;height:14px;border:2px solid var(--ink);background:var(--c);margin-right:8px;vertical-align:-1px}" +
    "@media (prefers-reduced-motion:reduce){.tally-box,.tally-res{animation:none}}";
  document.head.appendChild(st);
})();
