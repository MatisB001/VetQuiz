// Logique de la partie, indépendante de Supabase pour pouvoir la tester avec Node (scripts/test-db.sh).
// rpc(nom, arguments) appelle une fonction SQL de la migration 20261126010000_quiz.sql avec la clé serveur.
import { norm, prepare, judge } from "./matcher.js";

export class QuizError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const qiOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 6) throw new QuizError(400, "numéro de question invalide");
  return n;
};
const dayOf = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new QuizError(400, "date invalide");
  return v;
};

// Actions : state (état du jour), start (démarre une question), answer (un essai), review (réponses d'un jour passé).
export async function handle(rpc, uid, body) {
  switch (body?.action) {
    case "state": return rpc("quiz_state", { uid });
    case "start": return rpc("quiz_start", { uid, qi: qiOf(body.qi) });
    case "answer": return answer(rpc, uid, qiOf(body.qi), body.text, body.final === true);
    case "review": return rpc("quiz_review", { uid, d: dayOf(body.day) });
    default: throw new QuizError(400, "action inconnue");
  }
}

// Un essai. Réponse acceptée : la question est terminée. Réponse refusée : le joueur peut réessayer tant qu'il
// reste du temps. Texte vide (« passer »), envoi final à la fin du chrono, temps dépassé ou trop d'essais : 0 point.
async function answer(rpc, uid, qi, input, final) {
  const text = typeof input === "string" ? input.trim().slice(0, 200) : "";
  const cur = await rpc("quiz_attempt", { uid });
  if (!cur || cur.qi !== qi) throw new QuizError(409, "question hors ordre");
  const q = prepare({ q: cur.question.q, ans: cur.question.answers });
  const r = cur.expired || cur.too_many ? { kind: "closed" } : judge(q, text);
  const log = (tier) => rpc("quiz_log", { question_id: cur.question.id, answer_norm: norm(text), tier });

  if (r.kind === "ok") {
    await log(r.tier);
    const res = await rpc("quiz_answer", { uid, qi, tier: r.tier, label: r.label });
    // Les autres réponses possibles ne sont montrées que si la liste complète l'est aussi.
    return { kind: "ok", ...res, ...(res.accepted ? { alts: r.alts } : {}) };
  }
  if (r.kind === "miss") await log(0);
  if (cur.expired || cur.too_many || final || r.kind === "empty") {
    const res = await rpc("quiz_answer", { uid, qi, tier: 0, label: null });
    const kind = cur.expired ? "timeout" : cur.too_many ? "too_many" : final ? "timeout" : "pass";
    return { kind, ...res };
  }
  return { kind: r.kind, why: r.why ?? null, qi, tries: cur.tries };
}
