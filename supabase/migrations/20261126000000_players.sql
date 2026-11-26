-- VetQuiz : comptes, progression, amis, ligues, championnat des écoles.
-- Principes (voir docs/architecture.md) :
--   * minimisation : pas de nom réel, pas de date de naissance ; l'e-mail reste dans auth.users (géré par Supabase Auth) ;
--   * les scores et les cartes sont écrits par le serveur (fonction de correction), jamais par le navigateur ;
--   * un joueur ne lit directement que ses propres lignes ; les classements passent par des fonctions
--     qui ne renvoient que pseudo, école et scores ;
--   * la table des réponses servant au recalcul des niveaux ne contient aucun identifiant de joueur.
-- Le « jour » du quiz est le jour civil à Paris.

-- citext dans le schéma « extensions » (convention Supabase), hors du schéma public.
create schema if not exists extensions;
create extension if not exists citext with schema extensions;

-- ---------- Outils ----------
-- Code lisible sans caractères ambigus (pas de 0/O, 1/I).
create or replace function public.random_code(n int) returns text
  language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, n)
$$;

-- ---------- Référentiel ----------
create table public.schools (
  id     text primary key,
  name   text not null,
  city   text not null,
  region text not null,
  sort   int  not null
);

-- ---------- Profils ----------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  pseudo        extensions.citext not null unique check (pseudo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9_.-]{3,16}$'),
  school_id     text references public.schools (id) on delete set null,
  age15         boolean not null check (age15),          -- case déclarative « 15 ans ou plus »
  friend_code   text not null unique default ('VQ-' || public.random_code(4)),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()        -- pour la purge des comptes inactifs (2 ans)
);

-- ---------- Progression (écrite par le serveur) ----------
create table public.daily_results (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  score    smallint not null check (score between 0 and 35),
  tiers    smallint[] not null check (array_length(tiers, 1) = 7),  -- niveau obtenu (0 à 5) par question
  primary key (user_id, day)
);

create table public.cards_owned (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  card_id    text not null,
  obtained_on date not null,
  primary key (user_id, card_id)
);

-- ---------- Amis ----------
create table public.friendships (
  requester  uuid not null references public.profiles (id) on delete cascade,
  addressee  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- ---------- Ligues ----------
create table public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 3 and 28),
  invite_code text not null unique default ('LG-' || public.random_code(4)),
  owner_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index league_members_user on public.league_members (user_id);

-- ---------- Modération ----------
create table public.reports (
  id          bigint generated always as identity primary key,
  reporter    uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('pseudo', 'league')),
  target_id   uuid not null,
  reason      text check (char_length(reason) <= 500),
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now()
);

-- ---------- Réponses anonymes (recalcul des niveaux par fréquence) ----------
create table public.answer_log (
  id          bigint generated always as identity primary key,
  question_id text not null,
  day         date not null,            -- jour seulement, pas d'heure
  answer_norm text not null check (char_length(answer_norm) <= 120),
  tier        smallint not null check (tier between 0 and 5)
);
create index answer_log_q on public.answer_log (question_id, answer_norm);

-- Appartenance à une ligue (utilisée par les politiques ci-dessous ; security definer pour éviter la récursion).
create or replace function public.is_league_member(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_members where league_id = l and user_id = auth.uid());
$$;

-- =====================================================================
-- Sécurité au niveau des lignes : tout est fermé, puis ouvert au strict nécessaire.
-- =====================================================================
alter table public.schools        enable row level security;
alter table public.profiles       enable row level security;
alter table public.daily_results  enable row level security;
alter table public.cards_owned    enable row level security;
alter table public.friendships    enable row level security;
alter table public.leagues        enable row level security;
alter table public.league_members enable row level security;
alter table public.reports        enable row level security;
alter table public.answer_log     enable row level security;   -- aucune politique : serveur uniquement

create policy schools_read on public.schools for select to anon, authenticated using (true);

-- Comptes anonymes Supabase : ils n'ont pas de profil ni d'accès social.
create policy profiles_own_read   on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Seuls le pseudo et l'école sont modifiables par le joueur.
revoke update on public.profiles from authenticated;
grant  update (pseudo, school_id) on public.profiles to authenticated;

create policy results_own_read on public.daily_results for select to authenticated using (user_id = auth.uid());
create policy cards_own_read   on public.cards_owned   for select to authenticated using (user_id = auth.uid());

create policy friendships_read   on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

create policy leagues_member_read on public.leagues for select to authenticated
  using (public.is_league_member(id));
create policy league_members_read on public.league_members for select to authenticated
  using (public.is_league_member(league_id));

create policy reports_insert on public.reports for insert to authenticated with check (reporter = auth.uid());

-- =====================================================================
-- Fonctions appelées par le site (security definer : elles vérifient elles-mêmes auth.uid()).
-- =====================================================================

-- Lundi de la semaine de « day », semaine du lundi au dimanche.
create or replace function public.week_start(day date) returns date
  language sql immutable as $$ select (day - ((extract(isodow from day)::int - 1)))::date $$;

create or replace function public.paris_today() returns date
  language sql stable as $$ select (now() at time zone 'Europe/Paris')::date $$;

create or replace function public.me() returns uuid
  language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'non connecté' using errcode = '28000'; end if;
  return auth.uid();
end $$;

-- Mise à jour de la dernière connexion (appelée à l'ouverture du site).
create or replace function public.touch() returns void
  language sql security definer set search_path = public as $$
  update profiles set last_seen_at = now() where id = me();
$$;

-- ---------- Amis ----------
create or replace function public.send_friend_request(code text) returns text
  language plpgsql security definer set search_path = public as $$
declare target uuid; existing friendships;
begin
  select id into target from profiles where friend_code = upper(btrim(code));
  if target is null then return 'introuvable'; end if;
  if target = me() then return 'soi-meme'; end if;
  select * into existing from friendships
    where least(requester, addressee) = least(me(), target) and greatest(requester, addressee) = greatest(me(), target);
  if found then
    if existing.status = 'pending' and existing.addressee = me() then
      update friendships set status = 'accepted' where requester = existing.requester and addressee = existing.addressee;
      return 'accepte';
    end if;
    return 'deja';
  end if;
  insert into friendships (requester, addressee) values (me(), target);
  return 'envoye';
end $$;

create or replace function public.answer_friend_request(from_user uuid, accept boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if accept then
    update friendships set status = 'accepted' where requester = from_user and addressee = me() and status = 'pending';
  else
    delete from friendships where requester = from_user and addressee = me() and status = 'pending';
  end if;
end $$;

-- Liste d'amis et demandes : pseudo, école, score du jour, total de la semaine. Jamais l'e-mail.
create or replace function public.my_friends()
  returns table (user_id uuid, pseudo extensions.citext, school_id text, status text, incoming boolean, today smallint, week int)
  language sql stable security definer set search_path = public as $$
  with f as (
    select case when requester = me() then addressee else requester end as other,
           status, addressee = me() as incoming
    from friendships where me() in (requester, addressee)
  )
  select p.id, p.pseudo, p.school_id, f.status, f.incoming,
         (select r.score from daily_results r where r.user_id = p.id and r.day = paris_today() and f.status = 'accepted'),
         case when f.status = 'accepted' then
           (select coalesce(sum(r.score), 0)::int from daily_results r
             where r.user_id = p.id and r.day >= week_start(paris_today()) and r.day <= paris_today()) end
  from f join profiles p on p.id = f.other
  order by f.status, p.pseudo;
$$;

-- ---------- Ligues ----------
create or replace function public.create_league(league_name text) returns public.leagues
  language plpgsql security definer set search_path = public as $$
declare l leagues;
begin
  if (select count(*) from league_members where user_id = me()) >= 10 then
    raise exception '10 ligues au plus par joueur' using errcode = 'P0001';
  end if;
  insert into leagues (name, owner_id) values (regexp_replace(btrim(league_name), '\s+', ' ', 'g'), me()) returning * into l;
  insert into league_members (league_id, user_id) values (l.id, me());
  return l;
end $$;

create or replace function public.join_league(code text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare l uuid;
begin
  select id into l from leagues where invite_code = upper(btrim(code));
  if l is null then raise exception 'code inconnu' using errcode = 'P0002'; end if;
  if (select count(*) from league_members where user_id = me()) >= 10 then
    raise exception '10 ligues au plus par joueur' using errcode = 'P0001';
  end if;
  insert into league_members (league_id, user_id) values (l, me()) on conflict do nothing;
  return l;
end $$;

-- Quitter ; si l'administrateur part, la ligue passe au membre le plus ancien ; vide, elle est supprimée.
create or replace function public.leave_league(l uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare heir uuid;
begin
  delete from league_members where league_id = l and user_id = me();
  if (select owner_id from leagues where id = l) = me() then
    select user_id into heir from league_members where league_id = l order by joined_at limit 1;
    if heir is null then delete from leagues where id = l;
    else update leagues set owner_id = heir where id = l; end if;
  end if;
end $$;

create or replace function public.kick_from_league(l uuid, member uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if (select owner_id from leagues where id = l) is distinct from me() then
    raise exception 'réservé à l''administrateur de la ligue' using errcode = '42501';
  end if;
  if member = me() then raise exception 'utilisez leave_league' using errcode = 'P0001'; end if;
  delete from league_members where league_id = l and user_id = member;
end $$;

-- Classement de la semaine : somme des scores du lundi au dimanche, jour non joué = 0.
create or replace function public.league_ranking(l uuid, week date default null)
  returns table (rank bigint, user_id uuid, pseudo extensions.citext, school_id text, week_score int, is_me boolean)
  language sql stable security definer set search_path = public as $$
  with w as (select week_start(coalesce(week, paris_today())) as d0)
  select rank() over (order by coalesce(sum(r.score), 0) desc), p.id, p.pseudo, p.school_id,
         coalesce(sum(r.score), 0)::int, p.id = me()
  from league_members m
  join profiles p on p.id = m.user_id
  cross join w
  left join daily_results r on r.user_id = p.id and r.day between w.d0 and w.d0 + 6
  where m.league_id = l and is_league_member(l)
  group by p.id, p.pseudo, p.school_id
  order by 1, p.pseudo;
$$;

-- ---------- Championnat des écoles ----------
-- Score d'une école = moyenne des 10 meilleurs totaux hebdomadaires de ses joueurs ;
-- une école est classée à partir de 5 joueurs ayant joué au moins une fois dans la semaine.
create or replace function public.school_ranking(week date default null)
  returns table (rank bigint, school_id text, name text, city text, players bigint, score numeric)
  language sql stable security definer set search_path = public as $$
  with w as (select week_start(coalesce(week, paris_today())) as d0),
  totals as (
    select p.school_id, p.id, sum(r.score) as tot,
           row_number() over (partition by p.school_id order by sum(r.score) desc) as pos
    from profiles p
    join daily_results r on r.user_id = p.id
    cross join w
    where p.school_id is not null and r.day between w.d0 and w.d0 + 6
    group by p.school_id, p.id
  ),
  agg as (
    select school_id, count(*) as players, round(avg(tot) filter (where pos <= 10), 1) as score
    from totals group by school_id having count(*) >= 5
  )
  select rank() over (order by a.score desc), a.school_id, s.name, s.city, a.players, a.score
  from agg a join schools s on s.id = a.school_id
  order by 1, s.name;
$$;

-- ---------- Droits RGPD ----------
-- Export des données du joueur (accès et portabilité, art. 15 et 20).
create or replace function public.export_my_data() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exporte_le', now(),
    'email', (select email from auth.users where id = me()),
    'profil', (select to_jsonb(p) from profiles p where p.id = me()),
    'scores', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.day), '[]') from daily_results r where r.user_id = me()),
    'cartes', (select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' order by c.obtained_on), '[]') from cards_owned c where c.user_id = me()),
    'amis', (select coalesce(jsonb_agg(f.pseudo), '[]') from my_friends() f where f.status = 'accepted'),
    'ligues', (select coalesce(jsonb_agg(jsonb_build_object('nom', l.name, 'administrateur', l.owner_id = me())), '[]')
               from leagues l join league_members m on m.league_id = l.id where m.user_id = me())
  );
$$;

-- Suppression immédiate du compte (art. 17) : la cascade efface profil, scores, cartes, amitiés, adhésions.
create or replace function public.delete_my_account() returns void
  language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := me();
begin
  perform leave_league(l.id) from leagues l join league_members m on m.league_id = l.id where m.user_id = uid;
  delete from auth.users where id = uid;
end $$;

-- Purge des comptes inactifs depuis 2 ans (à planifier, par exemple avec pg_cron ;
-- l'e-mail d'avertissement 1 mois avant est envoyé par une tâche séparée).
create or replace function public.purge_inactive_accounts() returns int
  language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  delete from auth.users u using profiles p
   where p.id = u.id and p.last_seen_at < now() - interval '2 years';
  get diagnostics n = row_count;
  return n;
end $$;

-- Droits d'exécution : rien pour le public anonyme, seulement les fonctions utiles pour les joueurs connectés.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_league_member(uuid), public.touch(), public.send_friend_request(text), public.answer_friend_request(uuid, boolean), public.my_friends(),
  public.create_league(text), public.join_league(text), public.leave_league(uuid), public.kick_from_league(uuid, uuid),
  public.league_ranking(uuid, date), public.school_ranking(date), public.export_my_data(), public.delete_my_account()
  to authenticated;
revoke execute on function public.purge_inactive_accounts() from authenticated;
