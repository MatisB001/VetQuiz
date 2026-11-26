-- Tests de la partie du jour côté base : droits, rotation, tirage des cartes, purge, export.
-- Le déroulé d'une partie est testé avec la fonction de correction dans quiz_flow.test.mjs.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\o /dev/null
create function pg_temp.as_user(u uuid, anonymous boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'is_anonymous', anonymous)::text, false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'ÉCHEC : %', what; end if; raise notice 'ok : %', what; end $$;

insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000001', 'q1@exemple.fr'),
                                          ('10000000-0000-0000-0000-000000000002', 'q2@exemple.fr');
insert into auth.users (id, is_anonymous, created_at) values
  ('10000000-0000-0000-0000-0000000000a1', true, now() - interval '100 days'),  -- invité inactif
  ('10000000-0000-0000-0000-0000000000a2', true, now() - interval '100 days'),  -- invité qui joue encore
  ('10000000-0000-0000-0000-0000000000a3', true, now());                        -- invité récent
select public.quiz_state('10000000-0000-0000-0000-000000000001');
select public.quiz_state('10000000-0000-0000-0000-0000000000a2');

-- 1. Rotation identique à la maquette (8 questions de test : le 2e jour reprend à la 8e).
select pg_temp.check(public.quiz_day_questions('2026-11-26') = '{T1,T2,T3,T4,T5,T6,T7}', 'rotation : jour 1');
select pg_temp.check(public.quiz_day_questions('2026-11-27') = '{T8,T1,T2,T3,T4,T5,T6}', 'rotation : jour 2');
update public.questions set pos = -100 where id = 'T8';
select pg_temp.check(public.quiz_day_questions('2026-11-27') = '{T1,T2,T3,T4,T5,T6,T7}', 'question retirée : hors rotation');
update public.questions set pos = 7 where id = 'T8';

-- 2. Le navigateur d'un joueur connecté : ni questions, ni fonctions de partie, ni écriture.
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
do $$ begin perform count(*) from public.questions; raise exception 'ÉCHEC : questions lisibles';
exception when insufficient_privilege then raise notice 'ok : questions illisibles'; end $$;
do $$ begin perform public.quiz_state(auth.uid()); raise exception 'ÉCHEC : quiz_state exécutable';
exception when insufficient_privilege then raise notice 'ok : quiz_state réservé au serveur'; end $$;
do $$ begin perform public.quiz_answer(auth.uid(), 0, 5, 'x'); raise exception 'ÉCHEC : quiz_answer exécutable';
exception when insufficient_privilege then raise notice 'ok : quiz_answer réservé au serveur'; end $$;
do $$ begin perform public.quiz_accepted('T1'); raise exception 'ÉCHEC : quiz_accepted exécutable';
exception when insufficient_privilege then raise notice 'ok : quiz_accepted réservé au serveur'; end $$;
do $$ begin perform count(*) from public.answer_stats_review; raise exception 'ÉCHEC : statistiques lisibles';
exception when insufficient_privilege then raise notice 'ok : statistiques illisibles'; end $$;
do $$ begin update public.quiz_runs set answers = '[]' where user_id = auth.uid(); raise exception 'ÉCHEC : partie modifiable';
exception when insufficient_privilege then raise notice 'ok : partie non modifiable'; end $$;
do $$ begin insert into public.cards (id, tier, species) values ('x', 'l', 'dog'); raise exception 'ÉCHEC : carte créée';
exception when insufficient_privilege then raise notice 'ok : cartes non modifiables'; end $$;
select pg_temp.check((select count(*) from public.quiz_runs) = 1, 'partie : seulement la sienne');
select pg_temp.check((select count(*) from public.cards) > 0, 'cartes lisibles');

-- 3. Le public non connecté lit les cartes, rien d'autre.
reset role; set role anon;
select pg_temp.check((select count(*) from public.cards) > 0, 'anon : cartes lisibles');
do $$ begin perform count(*) from public.quiz_runs; raise exception 'ÉCHEC : anon lit les parties';
exception when insufficient_privilege then raise notice 'ok : anon sans parties'; end $$;

-- 4. Tirage : jamais une carte déjà possédée ; null quand le classeur est complet.
reset role; set role service_role;
insert into public.cards_owned (user_id, card_id, obtained_on)
select '10000000-0000-0000-0000-000000000002', id, '2026-01-01' from public.cards where id <> 'affen';
select pg_temp.check(public.quiz_draw('10000000-0000-0000-0000-000000000002', 0) = 'affen', 'tirage : la seule carte manquante');
select pg_temp.check(public.quiz_draw('10000000-0000-0000-0000-000000000002', 35) = 'affen', 'tirage : autre rareté si la sienne est complète');
insert into public.cards_owned values ('10000000-0000-0000-0000-000000000002', 'affen', '2026-01-01');
select pg_temp.check(public.quiz_draw('10000000-0000-0000-0000-000000000002', 20) is null, 'tirage : classeur complet');
select pg_temp.check((select count(distinct public.quiz_draw('10000000-0000-0000-0000-000000000001', 30)) from generate_series(1, 200)) > 20,
                     'tirage : cartes variées');
-- Avec 35 points (sachet légendaire), environ 15 % de légendaires attendus : on vérifie seulement qu'il en sort.
select pg_temp.check((select count(*) from (select public.quiz_draw('10000000-0000-0000-0000-000000000001', 35) as id
                                             from generate_series(1, 400)) d
                      join public.cards c using (id) where c.tier = 'l') between 20 and 110, 'tirage : légendaires présents au sachet légendaire');
select pg_temp.check((select count(*) from (select public.quiz_draw('10000000-0000-0000-0000-000000000001', 0) as id
                                             from generate_series(1, 400)) d
                      join public.cards c using (id) where c.tier = 'l') = 0, 'tirage : aucune légendaire au sachet commun');

-- 5. Un invité (session anonyme) peut avoir des scores et des cartes.
insert into public.daily_results values ('10000000-0000-0000-0000-0000000000a2', '2026-11-20', 10, '{1,1,2,2,2,1,1}');
insert into public.cards_owned values ('10000000-0000-0000-0000-0000000000a1', 'affen', '2026-10-01');
select pg_temp.check(true, 'invité : scores et cartes enregistrables');

-- 6. Purge des invités sans partie depuis 90 jours.
select pg_temp.check(public.purge_anonymous_sessions() = 1, 'purge : 1 invité inactif supprimé');
reset role;
select pg_temp.check(not exists (select 1 from auth.users where id = '10000000-0000-0000-0000-0000000000a1'), 'purge : le bon invité');
select pg_temp.check(not exists (select 1 from public.cards_owned where user_id = '10000000-0000-0000-0000-0000000000a1'), 'purge : ses cartes aussi');
select pg_temp.check((select count(*) from auth.users where id in ('10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a3')) = 2,
                     'purge : invités actifs ou récents gardés');

-- 7. Export RGPD : les parties y figurent.
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.check(jsonb_array_length(public.export_my_data() -> 'parties') = 1, 'export : parties incluses');
reset role;
\o
\echo '  Tests partie (base) passés.'
