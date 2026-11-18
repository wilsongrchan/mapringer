-- MapRinger's tables in the shared Game Rabbit Supabase database ("game-rabbit",
-- made through the Vercel Marketplace). One account (auth.users) works across
-- every Game Rabbit game; each game keeps its own tables, prefixed with its name.
--
-- Safe to re-run. Apply with scripts/apply_schema.mjs (reads POSTGRES_URL_NON_POOLING
-- from .env.local).
--
-- Rings are one try each, so rows are insert-only: a player can add their own
-- rings and read them back, never change or delete them. (Scores are worked out
-- in the browser, so they can be faked; fine for friends, not for prizes.)

create table if not exists public.mapringer_rings (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day integer not null check (day > 0),
  stage smallint not null check (stage between 0 and 2),
  points integer not null,
  map text check (map in ('easy', 'standard', 'hard')),
  result jsonb not null, -- the whole saved Result (storage.ts)
  created_at timestamptz not null default now(),
  primary key (user_id, day, stage)
);

-- the map a player picked for a day (all three rings are played on it)
create table if not exists public.mapringer_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day integer not null check (day > 0),
  map text not null check (map in ('easy', 'standard', 'hard')),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.mapringer_rings enable row level security;
alter table public.mapringer_days enable row level security;

drop policy if exists "read own rings" on public.mapringer_rings;
create policy "read own rings" on public.mapringer_rings
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "add own rings" on public.mapringer_rings;
create policy "add own rings" on public.mapringer_rings
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "read own days" on public.mapringer_days;
create policy "read own days" on public.mapringer_days
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "add own days" on public.mapringer_days;
create policy "add own days" on public.mapringer_days
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- nobody signed out (anon) gets anything; signed-in players only select/insert
revoke all on public.mapringer_rings, public.mapringer_days from anon;
revoke all on public.mapringer_rings, public.mapringer_days from authenticated;
grant select, insert on public.mapringer_rings, public.mapringer_days to authenticated;
