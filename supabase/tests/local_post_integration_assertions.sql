\set ON_ERROR_STOP on

do $$
declare
  v_profile_count bigint;
  v_identity_count bigint;
  v_reset_sessions bigint;
  v_last_backfill public.identity_backfill_runs;
begin
  select count(*), count(distinct global_player_id)
  into v_profile_count, v_identity_count
  from public.profiles;

  if exists (select 1 from public.profiles where global_player_id is null) then
    raise exception 'profiles without a global identity remain after backfill';
  end if;
  if v_profile_count <> v_identity_count then
    raise exception 'profile/global identity mapping is not 1:1: profiles %, identities %',
      v_profile_count, v_identity_count;
  end if;

  select * into v_last_backfill
  from public.identity_backfill_runs
  order by started_at desc, id desc
  limit 1;
  if v_last_backfill.status <> 'completed'
     or v_last_backfill.unlinked_count_before <> 0
     or v_last_backfill.created_global_player_count <> 0
     or v_last_backfill.orphan_count_after <> 0 then
    raise exception 'second identity backfill was not idempotent: %', row_to_json(v_last_backfill);
  end if;

  select count(*) into v_reset_sessions
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  where u.email = 'local-signup@example.test';
  if v_reset_sessions <> 0 then
    raise exception 'password reset left % auth sessions', v_reset_sessions;
  end if;

  if exists (
    select 1 from public.security_audit_events
    where metadata::text ilike '%123456%'
       or metadata::text ilike '%password%'
       or metadata::text ilike '%token%'
  ) then
    raise exception 'security audit metadata contains password or token material';
  end if;
end;
$$;

select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.global_players where status = 'active') as active_global_players,
  (select count(*) from public.rating_runs where status = 'completed') as completed_rating_runs,
  (select count(*) from public.player_ratings) as player_ratings,
  (select count(*) from public.security_audit_events) as security_audit_events;
