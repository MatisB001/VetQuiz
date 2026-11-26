-- VetQuiz : partie du jour corrigée côté serveur.
-- Le navigateur ne reçoit jamais les réponses acceptées d'une question en cours, ni le texte d'une question
-- avant qu'il la démarre. Il demande la question, le serveur note l'heure de début, puis la fonction Edge « quiz »
-- corrige chaque essai (même moteur que la maquette) et appelle les fonctions ci-dessous, réservées au rôle
-- service_role. Les joueurs sans compte jouent avec une session anonyme Supabase.

-- Les scores et les cartes appartiennent à l'utilisateur Supabase (compte complet ou session anonyme),
-- pas seulement aux profils : d'après la documentation Supabase, une session anonyme devient un compte
-- en lui liant une identité (e-mail), elle garde donc ses parties et ses cartes.
alter table public.daily_results drop constraint daily_results_user_id_fkey,
  add constraint daily_results_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.cards_owned drop constraint cards_owned_user_id_fkey,
  add constraint cards_owned_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;

-- ---------- Réglages (provisoires, modifiables en redéfinissant la fonction) ----------
-- 30 secondes par question, plus 3 secondes de marge pour le réseau.
create or replace function public.quiz_limit() returns interval language sql immutable as $$ select interval '33 seconds' $$;
-- Essais par question : la maquette n'a pas de limite ; celle-ci empêche d'essayer un dictionnaire entier.
create or replace function public.quiz_max_tries() returns int language sql immutable as $$ select 20 $$;
-- Liste des réponses acceptées : 'tomorrow' (le lendemain) ou 'now' (juste après la question, comme la maquette).
create or replace function public.quiz_reveal() returns text language sql immutable as $$ select 'tomorrow' $$;

-- ---------- Questions (jamais lisibles par le navigateur) ----------
create table public.questions (
  id      text primary key,
  pos     int  not null unique,          -- ordre de rotation (ordre de questions.json) ; négatif = retirée
  dom     text not null,                 -- domaine (thème affiché)
  q       text not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) > 0)
                                         -- [[libellé, niveau 1-5, nom du niveau, [synonymes]], …]
);
alter table public.questions enable row level security;   -- aucune politique : serveur uniquement

-- ---------- Cartes (publiques : elles sont affichées dans le classeur) ----------
-- Seules les cartes qui ont un dessin peuvent sortir d'un sachet (comme dans la maquette).
create table public.cards (
  id      text primary key,
  tier    text not null check (tier in ('c', 'r', 'e', 'l')),
  species text not null check (species in ('dog', 'cat'))
);
alter table public.cards enable row level security;
create policy cards_read on public.cards for select to anon, authenticated using (true);
alter table public.cards_owned add constraint cards_owned_card_id_fkey foreign key (card_id) references public.cards (id);

-- ---------- Partie du jour ----------
create table public.quiz_runs (
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  question_ids text[] not null check (array_length(question_ids, 1) = 7),
  answers      jsonb not null default '[]',   -- [{tier, label}] dans l'ordre des questions
  current_qi   smallint,                      -- question démarrée et pas encore répondue
  started_at   timestamptz,                   -- début de cette question (horloge du serveur)
  tries        smallint not null default 0,   -- essais sur cette question
  done         boolean not null default false,
  card_id      text references public.cards (id),
  primary key (user_id, day)
);
alter table public.quiz_runs enable row level security;
create policy quiz_runs_own_read on public.quiz_runs for select to authenticated using (user_id = auth.uid());

-- Rotation identique à la maquette : jour 1 = 26/11/2026, 7 questions par jour, dans l'ordre de « pos ».
-- Une question retirée garde une position négative : elle sort de la rotation, les anciennes parties la retrouvent.
create or replace function public.quiz_day_questions(d date) returns text[]
  language sql stable set search_path = public as $$
  with q as (select id, row_number() over (order by pos) - 1 as k, count(*) over () as n from questions where pos >= 0)
  select array_agg(q.id order by i)
  from generate_series(0, 6) i
  join q on q.k = (((d - date '2026-11-26') * 7 + i) % q.n + q.n) % q.n;
$$;

-- Réponses acceptées d'une question, sans les synonymes : [[libellé, niveau], …]
create or replace function public.quiz_accepted(qid text) returns jsonb
  language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(a -> 0, a -> 1) order by o), '[]')
  from questions, jsonb_array_elements(answers) with ordinality x(a, o) where id = qid;
$$;

-- Tirage d'une carte non possédée, selon le sachet gagné (seuils et probabilités de la maquette, provisoires).
create or replace function public.quiz_draw(uid uuid, score int) returns text
  language plpgsql security definer set search_path = public as $$
declare
  odds int[] := case when score >= 21 then array[15, 35, 35, 15]
                     when score >= 14 then array[35, 38, 21, 6]
                     when score >= 7  then array[55, 33, 10, 2]
                     else array[75, 22, 3, 0] end;
  tiers text[] := array['c', 'r', 'e', 'l'];
  x numeric := random() * 100; t int := 4; k int; seq int[]; c text;
begin
  for i in 1..4 loop
    if x < odds[i] then t := i; exit; end if;
    x := x - odds[i];
  end loop;
  -- Rareté tirée, puis les raretés inférieures, puis supérieures (comme la maquette).
  seq := array[t];
  for k in reverse t - 1 .. 1 loop seq := seq || k; end loop;
  for k in t + 1 .. 4 loop seq := seq || k; end loop;
  foreach k in array seq loop
    select id into c from cards
     where tier = tiers[k] and id not in (select card_id from cards_owned where user_id = uid)
     order by random() limit 1;
    if c is not null then return c; end if;
  end loop;
  return null;   -- classeur complet
end $$;

-- Enregistre la réponse finale de la question en cours. Au-delà du temps, elle vaut 0 quoi qu'il arrive.
-- À la 7e réponse : score du jour, tirage de la carte, fin de partie.
create or replace function public.quiz_answer(uid uuid, qi int, tier int, label text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs; t int := greatest(0, least(5, coalesce(tier, 0))); total int; card text; res jsonb;
begin
  select * into r from quiz_runs where user_id = uid and day = paris_today() for update;
  if not found or r.done then raise exception 'pas de partie en cours' using errcode = 'P0001'; end if;
  if r.current_qi is distinct from qi or qi <> jsonb_array_length(r.answers) then
    raise exception 'question hors ordre' using errcode = 'P0001';
  end if;
  if now() - r.started_at > quiz_limit() then t := 0; end if;
  if t = 0 then label := null; end if;
  r.answers := r.answers || jsonb_build_array(jsonb_build_object('tier', t, 'label', label));
  update quiz_runs set answers = r.answers, current_qi = null, started_at = null, tries = 0
   where user_id = uid and day = r.day;
  res := jsonb_build_object('qi', qi, 'tier', t, 'label', label, 'done', false);
  if quiz_reveal() = 'now' then res := res || jsonb_build_object('accepted', quiz_accepted(r.question_ids[qi + 1])); end if;
  if jsonb_array_length(r.answers) < 7 then return res; end if;
  select sum((a ->> 'tier')::int) into total from jsonb_array_elements(r.answers) a;
  insert into daily_results (user_id, day, score, tiers)
    values (uid, r.day, total, array(select (a ->> 'tier')::smallint from jsonb_array_elements(r.answers) a));
  card := quiz_draw(uid, total);
  if card is not null then insert into cards_owned (user_id, card_id, obtained_on) values (uid, card, r.day); end if;
  update quiz_runs set done = true, card_id = card where user_id = uid and day = r.day;
  return res || jsonb_build_object('done', true, 'score', total, 'card_id', card);
end $$;

-- Une question démarrée puis abandonnée (onglet fermé) vaut 0 une fois le temps écoulé.
create or replace function public.quiz_expire(uid uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs;
begin
  select * into r from quiz_runs where user_id = uid and day = paris_today() and not done
     and current_qi is not null and now() - started_at > quiz_limit();
  if found then perform quiz_answer(uid, r.current_qi, 0, null); end if;
end $$;

-- État de la partie du jour. Crée la partie si besoin. Ne contient ni réponse acceptée d'une question
-- en cours, ni le texte d'une question pas encore démarrée.
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

-- Démarre le chronomètre de la question qi et renvoie son texte. Recharger la page ne le remet pas à zéro.
create or replace function public.quiz_start(uid uuid, qi int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs; qq questions;
begin
  perform quiz_expire(uid);
  select * into r from quiz_runs where user_id = uid and day = paris_today() for update;
  if not found or r.done then raise exception 'pas de partie en cours' using errcode = 'P0001'; end if;
  if qi <> jsonb_array_length(r.answers) then raise exception 'question hors ordre' using errcode = 'P0001'; end if;
  if r.current_qi is distinct from qi then
    update quiz_runs set current_qi = qi, started_at = now(), tries = 0
     where user_id = uid and day = r.day returning * into r;
  end if;
  select * into qq from questions where id = r.question_ids[qi + 1];
  return jsonb_build_object('qi', qi, 'id', qq.id, 'dom', qq.dom, 'q', qq.q, 'started_at', r.started_at,
                            'deadline', r.started_at + interval '30 seconds', 'now', now());
end $$;

-- Un essai sur la question en cours : compte l'essai et renvoie la question avec ses réponses,
-- pour que la fonction Edge corrige. Rien (null) si aucune question n'est en cours.
create or replace function public.quiz_attempt(uid uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs; qq questions;
begin
  update quiz_runs set tries = tries + 1
   where user_id = uid and day = paris_today() and not done
     and current_qi is not null and current_qi = jsonb_array_length(answers)
  returning * into r;
  if not found then return null; end if;
  select * into qq from questions where id = r.question_ids[r.current_qi + 1];
  return jsonb_build_object('qi', r.current_qi, 'tries', r.tries,
                            'expired', now() - r.started_at > quiz_limit(),
                            'too_many', r.tries > quiz_max_tries(),
                            'question', jsonb_build_object('id', qq.id, 'q', qq.q, 'answers', qq.answers));
end $$;

-- Réponses acceptées des questions d'une partie terminée, quand le réglage le permet.
create or replace function public.quiz_review(uid uuid, d date) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r quiz_runs;
begin
  select * into r from quiz_runs where user_id = uid and day = d;
  if not found or (d >= paris_today() and not (quiz_reveal() = 'now' and r.done)) then return null; end if;
  return (select jsonb_agg(jsonb_build_object('qi', x.i - 1, 'id', q.id, 'dom', q.dom, 'q', q.q,
                                              'accepted', quiz_accepted(q.id), 'mine', r.answers -> (x.i::int - 1))
                           order by x.i)
          from unnest(r.question_ids) with ordinality x(id, i) join questions q on q.id = x.id);
end $$;

-- Statistiques des réponses, pour recalculer les niveaux (réponses acceptées) et enrichir les synonymes (essais
-- refusés) : un compteur par réponse, sans identifiant ni date. Remplace answer_log, une ligne datée par réponse,
-- qu'on pouvait recouper avec quiz_runs pour retrouver un joueur (avis du fil RGPD, 26/11/2026).
drop table public.answer_log;
create table public.answer_stats (
  question_id text not null,
  accepted    boolean not null,              -- vrai : libellé de la réponse acceptée ; faux : essai refusé, normalisé
  answer      text not null check (char_length(answer) between 1 and 120),
  tier        smallint not null check (tier between 0 and 5),
  n           int not null default 1,
  primary key (question_id, accepted, answer)
);
alter table public.answer_stats enable row level security;   -- aucune politique : serveur uniquement

create or replace function public.quiz_log(question_id text, answer text, tier int, accepted boolean) returns void
  language sql security definer set search_path = public as $$
  insert into answer_stats as s (question_id, accepted, answer, tier)
  select question_id, accepted, left(answer, 120), greatest(0, least(5, tier))
  where coalesce(answer, '') <> ''
  on conflict (question_id, accepted, answer) do update set n = s.n + 1, tier = excluded.tier;
$$;

-- Sessions anonymes : Supabase ne les supprime pas lui-même. On efface celles qui n'ont joué aucune partie
-- depuis 90 jours, avec leurs scores et leurs cartes (durée provisoire, choix de Seb attendu). À planifier.
create or replace function public.purge_anonymous_sessions() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from auth.users u
   where u.is_anonymous is true and u.created_at < now() - interval '90 days'
     and not exists (select 1 from quiz_runs r where r.user_id = u.id and r.day > paris_today() - 90);
  get diagnostics n = row_count;
  return n;
end $$;

-- Droits sur les tables, explicites, sans dépendre du réglage « accès API automatique » de Supabase :
-- lecture seule pour le navigateur, aucune écriture des scores, cartes, parties ni questions.
revoke all on public.questions, public.quiz_runs, public.cards, public.cards_owned, public.daily_results,
  public.answer_stats from anon, authenticated;
grant select on public.cards to anon, authenticated;
grant select on public.quiz_runs, public.cards_owned, public.daily_results to authenticated;
grant all on public.questions, public.quiz_runs, public.cards, public.cards_owned, public.daily_results,
  public.answer_stats to service_role;

-- Export RGPD : on ajoute les parties (niveau et réponse retenue pour chaque question).
create or replace function public.export_my_data() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exporte_le', now(),
    'email', (select email from auth.users where id = me()),
    'profil', (select to_jsonb(p) from profiles p where p.id = me()),
    'scores', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.day), '[]') from daily_results r where r.user_id = me()),
    'parties', (select coalesce(jsonb_agg(jsonb_build_object('jour', r.day, 'questions', r.question_ids, 'reponses', r.answers,
                                                             'carte', r.card_id) order by r.day), '[]')
                from quiz_runs r where r.user_id = me()),
    'cartes', (select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' order by c.obtained_on), '[]') from cards_owned c where c.user_id = me()),
    'amis', (select coalesce(jsonb_agg(f.pseudo), '[]') from my_friends() f where f.status = 'accepted'),
    'ligues', (select coalesce(jsonb_agg(jsonb_build_object('nom', l.name, 'administrateur', l.owner_id = me())), '[]')
               from leagues l join league_members m on m.league_id = l.id where m.user_id = me())
  );
$$;

-- Ces fonctions prennent l'identifiant du joueur en paramètre : elles sont réservées au serveur.
revoke execute on function public.quiz_state(uuid), public.quiz_start(uuid, int), public.quiz_attempt(uuid),
  public.quiz_expire(uuid), public.quiz_draw(uuid, int), public.quiz_answer(uuid, int, int, text),
  public.quiz_review(uuid, date), public.quiz_log(text, text, int, boolean), public.quiz_day_questions(date),
  public.quiz_accepted(text), public.purge_anonymous_sessions()
  from public, anon, authenticated;
grant execute on function public.quiz_state(uuid), public.quiz_start(uuid, int), public.quiz_attempt(uuid),
  public.quiz_expire(uuid), public.quiz_draw(uuid, int), public.quiz_answer(uuid, int, int, text),
  public.quiz_review(uuid, date), public.quiz_log(text, text, int, boolean), public.quiz_day_questions(date),
  public.quiz_accepted(text), public.purge_anonymous_sessions()
  to service_role;
