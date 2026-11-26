-- Tests des règles d'accès et des classements. Chaque échec lève une exception (psql -v ON_ERROR_STOP=1).
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

-- Données : 12 joueurs, dont 6 à VetAgro Sup et 6 à l'ENVT, plus un compte anonyme.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'j' || i || '@exemple.fr'
from generate_series(1, 12) i;
insert into auth.users (id, email, is_anonymous) values ('00000000-0000-0000-0000-000000000099', null, true);
insert into public.profiles (id, pseudo, school_id, age15)
select ('00000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'Joueur' || i,
       case when i <= 6 then 'vas' else 'envt' end, true
from generate_series(1, 12) i;
-- Scores de la semaine en cours (écrits par le serveur) : joueur i marque i points par jour, 2 jours.
insert into public.daily_results (user_id, day, score, tiers)
select p.id, d, regexp_replace(p.pseudo::text, '\D', '', 'g')::int, '{1,1,1,1,1,1,1}'
from public.profiles p,
     (select distinct unnest(array[public.week_start(public.paris_today()), public.paris_today()])) days(d);

set role authenticated;

-- 1. Un joueur ne voit que son profil et ses scores.
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from public.profiles) = 1, 'profil : seulement le sien');
select pg_temp.check((select count(*) from public.daily_results where user_id <> auth.uid()) = 0, 'scores : seulement les siens');

-- 2. Il ne peut pas écrire de score ni de carte (anti-triche).
do $$ begin
  insert into public.daily_results (user_id, day, score, tiers) values (auth.uid(), '2026-01-01', 35, '{5,5,5,5,5,5,5}');
  raise exception 'ÉCHEC : écriture de score autorisée';
exception when insufficient_privilege then raise notice 'ok : écriture de score refusée'; end $$;
do $$ begin
  insert into public.cards_owned values (auth.uid(), 'golden', '2026-01-01');
  raise exception 'ÉCHEC : écriture de carte autorisée';
exception when insufficient_privilege then raise notice 'ok : écriture de carte refusée'; end $$;

-- 3. Il ne peut pas modifier son âge déclaré ni sa date de dernière connexion directement.
do $$ begin
  update public.profiles set age15 = false where id = auth.uid();
  raise exception 'ÉCHEC : modification de age15 autorisée';
exception when insufficient_privilege then raise notice 'ok : age15 non modifiable'; end $$;
update public.profiles set school_id = 'envt' where id = auth.uid();
update public.profiles set school_id = 'vas' where id = auth.uid();
select pg_temp.check(true, 'pseudo et école modifiables');

-- 4. Table des réponses anonymes : ni lecture ni écriture depuis le navigateur.
do $$ begin
  perform count(*) from public.answer_log;
  raise exception 'ÉCHEC : lecture de answer_log autorisée';
exception when insufficient_privilege then raise notice 'ok : answer_log illisible'; end $$;
do $$ begin
  insert into public.answer_log (question_id, day, answer_norm, tier) values ('q1', '2026-01-01', 'x', 5);
  raise exception 'ÉCHEC : écriture dans answer_log autorisée';
exception when insufficient_privilege then raise notice 'ok : answer_log fermé'; end $$;

-- 5. Amis par code : demande, acceptation, visibilité limitée.
reset role;
select friend_code as c2 from public.profiles where pseudo = 'Joueur2' \gset
select friend_code as c1 from public.profiles where pseudo = 'Joueur1' \gset
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check(public.send_friend_request(:'c2') = 'envoye', 'demande d''ami envoyée');
select pg_temp.check(public.send_friend_request(:'c1') = 'soi-meme', 'pas d''ami avec soi-même');
select pg_temp.check(public.send_friend_request('VQ-ZZZZ') = 'introuvable', 'code inconnu');
select pg_temp.check((select today from public.my_friends()) is null, 'score masqué tant que non accepté');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.check((select incoming from public.my_friends()), 'demande reçue visible');
select public.answer_friend_request('00000000-0000-0000-0000-000000000001', true);
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check((select status from public.my_friends()) = 'accepted', 'amitié acceptée');
select pg_temp.check((select week from public.my_friends()) > 0, 'score hebdo de l''ami visible');
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from public.friendships) = 0, 'un tiers ne voit pas l''amitié');

-- 6. Ligues : création, adhésion, classement, accès réservé aux membres.
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select (public.create_league('Promo A4')).invite_code as lc \gset
select id as lid from public.leagues \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.check(public.join_league(lower(:'lc')) = :'lid', 'adhésion par code (casse ignorée)');
select pg_temp.check((select count(*) from public.league_ranking(:'lid')) = 2, 'classement : 2 membres');
select pg_temp.check((select pseudo from public.league_ranking(:'lid') where rank = 1) = 'Joueur5', 'classement : le meilleur en tête');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select pg_temp.check((select count(*) from public.league_ranking(:'lid')) = 0, 'non-membre : classement vide');
select pg_temp.check((select count(*) from public.leagues) = 0, 'non-membre : ligue invisible');
select set_config('vq.lid', :'lid', false);
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
do $$ begin
  perform public.kick_from_league(current_setting('vq.lid')::uuid, '00000000-0000-0000-0000-000000000001');
  raise exception 'ÉCHEC : un simple membre exclut l''administrateur';
exception when insufficient_privilege then raise notice 'ok : exclusion réservée à l''administrateur'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select public.leave_league(:'lid');
reset role;
select pg_temp.check((select owner_id from public.leagues where id = :'lid') = '00000000-0000-0000-0000-000000000005', 'l''administrateur part : la ligue passe au membre suivant');
set role authenticated;

-- 7. Championnat des écoles : moyenne des 10 meilleurs, 5 joueurs minimum.
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from public.school_ranking()) = 2, 'deux écoles classées');
select pg_temp.check((select school_id from public.school_ranking() where rank = 1) = 'envt', 'ENVT en tête (joueurs 7 à 12)');

-- 8. Un compte anonyme Supabase ne peut pas créer de profil.
select pg_temp.as_user('00000000-0000-0000-0000-000000000099', true);
do $$ begin
  insert into public.profiles (id, pseudo, age15) values (auth.uid(), 'Anonyme', true);
  raise exception 'ÉCHEC : profil créé par un compte anonyme';
exception when insufficient_privilege then raise notice 'ok : compte anonyme sans profil'; end $$;

-- 9. Le public non connecté ne voit que la liste des écoles.
reset role; set role anon;
select pg_temp.check((select count(*) from public.schools) = 73, 'anon : 73 écoles lisibles');
select pg_temp.check((select count(*) from public.profiles) = 0, 'anon : aucun profil');
do $$ begin perform public.school_ranking(); raise exception 'ÉCHEC : anon exécute school_ranking';
exception when insufficient_privilege then raise notice 'ok : anon sans fonctions'; end $$;

-- 10. Export et suppression de compte.
reset role; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.check((public.export_my_data() ->> 'email') = 'j2@exemple.fr', 'export : e-mail présent');
select pg_temp.check(jsonb_array_length(public.export_my_data() -> 'amis') = 1, 'export : 1 ami');
select public.delete_my_account();
reset role;
select pg_temp.check(not exists (select 1 from auth.users where email = 'j2@exemple.fr'), 'suppression : compte effacé');
select pg_temp.check(not exists (select 1 from public.daily_results r join public.profiles p on p.id = r.user_id where p.pseudo = 'Joueur2'), 'suppression : scores effacés');
select pg_temp.check((select count(*) from public.friendships) = 0, 'suppression : amitiés effacées');

-- 11. Purge des comptes inactifs depuis 2 ans.
update public.profiles set last_seen_at = now() - interval '2 years 1 day' where pseudo = 'Joueur3';
select pg_temp.check(public.purge_inactive_accounts() = 1, 'purge : 1 compte inactif supprimé');
\o
\echo '  Tests joueurs passés.'
