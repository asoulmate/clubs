-- ============================================================
-- 43_shadow_rating_schema.sql
-- Reproducible shadow rating storage, separate from existing rankings.
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create table public.rating_models (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.rating_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.rating_models(id) on delete restrict,
  version text not null,
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  input_schema_version integer not null default 1 check (input_schema_version > 0),
  code_version text not null,
  status text not null default 'shadow' check (status in ('shadow', 'active', 'retired')),
  created_at timestamptz not null default now(),
  unique(model_id, version)
);

create table public.rating_pools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope_type text not null check (scope_type in ('global', 'club')),
  club_id uuid references public.clubs(id) on delete restrict,
  discipline text not null check (discipline in ('singles', 'doubles')),
  model_version_id uuid not null references public.rating_model_versions(id) on delete restrict,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rating_pools_scope_check check (
    (scope_type = 'global' and club_id is null)
    or (scope_type = 'club' and club_id is not null)
  )
);
create unique index rating_pools_global_unique
  on public.rating_pools(discipline, model_version_id) where scope_type = 'global';
create unique index rating_pools_club_unique
  on public.rating_pools(club_id, discipline, model_version_id) where scope_type = 'club';

create table public.rating_runs (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.rating_pools(id) on delete restrict,
  model_version_id uuid not null references public.rating_model_versions(id) on delete restrict,
  cutoff_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  input_hash text,
  identity_mapping_hash text,
  included_match_count integer not null default 0,
  excluded_match_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  created_by uuid,
  unique(pool_id, model_version_id, cutoff_at, input_hash)
);
create index rating_runs_pool_completed_idx on public.rating_runs(pool_id, completed_at desc);

create table public.rating_run_matches (
  run_id uuid not null references public.rating_runs(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete restrict,
  sequence_no integer not null,
  included boolean not null,
  exclusion_reason text,
  input_payload jsonb not null check (jsonb_typeof(input_payload) = 'object'),
  primary key(run_id, match_id),
  unique(run_id, sequence_no),
  constraint rating_run_matches_reason_check check (
    (included and exclusion_reason is null)
    or (not included and exclusion_reason is not null)
  )
);

create table public.player_ratings (
  pool_id uuid not null references public.rating_pools(id) on delete cascade,
  global_player_id uuid not null references public.global_players(id) on delete restrict,
  rating numeric(12,6) not null,
  uncertainty numeric(12,6) not null,
  games_played integer not null default 0,
  provisional boolean not null default true,
  as_of_run_id uuid not null references public.rating_runs(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key(pool_id, global_player_id)
);

create table public.player_rating_history (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rating_runs(id) on delete cascade,
  pool_id uuid not null references public.rating_pools(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete restrict,
  sequence_no integer not null,
  global_player_id uuid not null references public.global_players(id) on delete restrict,
  team_side text not null check (team_side in ('A', 'B')),
  rating_before numeric(12,6) not null,
  rating_after numeric(12,6) not null,
  uncertainty_before numeric(12,6) not null,
  uncertainty_after numeric(12,6) not null,
  games_before integer not null,
  games_after integer not null,
  created_at timestamptz not null default now(),
  unique(run_id, match_id, global_player_id)
);
create index player_rating_history_player_idx
  on public.player_rating_history(global_player_id, run_id, sequence_no);

alter table public.rating_models enable row level security;
alter table public.rating_model_versions enable row level security;
alter table public.rating_pools enable row level security;
alter table public.rating_runs enable row level security;
alter table public.rating_run_matches enable row level security;
alter table public.player_ratings enable row level security;
alter table public.player_rating_history enable row level security;

revoke all on public.rating_models, public.rating_model_versions, public.rating_pools,
  public.rating_runs, public.rating_run_matches, public.player_ratings,
  public.player_rating_history from public, anon, authenticated;
grant select on public.rating_models, public.rating_model_versions, public.rating_pools,
  public.rating_runs, public.rating_run_matches, public.player_ratings,
  public.player_rating_history to service_role;

with model as (
  insert into public.rating_models(code, name, description)
  values (
    'team_elo', 'Team Elo',
    'Deterministic team-average Elo baseline. Shadow-only; not an official ranking.'
  )
  on conflict(code) do update set name = excluded.name
  returning id
), version as (
  insert into public.rating_model_versions(
    model_id, version, parameters, input_schema_version, code_version, status
  )
  select id, '1.0.0',
    jsonb_build_object(
      'initial_rating', 1500,
      'k_factor', 32,
      'initial_uncertainty', 350,
      'minimum_uncertainty', 60,
      'provisional_games', 10,
      'team_rating', 'arithmetic_mean'
    ), 1, 'sql-team-elo-v1', 'shadow'
  from model
  on conflict(model_id, version) do update set parameters = excluded.parameters
  returning id
)
insert into public.rating_pools(name, scope_type, club_id, discipline, model_version_id, enabled)
select 'Global Singles Shadow', 'global', null::uuid, 'singles', id, false from version
union all
select 'Global Doubles Shadow', 'global', null::uuid, 'doubles', id, false from version
on conflict do nothing;

commit;
