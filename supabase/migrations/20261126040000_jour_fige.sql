-- Les 7 questions du jour sont les mêmes pour tous les joueurs (choix de Seb, 27/11/2026) :
-- la série d'un jour est calculée au premier appel puis enregistrée, et ne change plus,
-- même si l'on ajoute ou retire des questions pendant la journée.
-- Fichier rejouable sans erreur (if not exists, create or replace).

create table if not exists public.quiz_days (
  day date primary key,
  question_ids text[] not null check (cardinality(question_ids) = 7)
);
alter table public.quiz_days enable row level security;   -- aucune politique : invisible pour le navigateur
revoke all on public.quiz_days from anon, authenticated;
grant all on public.quiz_days to service_role;

-- Calcul de la rotation seul (ordre de questions.json, 7 par jour depuis le 26/11/2026), sans rien enregistrer.
create or replace function public.quiz_rotation(d date) returns text[]
  language sql stable set search_path = public as $$
  with q as (select id, row_number() over (order by pos) - 1 as k, count(*) over () as n from questions where pos >= 0)
  select array_agg(q.id order by i)
  from generate_series(0, 6) i
  join q on q.k = (((d - date '2026-11-26') * 7 + i) % q.n + q.n) % q.n;
$$;

-- Série du jour : celle déjà enregistrée, sinon la rotation, enregistrée au passage.
-- Deux premiers joueurs simultanés obtiennent la même série (on conflict do nothing, puis relecture).
create or replace function public.quiz_day_questions(d date) returns text[]
  language plpgsql volatile set search_path = public as $$
declare ids text[];
begin
  select question_ids into ids from quiz_days where day = d;
  if found then return ids; end if;
  ids := quiz_rotation(d);
  if cardinality(ids) is distinct from 7 then return ids; end if;   -- base incomplète : rien n'est figé
  insert into quiz_days (day, question_ids) values (d, ids) on conflict (day) do nothing;
  select question_ids into ids from quiz_days where day = d;
  return ids;
end $$;

-- Les jours déjà commencés gardent la série des parties en cours.
insert into public.quiz_days (day, question_ids)
  select distinct on (day) day, question_ids from public.quiz_runs
   where cardinality(question_ids) = 7 order by day, user_id
  on conflict (day) do nothing;

revoke execute on function public.quiz_rotation(date), public.quiz_day_questions(date) from public, anon, authenticated;
grant execute on function public.quiz_rotation(date), public.quiz_day_questions(date) to service_role;
