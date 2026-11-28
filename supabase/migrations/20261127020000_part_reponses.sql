-- « X % des joueurs ont répondu cela » (décision de Seb, 27/11/2026, sur le modèle de Zebra) : après une réponse
-- acceptée, la part des joueurs du jour qui ont donné la même réponse acceptée à cette question.
-- Les niveaux restent fixés par expert : ce chiffre est seulement affiché, il ne change aucun point.
-- Calcul sur les parties du jour (quiz_runs) : tout le monde a les mêmes 7 questions (quiz_days). On ne renvoie
-- que deux nombres (même réponse, total), jamais qui a répondu quoi.
-- Fichier rejouable sans erreur (if not exists, create or replace).

create index if not exists quiz_runs_day on public.quiz_runs (day);

-- Pour le joueur uid et la question qi de sa partie du jour : nombre de joueurs du jour ayant donné la même
-- réponse acceptée (lui compris) et nombre de joueurs ayant terminé cette question. Nul si sa réponse
-- n'a pas été acceptée ou si la question n'est pas terminée.
create or replace function public.quiz_share(uid uuid, qi int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare r quiz_runs; lab text; same int; total int;
begin
  if qi is null or qi < 0 or qi > 6 then return null; end if;
  select * into r from quiz_runs where user_id = uid and day = paris_today();
  if not found or jsonb_array_length(r.answers) <= qi then return null; end if;
  lab := r.answers -> qi ->> 'label';
  if lab is null then return null; end if;
  select count(*) filter (where q.answers -> qi ->> 'label' = lab), count(*)
    into same, total
    from quiz_runs q
   where q.day = r.day and jsonb_array_length(q.answers) > qi and q.question_ids[qi + 1] = r.question_ids[qi + 1];
  return jsonb_build_object('same', same, 'total', total, 'pct', round(100.0 * same / greatest(total, 1)));
end $$;

revoke execute on function public.quiz_share(uuid, int) from public, anon, authenticated;
grant execute on function public.quiz_share(uuid, int) to service_role;
