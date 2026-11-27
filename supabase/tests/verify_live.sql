-- Vérification des règles d'accès sur le VRAI projet Supabase, à coller dans le SQL Editor.
-- Rien n'est conservé : le bloc se termine toujours par une erreur volontaire qui annule tout ce qu'il a fait,
-- et dont le message donne le résultat (« VÉRIFICATION : 22/22 ok » ou la liste des échecs).
do $$
declare
  u1 uuid := gen_random_uuid(); r text[] := '{}'; total int := 0; n bigint; j jsonb; t text;
begin
  insert into auth.users (id, email) values (u1, 'verification-' || left(u1::text, 8) || '@exemple.invalid');

  -- Fonctions de partie réservées au serveur (droits déclarés).
  foreach t in array array['public.quiz_state(uuid)', 'public.quiz_answer(uuid,integer,integer,text)', 'public.quiz_start(uuid,integer)',
                           'public.quiz_attempt(uuid)', 'public.purge_anonymous_sessions()', 'public.purge_inactive_accounts()',
                           'public.quiz_contest(uuid,integer,text)', 'public.quiz_share(uuid,integer)'] loop
    total := total + 2;
    if has_function_privilege('anon', t, 'execute') then r := r || ('anon peut exécuter ' || t); end if;
    if has_function_privilege('authenticated', t, 'execute') then r := r || ('authenticated peut exécuter ' || t); end if;
  end loop;

  -- Joueur connecté.
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  set local role authenticated;
  total := total + 1;
  begin insert into public.profiles (id, pseudo, age15) values (u1, 'Verif_' || left(replace(u1::text, '-', ''), 6), true);
  exception when others then r := r || ('profil non créé : ' || sqlerrm); end;
  total := total + 1; select count(*) into n from public.profiles;
  if n <> 1 then r := r || ('profils visibles : ' || n); end if;
  total := total + 1; select count(*) into n from public.schools;
  if n <> 73 then r := r || ('écoles : ' || n); end if;
  total := total + 1; select count(*) into n from public.cards;
  if n <> 252 then r := r || ('cartes : ' || n); end if;
  total := total + 1; select count(*) into n from public.cards where species = 'cat';
  if n <> 38 then r := r || ('chats : ' || n); end if;
  total := total + 1; select count(*) into n from public.cards where id = 'korat' and tier = 'c';
  if n <> 1 then r := r || 'rareté du Korat non mise à jour (seed_cards.sql)'::text; end if;
  total := total + 1;
  begin insert into public.daily_results (user_id, day, score, tiers) values (u1, '2026-01-01', 35, '{5,5,5,5,5,5,5}');
        r := r || 'score écrit depuis le navigateur'::text;
  exception when insufficient_privilege then null; end;
  total := total + 1;
  begin perform count(*) from public.questions; r := r || 'questions lisibles'::text;
  exception when insufficient_privilege then null; end;
  total := total + 1;
  begin perform public.quiz_state(u1); r := r || 'quiz_state exécutable par un joueur'::text;
  exception when insufficient_privilege then null; end;
  total := total + 1;
  begin perform count(*) from public.answer_stats; r := r || 'statistiques lisibles'::text;
  exception when insufficient_privilege then null; end;
  total := total + 1;
  begin perform count(*) from public.answer_review; r := r || 'liste de revue lisible par un joueur'::text;
  exception when insufficient_privilege then null;
            when undefined_table then r := r || 'liste de revue absente (migration 20261127010000_contestations.sql)'::text; end;
  total := total + 1;
  begin if public.send_friend_request('VQ-ZZZZ') <> 'introuvable' then r := r || 'demande d''ami : réponse inattendue'::text; end if;
  exception when others then r := r || ('amis : ' || sqlerrm); end;
  total := total + 1;
  begin perform public.create_league('Ligue de vérification');
        select count(*) into n from public.leagues; if n <> 1 then r := r || ('ligues visibles : ' || n); end if;
  exception when others then r := r || ('ligue : ' || sqlerrm); end;
  total := total + 1;
  begin perform public.school_ranking(); exception when others then r := r || ('classement des écoles : ' || sqlerrm); end;
  total := total + 1;
  begin j := public.export_my_data(); if not (j ? 'parties') then r := r || 'export sans les parties'::text; end if;
  exception when others then r := r || ('export : ' || sqlerrm); end;

  -- Visiteur non connecté.
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  total := total + 1; select count(*) into n from public.schools;
  if n <> 73 then r := r || ('anon, écoles : ' || n); end if;
  total := total + 1;
  begin select count(*) into n from public.profiles; if n <> 0 then r := r || ('anon voit ' || n || ' profils'); end if;
  exception when insufficient_privilege then null; end;
  total := total + 1;
  begin perform count(*) from public.quiz_runs; r := r || 'anon lit les parties'::text;
  exception when insufficient_privilege then null; end;
  total := total + 1;
  begin perform public.school_ranking(); r := r || 'anon exécute school_ranking'::text;
  exception when insufficient_privilege then null; end;

  -- Serveur (fonction de correction).
  set local role service_role;
  total := total + 1;
  begin j := public.quiz_state(u1);
        if (j ->> 'next')::int <> 0 or jsonb_array_length(j -> 'questions') <> 0 then r := r || 'quiz_state : état inattendu'::text; end if;
        total := total + 1;
        if jsonb_array_length(coalesce(j -> 'themes', '[]')) <> 7 then r := r || 'quiz_state : thèmes du jour absents (migration 20261126030000_themes.sql)'::text; end if;
  exception when others then r := r || ('quiz_state (serveur) : ' || sqlerrm); end;
  total := total + 1;
  begin if (select question_ids from public.quiz_days where day = public.paris_today())
            is distinct from (select question_ids from public.quiz_runs where user_id = u1 and day = public.paris_today())
        then r := r || 'questions du jour non figées'::text; end if;
  exception when others then r := r || ('questions du jour figées (migration 20261126040000_jour_fige.sql) : ' || sqlerrm); end;
  total := total + 1;
  begin if public.quiz_contest(u1, 0, 'verification') is not false or (select count(*) from public.answer_review) < 0
        then r := r || 'signalement : réponse inattendue'::text; end if;
  exception when others then r := r || ('signalements (migration 20261127010000_contestations.sql) : ' || sqlerrm); end;
  total := total + 1;
  begin if public.quiz_share(u1, 0) is not null then r := r || 'part des joueurs : réponse inattendue'::text; end if;
  exception when others then r := r || ('part des joueurs (migration 20261127020000_part_reponses.sql) : ' || sqlerrm); end;

  raise exception 'VÉRIFICATION (rien n''a été conservé) : %',
    case when cardinality(r) = 0 then total || '/' || total || ' ok'
         else (total - cardinality(r)) || '/' || total || ' ok ; ÉCHECS : ' || array_to_string(r, ' ; ') end;
end $$;
