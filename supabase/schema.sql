-- Eggsplaining world leaderboard for Supabase.
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
--
-- The browser only ever calls three functions with the public anon key:
--   start_run(p_mode)                                                         → run id
--   submit_score(p_run, p_mode, p_score, p_name, p_country, p_player, p_look) → rank
--   leaderboard(p_mode, p_period, p_limit, p_player)                          → rows
-- The tables themselves are locked (row level security on, no policies), so nobody can
-- write a score without going through the checks below.

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('classic', 'blitz')),
  started_at timestamptz not null default now(),
  ip text not null default '',
  used boolean not null default false
);

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  player text not null check (player ~ '^[a-z0-9]{12,40}$'),
  name text not null,
  country text not null default '',
  mode text not null check (mode in ('classic', 'blitz')),
  score integer not null check (score >= 0),
  at timestamptz not null default now(),
  look jsonb not null default '{}'::jsonb
);

create index if not exists scores_mode_score on public.scores (mode, score desc);
create index if not exists scores_mode_at on public.scores (mode, at);
create index if not exists runs_ip_started on public.runs (ip, started_at);

alter table public.runs enable row level security;
alter table public.scores enable row level security;
revoke all on public.runs, public.scores from anon, authenticated;

-- Caller IP from the API gateway, '' when unknown (local tests).
create or replace function public.client_ip() returns text
language sql stable as $$
  select coalesce(nullif(btrim(split_part(
    coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-forwarded-for', ',', 1)), ''), '')
$$;

create or replace function public.start_run(p_mode text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ip text := public.client_ip();
begin
  if p_mode is null or p_mode not in ('classic', 'blitz') then
    raise exception 'Unknown mode.';
  end if;
  if v_ip <> '' and (select count(*) from runs where ip = v_ip and started_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down a little.';
  end if;
  delete from runs where started_at < now() - interval '2 hours';
  insert into runs (mode, ip) values (p_mode, v_ip) returning id into v_id;
  return v_id;
end $$;

-- Best score per player, ranked. 'today' is the current UTC day.
create or replace function public.leaderboard(
  p_mode text,
  p_period text default 'all',
  p_limit int default 50,
  p_player text default null
) returns json
language sql stable security definer set search_path = public as $$
  with pool as (
    select * from scores
    where mode = p_mode
      and (p_period is distinct from 'today'
           or at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc'))
  ),
  best as (
    select distinct on (player) player, name, country, score, at, look
    from pool order by player, score desc, at asc
  ),
  ranked as (
    select *, row_number() over (order by score desc, at asc) as rank from best
  )
  select json_build_object(
    'mode', p_mode,
    'period', case when p_period = 'today' then 'today' else 'all' end,
    'total', (select count(*) from ranked),
    'rows', coalesce((
      select json_agg(json_build_object('rank', rank, 'name', name, 'country', country, 'score', score, 'at', at, 'look', look) order by rank)
      from (select * from ranked order by rank limit least(greatest(coalesce(p_limit, 50), 1), 100)) t
    ), '[]'::json),
    'you', (select json_build_object('rank', rank, 'score', score) from ranked where player = p_player)
  )
$$;

create or replace function public.submit_score(
  p_run uuid,
  p_mode text,
  p_score int,
  p_name text,
  p_country text,
  p_player text,
  p_look jsonb
) returns json
language plpgsql security definer set search_path = public as $$
declare
  r runs;
  v_elapsed double precision;
  v_cap double precision;
  v_name text;
  v_country text;
  v_look jsonb := p_look;
  v_all json;
  v_today json;
begin
  select * into r from runs where id = p_run for update;
  if not found or r.used then
    raise exception 'That run expired. Play another one.';
  end if;
  if r.mode <> p_mode then
    raise exception 'Mode mismatch.';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'Bad score.';
  end if;
  if p_player is null or p_player !~ '^[a-z0-9]{12,40}$' then
    raise exception 'Missing player.';
  end if;
  -- same ceiling as src/shared/limits.js
  v_elapsed := extract(epoch from (now() - r.started_at));
  v_cap := case r.mode when 'classic' then 100 else 230 end;
  if p_score > v_cap * v_elapsed + 50 then
    raise exception 'That score is not possible.';
  end if;
  if r.ip <> '' and (select count(*) from runs where ip = r.ip and used and started_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many scores from here. Try again later.';
  end if;
  update runs set used = true where id = p_run;

  v_name := regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g');
  v_name := left(btrim(regexp_replace(v_name, '\s+', ' ', 'g')), 16);
  if v_name = '' then v_name := 'Anonymous egg'; end if;
  v_country := case when p_country ~ '^[A-Z]{2}$' then p_country else '' end;
  if v_look is null or jsonb_typeof(v_look) <> 'object' or octet_length(v_look::text) > 1500 then
    v_look := '{}'::jsonb;
  end if;

  insert into scores (player, name, country, mode, score, look)
  values (p_player, v_name, v_country, r.mode, p_score, v_look);

  v_all := public.leaderboard(r.mode, 'all', 1, p_player);
  v_today := public.leaderboard(r.mode, 'today', 1, p_player);
  return json_build_object(
    'ok', true,
    'best', (v_all -> 'you' ->> 'score')::int,
    'rank', json_build_object('all', (v_all -> 'you' ->> 'rank')::int, 'today', (v_today -> 'you' ->> 'rank')::int),
    'total', json_build_object('all', (v_all ->> 'total')::int, 'today', (v_today ->> 'total')::int)
  );
end $$;

revoke all on function public.client_ip() from public, anon, authenticated;
revoke all on function public.start_run(text) from public;
revoke all on function public.submit_score(uuid, text, int, text, text, text, jsonb) from public;
revoke all on function public.leaderboard(text, text, int, text) from public;
grant execute on function public.start_run(text) to anon, authenticated;
grant execute on function public.submit_score(uuid, text, int, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.leaderboard(text, text, int, text) to anon, authenticated;
