-- MapRinger friends, on top of the shared Game Rabbit friends (gamerabbit_profiles,
-- gamerabbit_friends, gamerabbit_is_friend(): Kowloon_Dragons/supabase/friends.sql, which
-- must be applied first). One friend list and one friend code for every Game Rabbit game;
-- this file only adds what MapRinger friends can see of each other. It doesn't change the
-- shared tables. Safe to re-run.
--
-- Apply after schema.sql:  PG_DIR=... node scripts/apply_schema.mjs supabase/friends.sql
--
-- What a friend can see (enforced here, not in the browser):
--  - Your scores, always: every ring's points, level, map and quest, but never where you put
--    it (mapringer_friend_rings strips the location out).
--  - Where you put today's rings, only once they've finished all three of today's rings
--    themselves, only for today, and only if you haven't hidden your spots
--    (mapringer_friend_today). Past days' spots stay private.
--  - Nobody else sees anything: both functions refuse anyone who isn't your friend.

-- ---------- your own MapRinger settings ----------
create table if not exists public.mapringer_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  hide_rings boolean not null default false, -- friends see your scores but not where your rings were
  updated_at timestamptz not null default now()
);
alter table public.mapringer_settings enable row level security;

drop policy if exists "read own settings" on public.mapringer_settings;
create policy "read own settings" on public.mapringer_settings
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "add own settings" on public.mapringer_settings;
create policy "add own settings" on public.mapringer_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "change own settings" on public.mapringer_settings;
create policy "change own settings" on public.mapringer_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.mapringer_settings from anon, authenticated;
grant select on public.mapringer_settings to authenticated;
grant insert (user_id, hide_rings, updated_at) on public.mapringer_settings to authenticated;
grant update (hide_rings, updated_at) on public.mapringer_settings to authenticated;

-- ---------- today's day number ----------
-- The game numbers days by the player's own local date (puzzle.ts puzzleNumber: 1 = launch
-- day, 2026-11-09). Time zones run about a day either side of UTC, so "today" for some
-- player is always within one of UTC's day number.
create or replace function public.mapringer_utc_day() returns integer
language sql stable set search_path = public as $$
  select ((now() at time zone 'utc')::date - date '2026-11-09') + 1;
$$;

-- ---------- a friend's scores (no locations) ----------
-- Every ring a friend has played, for their stats: the saved result without lng / lat.
create or replace function public.mapringer_friend_rings(friend uuid)
returns table (day integer, stage smallint, points integer, map text, result jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.gamerabbit_is_friend(auth.uid(), friend) then
    raise exception 'not friends';
  end if;
  return query
    select r.day, r.stage, r.points, r.map, r.result - 'lng' - 'lat'
    from public.mapringer_rings r where r.user_id = friend order by r.day, r.stage;
end $$;

-- ---------- where a friend put today's rings ----------
-- { status, rings }: status is
--   'ok'        rings = the friend's rings for `today` (with lng / lat)
--   'locked'    you haven't finished all three of today's rings yet
--   'hidden'    the friend keeps their spots private
--   'none'      the friend hasn't played today
-- `today` is the caller's local day number; it must be within one of UTC's (so past days
-- can't be asked for).
create or replace function public.mapringer_friend_today(friend uuid, today integer) returns json
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); utc integer := public.mapringer_utc_day();
begin
  if me is null or not public.gamerabbit_is_friend(me, friend) then
    raise exception 'not friends';
  end if;
  if today < utc - 1 or today > utc + 1 then
    raise exception 'not today';
  end if;
  if (select count(*) from public.mapringer_rings where user_id = me and day = today) < 3 then
    return json_build_object('status', 'locked');
  end if;
  if coalesce((select hide_rings from public.mapringer_settings where user_id = friend), false) then
    return json_build_object('status', 'hidden');
  end if;
  if not exists (select 1 from public.mapringer_rings where user_id = friend and day = today) then
    return json_build_object('status', 'none');
  end if;
  return json_build_object('status', 'ok', 'rings', (
    select json_agg(r.result order by r.stage) from public.mapringer_rings r where r.user_id = friend and r.day = today
  ));
end $$;

revoke execute on function public.mapringer_utc_day(), public.mapringer_friend_rings(uuid),
  public.mapringer_friend_today(uuid, integer) from public, anon;
grant execute on function public.mapringer_utc_day(), public.mapringer_friend_rings(uuid),
  public.mapringer_friend_today(uuid, integer) to authenticated;
