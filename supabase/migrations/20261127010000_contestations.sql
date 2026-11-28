-- Meilleure reconnaissance des réponses (demande de Seb, 27/11/2026) :
-- 1. bouton « Ma réponse était bonne » : après une question, le joueur peut signaler un de ses essais refusés ;
-- 2. liste de revue (vue answer_review) des essais refusés souvent ou signalés, à relire avant d'ajouter
--    un synonyme ou une réponse (synonyms.json ou data/lexique.json, puis gen-questions-sql).
-- Comme answer_stats, un signalement n'est qu'un compteur par (question, texte) : ni joueur, ni date.
-- Fichier rejouable sans erreur (if not exists, create or replace).

alter table public.answer_stats add column if not exists contested int not null default 0;
-- Nombre de signalements du joueur pour la partie du jour, toutes questions confondues (un nombre, aucun texte).
alter table public.quiz_runs add column if not exists contests smallint not null default 0;

-- Signalements par joueur et par jour (provisoire) : 7 questions, quelques essais refusés chacune.
create or replace function public.quiz_contest_max() returns int language sql immutable as $$ select 10 $$;

-- Un signalement : seulement pour une question déjà terminée de la partie du jour, et pour un essai refusé
-- déjà compté dans answer_stats (on ne peut pas créer de ligne avec un texte inventé). Vrai si enregistré.
create or replace function public.quiz_contest(uid uuid, qi int, txt text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs;
begin
  select * into r from quiz_runs where user_id = uid and day = paris_today() for update;
  if not found or qi is null or qi < 0 or qi >= jsonb_array_length(r.answers)
     or r.contests >= quiz_contest_max() or coalesce(txt, '') = '' then
    return false;
  end if;
  update answer_stats set contested = contested + 1
   where question_id = r.question_ids[qi + 1] and not accepted and answer = left(txt, 120);
  if not found then return false; end if;
  update quiz_runs set contests = contests + 1 where user_id = uid and day = r.day;
  return true;
end $$;

-- Analyse : un essai refusé apparaît s'il a été tapé au moins 5 fois, ou signalé au moins une fois
-- (un signalement est un geste volontaire ; les e-mails et numéros ne sont jamais comptés).
create or replace view public.answer_stats_review with (security_invoker = true) as
  select * from public.answer_stats where accepted or n >= 5 or contested >= 1;

-- Liste de revue pour Seb (Table Editor ou SQL Editor de Supabase) : les plus signalés d'abord.
create or replace view public.answer_review with (security_invoker = true) as
  select s.question_id, q.q as question, s.answer as reponse_refusee, s.contested as signalements, s.n as fois_tapee
    from public.answer_stats s join public.questions q on q.id = s.question_id
   where not s.accepted and (s.n >= 5 or s.contested >= 1)
   order by s.contested desc, s.n desc, s.question_id, s.answer;

revoke all on public.answer_stats_review, public.answer_review from anon, authenticated;
grant select on public.answer_stats_review, public.answer_review to service_role;
revoke execute on function public.quiz_contest(uuid, int, text), public.quiz_contest_max() from public, anon, authenticated;
grant execute on function public.quiz_contest(uuid, int, text), public.quiz_contest_max() to service_role;
