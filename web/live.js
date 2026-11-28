/* ===== Site en ligne : partie corrigée par le serveur (Supabase) =====
   Injecté par scripts/build-web.mjs au marqueur LIVE_JS du gabarit de la maquette. Remplace les fonctions de jeu
   locales : les questions arrivent une par une du serveur, qui tient le chronomètre, corrige, écrit le score
   et tire la carte. Les joueurs sans compte jouent avec une session anonyme Supabase, créée au premier « Jouer ». */
(() => {
  const CFG = window.VQ_CONFIG;
  const sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "vq-auth" },
  });
  window.VQ = { sb };
  // site en ligne : « Comment jouer » affiche aussi la part des joueurs et les réponses dévoilées le lendemain
  document.body.classList.add("live");

  /* ---------- Outils ---------- */
  let banner = null;
  function notice(text) {
    if (!banner) {
      banner = document.createElement("p");
      banner.className = "qhint"; banner.setAttribute("role", "alert");
      banner.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:50;margin:0 auto;max-width:560px";
      document.body.appendChild(banner);
    }
    banner.textContent = text; banner.hidden = false;
    clearTimeout(banner._t); banner._t = setTimeout(() => { banner.hidden = true; }, 7000);
  }
  const fail = (e) => { console.error(e); notice("Connexion au serveur impossible : " + (e && e.message ? e.message : e) + ". Réessayez dans un instant."); };

  async function session(create) {
    const { data } = await sb.auth.getSession();
    if (data.session || !create) return data.session;
    const r = await sb.auth.signInAnonymously();
    if (r.error) throw r.error;
    return r.data.session;
  }
  async function api(body) {
    await session(true);
    const { data, error } = await sb.functions.invoke("quiz", { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* corps illisible */ }
      const err = new Error(msg); err.status = error.context && error.context.status; throw err;
    }
    return data;
  }
  window.VQ.api = api; window.VQ.session = session;

  /* « Effacer mes données » (Règles) : supprime la session (anonyme ou compte) et, par cascade, parties, scores et cartes.
     Sans session sur cet appareil, il n'y a rien sur le serveur : on efface seulement le navigateur. */
  eraseServer = async () => {
    const s = await session(false);
    if (!s) return;
    const { error } = await sb.rpc("delete_my_account");
    if (error) throw error;
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
  };

  /* ---------- État du jour, reçu du serveur ---------- */
  const blankQ = () => ({ id: null, dom: "", q: "", cat: "", ref: "", ans: [] });
  for (let i = 0; i < 7; i++) Q.push(blankQ());
  // save() de la maquette garde S dans ce navigateur : on n'en relit que « sachet ouvert » (affichage).
  const wasOpened = (day, id) => { try { const o = JSON.parse(localStorage.getItem("vq-site-2") || "null"); return !!(o && o.day === day && o.packId === id && o.opened); } catch (e) { return false; } };
  S = { day: null, answers: [], done: false, packId: null, opened: false, owned: [], streak: 0 };

  function applyState(st) {
    S.day = st.day;
    S.answers = (st.answers || []).map((a) => ({ input: "", label: a.label, tier: a.tier, pts: PTS[a.tier] || 0, tries: [] }));
    S.done = !!st.done;
    S.packId = st.card_id && byId[st.card_id] ? st.card_id : null;
    S.opened = !!S.packId && wasOpened(st.day, S.packId);
    (st.themes || []).forEach((d, i) => { if (Q[i]) { Q[i].dom = d; Q[i].cat = theme(d); Q[i].ref = refOf(d); } });
    (st.questions || []).forEach((x) => { Q[x.qi] = { ...Q[x.qi], id: x.id, dom: x.dom, q: x.q, cat: theme(x.dom), ref: refOf(x.dom) }; });
    $("themes").innerHTML = [...new Set(Q.map((q) => q.cat).filter(Boolean))].map((c) => `<li>${esc(c)}</li>`).join("");
  }

  async function loadCollection() {
    const [own, res] = await Promise.all([
      sb.from("cards_owned").select("card_id"),
      sb.from("daily_results").select("day").order("day", { ascending: false }).limit(400),
    ]);
    if (own.error) throw own.error;
    // la carte du jour reste une surprise jusqu'à l'ouverture du sachet
    S.owned = own.data.map((r) => r.card_id).filter((id) => byId[id] && !(id === S.packId && !S.opened));
    // série : jours consécutifs joués, jusqu'à hier (aujourd'hui est ajouté par l'accueil quand la partie est finie)
    const days = new Set((res.data || []).map((r) => r.day));
    let n = 0; const d = new Date(S.day + "T12:00:00Z");
    for (;;) { d.setUTCDate(d.getUTCDate() - 1); if (!days.has(d.toISOString().slice(0, 10))) break; n++; }
    S.streak = n;
  }

  async function refresh(create) {
    const s = await session(create);
    if (!s) { go(view); return false; }
    applyState(await api({ action: "state" }));
    await loadCollection();
    if (view === "home" || view === "binder" || view === "results") go(view);
    return true;
  }
  window.VQ.refresh = refresh;

  /* ---------- Partie ---------- */
  let deadline = 0, pending = false, queuedTimeout = false, starting = false;
  const showQ0 = showQ;

  startGame = async function () {
    if (starting) return; starting = true; $("play").disabled = true;
    try { await refresh(true); }
    catch (e) { return fail(e); }
    finally { starting = false; $("play").disabled = false; }
    // partie finie : le sachet s'il reste à ouvrir, sinon le résumé
    if (S.done) { if (S.packId && !S.opened) openPackView(); else go("results"); return; }
    qi = S.answers.length; tries = []; go("game"); showQ();
  };

  showQ = async function () {
    answered = true;   // aucun envoi avant que le serveur ait démarré le chronomètre
    $("qText").textContent = "…"; $("qhint").hidden = true; stopTimer();
    let s;
    try { s = await api({ action: "start", qi }); }
    catch (e) { fail(e); go("home"); return; }
    Q[qi] = { ...Q[qi], id: s.id, dom: s.dom, q: s.q, cat: theme(s.dom), ref: refOf(s.dom) };
    const skew = Date.parse(s.now) - Date.now();   // horloge du serveur moins celle de l'appareil
    deadline = Date.parse(s.deadline) - skew;
    showQ0();   // affichage de la maquette ; il appelle startTimer
  };

  startTimer = function () {
    stopTimer(); $("timer").classList.remove("low"); lastSec = -1;
    tEnd = performance.now() + Math.max(0, deadline - Date.now());
    const step = () => {
      const left = Math.max(0, tEnd - performance.now()), sec = Math.ceil(left / 1000);
      $("tbar").style.width = (left / 300) + "%";
      if (sec !== lastSec) { lastSec = sec; $("tnum").textContent = sec; if (sec <= 10) $("timer").classList.add("low"); if (sec <= 5 && sec > 0) SFX.tick(); }
      if (left <= 0) { submit($("ans").value, true); return; }
      timerId = requestAnimationFrame(step);
    };
    timerId = requestAnimationFrame(step);
  };

  function refuse(txt, r) {
    tries.push({ s: txt, k: r.kind }); renderTries();
    showHint(r.kind === "vague" ? (r.why === "generic" ? "Trop général : précisez votre réponse." : "Trop vague : votre réponse reprend les mots de la question.")
      : r.kind === "multi" ? "Une seule réponse à la fois." : "Pas dans la liste. Essayez encore !");
    const inp = $("ans"); inp.value = ""; inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake");
    inp.focus({ preventScroll: true }); SFX.bad(); buzz(30);
  }

  submit = async function (input, timeout) {
    if (answered) return;
    if (pending) { if (timeout) queuedTimeout = true; return; }
    const q = Q[qi], txt = (input || "").trim();
    if (!timeout && txt && tries.some((t) => norm(t.s) === norm(txt))) {
      showHint("Déjà proposé. Essayez autre chose."); const inp = $("ans"); inp.value = ""; inp.focus({ preventScroll: true }); return;
    }
    pending = true; $("submit").disabled = true;
    let r;
    try { r = await api({ action: "answer", qi, text: txt, final: !!timeout }); }
    catch (e) {
      pending = false; $("submit").disabled = false;
      if (e.status === 409) { notice("La partie a avancé sur un autre appareil ou onglet : reprise."); startGame(); return; }
      return fail(e);
    }
    pending = false; $("submit").disabled = false;
    if (r.kind === "miss" || r.kind === "vague" || r.kind === "multi") {
      refuse(txt, r);
      if (queuedTimeout) { queuedTimeout = false; submit("", true); }
      return;
    }
    queuedTimeout = false; answered = true; stopTimer();
    const prev = score(), tier = r.tier || 0, pts = PTS[tier];
    if (timeout && txt && r.kind !== "ok") tries.push({ s: txt, k: "miss" });
    S.answers[qi] = { input: tier ? txt : "", label: r.label || null, tier, pts, tries: tries.map((t) => t.s) };
    if (r.done) { S.done = true; S.packId = r.card_id && byId[r.card_id] ? r.card_id : null; }
    $("ans").disabled = true; $("submit").disabled = true; $("ansForm").hidden = true; $("qfoot").hidden = true; $("qhint").hidden = true; $("tries").hidden = true;
    if (tier) { SFX.good(tier); buzz(tier >= 4 ? [20, 30, 40] : 15); } else { SFX.bad(); buzz(40); }
    const tl = tries.length ? ` Vos essais refusés : ${tries.map((t) => "« " + esc(t.s) + " »").join(", ")}.` : "";
    let head, msg;
    if (r.kind === "ok" && tier) {
      const L = splitLabel(r.label);
      head = `<span class="fb-ans${L.main.length > 34 ? " long" : ""}">${esc(L.main)}${L.det ? `<span class="fb-det">${esc(L.det)}</span>` : ""}</span>`;
      msg = `<span class="fb-lv">${LV[tier]}</span>Réponse de niveau ${tier} sur 5${tries.length ? `, trouvée après ${tries.length} essai${tries.length > 1 ? "s" : ""} refusé${tries.length > 1 ? "s" : ""}` : ""}.`;
    } else {
      const why = r.kind === "pass" ? "Question passée" : r.kind === "too_many" ? "Trop d'essais" : "Temps écoulé";
      head = `<span class="fb-ans">${why}</span>`; msg = tl.trim();
    }
    const fb = $("fb"); fb.style.setProperty("--pc", PCOL[tier]);
    fb.innerHTML = `<div class="fb-head">${head}<span class="pts">+${pts}</span></div>
      <div class="scale">${[1, 2, 3, 4, 5].map((t) => `<div class="${t === tier ? "hit" : ""}" style="--pc:${PCOL[t]}"><b>${PTS[t]}</b><span class="lvn">${LV[t]}</span></div>`).join("")}</div>
      ${msg ? `<p>${msg}</p>` : ""}${shareLine(r.share)}
      <p class="src">Toutes les réponses acceptées seront visibles demain, avec les questions du jour.</p>
      <button class="btn" id="next">${S.done ? "Voir mon sachet" : "Question suivante"}</button>`;
    fb.hidden = false; pips(); paintPbar($("pbarG"), score(), prev);
    $("next").onclick = nextQ; $("next").focus({ preventScroll: true });
    contestBox(qi, [...new Set(tries.filter((t) => t.k === "miss").map((t) => t.s))]);
  };

  /* « X % des joueurs ont répondu cela » (décision de Seb, 27/11, comme Zebra) : joueurs du jour, lui compris */
  function shareLine(s) {
    if (!s || !(s.total > 0)) return "";
    const t = s.same <= 1 && s.total <= 1 ? "Vous êtes le premier joueur du jour à répondre à cette question."
      : s.same <= 1 ? `Personne d'autre n'a donné cette réponse aujourd'hui (${s.total} joueurs).`
      : `<b>${s.pct} %</b> des joueurs du jour ont donné cette réponse (${s.same} sur ${s.total}).`;
    return `<p class="share">${t}</p>`;
  }

  /* « Ma réponse était bonne » : le joueur signale un essai refusé ; le serveur ne garde qu'un compteur par texte */
  function contestBox(cq, refused) {
    if (!refused.length) return;
    const box = document.createElement("div");
    box.className = "contest";
    box.innerHTML = `<p><b>Une réponse refusée était bonne ?</b> Signalez-la : elle sera relue avant d'être ajoutée aux réponses acceptées.</p>` +
      refused.map((s, i) => `<button class="btn ghost" type="button" data-i="${i}">« ${esc(s)} » : ma réponse était bonne</button>`).join("");
    box.querySelectorAll("button").forEach((b) => {
      const s = refused[+b.dataset.i];
      b.onclick = async () => {
        b.disabled = true;
        let res;
        try { res = await api({ action: "contest", qi: cq, text: s }); }
        catch (e) { b.disabled = false; return fail(e); }
        b.textContent = res && res.ok ? `« ${s} » : signalée, merci` : `« ${s} » : signalement non enregistré (déjà fait ou limite atteinte)`;
      };
    });
    $("next").before(box);
  }
  const css = document.createElement("style");
  css.textContent = ".contest{display:grid;gap:8px;margin:12px 0}.contest p{margin:0}.contest .btn{text-align:left;white-space:normal}" +
    ".fb .share{font-size:12.5px;border-left:4px solid var(--pc,var(--ink));padding:2px 0 2px 8px}.fb .share b{font-variant-numeric:tabular-nums}";
  document.head.appendChild(css);

  nextQ = function () {
    if (qi < 6 && !S.done) { qi++; tries = []; showQ(); }
    // fin de partie, comme dans le gabarit : barre de progression en grand, sachet, puis résumé
    else { S.done = true; save(); showTally(); loadCollection().then(counts, () => {}); }
  };

  // La carte a déjà été tirée par le serveur à la fin de la partie.
  draw = () => (S.packId ? byId[S.packId] : null);

  /* ---------- Réponses d'hier ---------- */
  const sec = document.createElement("section");
  sec.className = "view rules"; sec.id = "v-review"; sec.hidden = true; sec.setAttribute("aria-label", "Réponses d'hier");
  sec.innerHTML = `<div class="panel"><h2>Réponses d'hier</h2><p id="rvNote"></p></div><div id="rvList"></div>
    <div class="row" style="margin:12px 0"><button class="btn ghost" id="rvBack">Retour</button></div>`;
  $("v-rules").after(sec);
  $("rvBack").onclick = () => go("home");
  const yesterday = () => { const d = new Date((S.day || new Date().toISOString().slice(0, 10)) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  async function renderReview() {
    $("rvNote").textContent = "Chargement…"; $("rvList").innerHTML = "";
    let rv = null;
    try { if (await session(false)) rv = await api({ action: "review", day: yesterday() }); }
    catch (e) { fail(e); }
    if (!rv) { $("rvNote").textContent = "Vous n'avez pas joué hier sur cet appareil : les réponses ne sont montrées qu'aux joueurs de la veille."; return; }
    $("rvNote").textContent = "Les 7 questions d'hier, toutes les réponses acceptées par niveau, et la vôtre en surbrillance.";
    $("rvList").innerHTML = rv.map((x) => {
      const mine = x.mine && x.mine.label;
      return `<div class="panel"><p class="fine">${esc(theme(x.dom))}</p><h2>${esc(x.q)}</h2>
        <p>${mine ? `Votre réponse : <b>${esc(splitLabel(mine).main)}</b> (${LV[x.mine.tier]}).` : "Pas de réponse acceptée."}</p>
        <ul class="allans">${[5, 4, 3, 2, 1].map((t) => { const L = x.accepted.filter((a) => a[1] === t); return L.length ? `<li style="--pc:${PCOL[t]}"><b>${t} · ${LV[t]}</b> ${L.map((a) => { const m = esc(splitLabel(a[0]).main); return a[0] === mine ? `<mark>${m}</mark>` : m; }).join(" ; ")}</li>` : ""; }).join("")}</ul></div>`;
    }).join("");
  }
  const homeBtn = document.createElement("button");
  homeBtn.className = "btn ghost"; homeBtn.id = "toReview"; homeBtn.textContent = "Réponses d'hier";
  homeBtn.onclick = () => go("review");
  $("toBinder").after(homeBtn);

  const go0 = go;
  go = function (v) {
    if (v !== "review") { $("v-review").hidden = true; return go0(v); }
    stopTimer(); view = v; document.querySelectorAll(".view").forEach((s) => { s.hidden = s.id !== "v-review"; });
    scrollTo({ top: 0, behavior: RM ? "auto" : "smooth" }); renderReview();
  };

  /* ---------- Ce qui ne concerne que la maquette ---------- */
  const hide = (el) => { if (el) el.hidden = true; };
  hide($("reset"));
  hide(document.querySelector("#v-home > p.note"));
  hide(document.querySelector('.tabs button[data-v="players"]'));
  const renderRules0 = renderRules;
  renderRules = function () {
    renderRules0();
    $("ptsTable").innerHTML = `<thead><tr><th>Niveau</th><th class="n">Points</th></tr></thead><tbody>${[1, 2, 3, 4, 5].map((t) => `<tr><td><span class="sw" style="--c:${PCOL[t]}"></span>${LV[t]}</td><td class="n">${PTS[t]}</td></tr>`).join("")}</tbody>`;
  };

  // Au chargement : on reprend la partie et la collection si ce navigateur a déjà joué (sans créer de session sinon).
  refresh(false).catch(fail);
})();
