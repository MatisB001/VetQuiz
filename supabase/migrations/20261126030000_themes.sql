-- Accueil : les thèmes (domaines) des 7 questions du jour, comme dans la maquette, sans le texte des questions.
-- Fichier rejouable sans erreur (create or replace).
create or replace function public.quiz_state(uid uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs; d date := paris_today(); n int;
begin
  if (select count(*) from questions where pos >= 0) < 7 then raise exception 'base de questions vide' using errcode = 'P0001'; end if;
  insert into quiz_runs (user_id, day, question_ids) values (uid, d, quiz_day_questions(d)) on conflict do nothing;
  perform quiz_expire(uid);
  select * into r from quiz_runs where user_id = uid and day = d;
  n := jsonb_array_length(r.answers);
  return jsonb_build_object(
    'day', d,
    'answers', r.answers,
    -- domaines des 7 questions (thèmes affichés à l'accueil, comme la maquette), sans leur texte
    'themes', (select jsonb_agg(q.dom order by x.i) from unnest(r.question_ids) with ordinality x(id, i) join questions q on q.id = x.id),
    'next', n,
    -- questions déjà vues : celles répondues et celle en cours
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('qi', x.i - 1, 'id', q.id, 'dom', q.dom, 'q', q.q)
                          || case when quiz_reveal() = 'now' and x.i <= n then jsonb_build_object('accepted', quiz_accepted(q.id))
                                  else '{}'::jsonb end order by x.i), '[]')
                  from unnest(r.question_ids) with ordinality x(id, i) join questions q on q.id = x.id
                  where x.i <= n or x.i - 1 = r.current_qi),
    'current', case when r.current_qi is not null then jsonb_build_object(
                 'qi', r.current_qi, 'started_at', r.started_at,
                 'deadline', r.started_at + interval '30 seconds', 'now', now()) end,
    'done', r.done,
    'score', (select score from daily_results where user_id = uid and day = d),
    'card_id', r.card_id);
end $$;
