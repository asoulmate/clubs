-- ============================================================
-- 41_global_player_identity.sql
-- Additive canonical player identity and review workflow.
-- The guest-claim feature flag is inserted OFF.
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create table public.global_players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(trim(display_name)) between 1 and 30),
  status text not null default 'active' check (status in ('active', 'merged')),
  merged_into_id uuid references public.global_players(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_players_merge_state_check check (
    (status = 'active' and merged_into_id is null)
    or (status = 'merged' and merged_into_id is not null and merged_into_id <> id)
  )
);

alter table public.profiles
  add column global_player_id uuid references public.global_players(id) on delete restrict;
create index profiles_global_player_id_idx on public.profiles(global_player_id);

create table public.player_aliases (
  id uuid primary key default gen_random_uuid(),
  global_player_id uuid not null references public.global_players(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 30),
  normalized_name text not null,
  affiliation text,
  source_type text not null,
  source_profile_id uuid references public.profiles(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  constraint player_aliases_validity_check check (valid_to is null or valid_to >= valid_from),
  constraint player_aliases_source_check check (source_type in ('legacy_profile', 'profile', 'external', 'manual'))
);
create index player_aliases_normalized_name_idx on public.player_aliases(normalized_name);
create index player_aliases_global_player_idx on public.player_aliases(global_player_id);
create unique index player_aliases_profile_source_idx
  on public.player_aliases(global_player_id, source_type, source_profile_id)
  where source_profile_id is not null;

create table public.player_external_ids (
  id uuid primary key default gen_random_uuid(),
  global_player_id uuid not null references public.global_players(id) on delete restrict,
  provider text not null check (char_length(trim(provider)) between 1 and 50),
  external_player_id text not null check (char_length(trim(external_player_id)) between 1 and 200),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, external_player_id),
  constraint player_external_ids_verification_check check (
    (verification_status = 'verified' and verified_by is not null and verified_at is not null)
    or verification_status <> 'verified'
  )
);

create table public.player_identity_claims (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null check (claim_type in ('guest_claim', 'duplicate_merge', 'split_request', 'external_id_link')),
  source_profile_id uuid references public.profiles(id) on delete set null,
  target_profile_id uuid references public.profiles(id) on delete set null,
  source_global_player_id uuid references public.global_players(id) on delete restrict,
  target_global_player_id uuid references public.global_players(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  constraint player_identity_claims_review_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);
create unique index player_identity_claims_pending_pair_idx
  on public.player_identity_claims(claim_type, source_profile_id, target_profile_id)
  where status = 'pending';

create table public.player_identity_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  event_type text not null check (event_type in (
    'created', 'profile_linked', 'claim_requested', 'claim_approved',
    'claim_rejected', 'merged', 'split'
  )),
  source_global_player_id uuid,
  target_global_player_id uuid,
  profile_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index player_identity_events_created_idx on public.player_identity_events(created_at desc);
create index player_identity_events_profile_idx on public.player_identity_events(profile_id, created_at desc);
create index player_identity_events_correlation_idx on public.player_identity_events(correlation_id);

insert into public.app_settings(key, value, description)
values (
  'global_identity_guest_claim_enabled',
  'false'::jsonb,
  '새 회원가입 시 동명 게스트 자동 이전 대신 검수 claim 후보 생성. 기본 OFF.'
)
on conflict (key) do nothing;

-- Base identity tables are server-side only. Read APIs below return reviewed data.
alter table public.global_players enable row level security;
alter table public.player_aliases enable row level security;
alter table public.player_external_ids enable row level security;
alter table public.player_identity_claims enable row level security;
alter table public.player_identity_events enable row level security;
revoke all on public.global_players, public.player_aliases, public.player_external_ids,
  public.player_identity_claims, public.player_identity_events from public, anon, authenticated;
grant select on public.global_players, public.player_aliases, public.player_external_ids,
  public.player_identity_claims, public.player_identity_events to service_role;

create or replace function public.ensure_profile_global_player()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_global_id uuid;
begin
  if new.global_player_id is null then
    insert into public.global_players(display_name) values (new.name) returning id into v_global_id;
    new.global_player_id := v_global_id;
    insert into public.player_identity_events(
      correlation_id, event_type, target_global_player_id, profile_id,
      after_state, reason, actor_user_id
    ) values (
      gen_random_uuid(), 'created', v_global_id, new.id,
      jsonb_build_object('global_player_id', v_global_id), 'profile identity created', auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger trg_ensure_profile_global_player
  before insert on public.profiles
  for each row execute function public.ensure_profile_global_player();

-- Re-apply protected-column guard now that global_player_id exists.
create or replace function public.prevent_privilege_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce((public.get_setting('security_scoped_admin_rpc_enabled'))::boolean, false) = false then
    if new.role is distinct from old.role and public.get_my_role() <> 'admin' then
      raise exception '사용자 역할은 관리자만 변경할 수 있습니다.';
    end if;
    if new.is_active is distinct from old.is_active and not public.is_admin_or_sub() then
      raise exception '사용자 활성 상태는 관리자만 변경할 수 있습니다.';
    end if;
    return new;
  end if;
  if not public.is_platform_admin() and (
    new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.is_guest is distinct from old.is_guest
    or new.is_platform_admin is distinct from old.is_platform_admin
    or new.global_player_id is distinct from old.global_player_id
  ) then
    raise exception '보호된 플랫폼 계정·identity 속성은 전용 절차에서만 변경할 수 있습니다.';
  end if;
  return new;
end;
$$;

create or replace function public.create_guest_claim_candidates()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_member public.profiles;
  v_guest record;
  v_correlation_id uuid;
begin
  if new.status not in ('pending', 'active')
     or coalesce((public.get_setting('global_identity_guest_claim_enabled'))::boolean, false) = false then
    return new;
  end if;
  select * into v_member from public.profiles where id = new.user_id;
  if not found or v_member.is_guest then return new; end if;

  for v_guest in
    select p.id, p.global_player_id, p.award_level, p.affiliation
    from public.profiles p
    join public.club_members cm on cm.user_id = p.id
    where cm.club_id = new.club_id and cm.status = 'active'
      and p.is_guest and lower(trim(p.name)) = lower(trim(v_member.name))
  loop
    insert into public.player_identity_claims(
      claim_type, source_profile_id, target_profile_id,
      source_global_player_id, target_global_player_id, evidence, requested_by
    ) values (
      'guest_claim', v_guest.id, v_member.id,
      v_guest.global_player_id, v_member.global_player_id,
      jsonb_build_object(
        'club_id', new.club_id,
        'same_award', v_guest.award_level = v_member.award_level,
        'same_affiliation', lower(trim(coalesce(v_guest.affiliation, ''))) = lower(trim(coalesce(v_member.affiliation, '')))
      ), auth.uid()
    ) on conflict do nothing
    returning id into v_correlation_id;

    if v_correlation_id is not null then
      insert into public.player_identity_events(
        correlation_id, event_type, source_global_player_id, target_global_player_id,
        profile_id, reason, actor_user_id
      ) values (
        gen_random_uuid(), 'claim_requested', v_guest.global_player_id,
        v_member.global_player_id, v_guest.id, 'automatic guest claim candidate', auth.uid()
      );
    end if;
    v_correlation_id := null;
  end loop;
  return new;
end;
$$;

create trigger trg_create_guest_claim_candidates
  after insert or update of status on public.club_members
  for each row execute function public.create_guest_claim_candidates();

-- Keep the existing signup behavior when the flag is OFF. When ON, create an
-- independent profile/global player and let the membership trigger make claims.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_award text := new.raw_user_meta_data ->> 'award_level';
  v_name text;
  v_award_level public.award_level;
  v_require_approval boolean;
  v_guest_id uuid;
  v_claim_enabled boolean;
  v_club_slug text := nullif(trim(new.raw_user_meta_data ->> 'club_slug'), '');
  v_club_id uuid;
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1));
  v_award_level := case
    when v_award in (
      'open_champion', 'open_place', 'national_rookie_champion', 'national_rookie_place',
      'local_rookie_champion', 'local_rookie_place', 'none'
    ) then v_award::public.award_level
    when v_award = 'open' then 'open_place'::public.award_level
    when v_award = 'national_rookie' then 'national_rookie_place'::public.award_level
    when v_award = 'local_rookie' then 'local_rookie_place'::public.award_level
    else 'none'::public.award_level
  end;
  if v_club_slug is null then raise exception '가입 시 클럽을 지정해야 합니다.'; end if;
  select id into v_club_id from public.clubs where slug = lower(v_club_slug);
  if v_club_id is null then raise exception '존재하지 않는 클럽입니다.'; end if;
  v_require_approval := coalesce((public.get_club_setting(v_club_id, 'require_signup_approval'))::boolean, true);
  v_claim_enabled := coalesce((public.get_setting('global_identity_guest_claim_enabled'))::boolean, false);

  if not v_claim_enabled then
    select cm.user_id into v_guest_id
    from public.club_members cm join public.profiles p on p.id = cm.user_id
    where cm.club_id = v_club_id and p.is_guest
      and lower(trim(p.name)) = lower(trim(v_name))
    order by case when p.award_level = v_award_level then 0 else 1 end, p.created_at
    limit 1;
  end if;

  insert into public.profiles(id, name, award_level, role, is_active, is_guest, is_platform_admin)
  values (new.id, v_name, v_award_level, 'user', not v_require_approval, false, false);

  if not v_claim_enabled and v_guest_id is not null then
    perform public.transfer_profile_refs(v_guest_id, new.id);
    delete from public.club_members where user_id = v_guest_id;
    delete from public.profiles where id = v_guest_id;
  end if;

  insert into public.club_members(club_id, user_id, role, status)
  values (v_club_id, new.id, 'user', case when v_require_approval then 'pending' else 'active' end);
  return new;
end;
$$;

create or replace function public.merge_global_players_v2(
  p_source_global_player_id uuid,
  p_target_global_player_id uuid,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_cursor uuid; v_depth integer := 0; v_correlation uuid := gen_random_uuid();
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 identity를 병합할 수 있습니다.'; end if;
  if p_source_global_player_id = p_target_global_player_id then raise exception '같은 identity를 병합할 수 없습니다.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception '병합 사유가 필요합니다.'; end if;
  perform 1 from public.global_players where id in (p_source_global_player_id, p_target_global_player_id) for update;
  if (select count(*) from public.global_players where id in (p_source_global_player_id, p_target_global_player_id)) <> 2 then
    raise exception 'identity를 찾을 수 없습니다.';
  end if;
  v_cursor := p_target_global_player_id;
  while v_cursor is not null loop
    if v_cursor = p_source_global_player_id then raise exception 'identity merge cycle이 발생합니다.'; end if;
    select merged_into_id into v_cursor from public.global_players where id = v_cursor;
    v_depth := v_depth + 1;
    if v_depth > 100 then raise exception 'identity merge chain이 비정상적으로 깁니다.'; end if;
  end loop;
  update public.profiles set global_player_id = p_target_global_player_id
  where global_player_id = p_source_global_player_id;
  update public.player_aliases set global_player_id = p_target_global_player_id
  where global_player_id = p_source_global_player_id;
  update public.global_players
  set status = 'merged', merged_into_id = p_target_global_player_id, updated_at = now()
  where id = p_source_global_player_id;
  insert into public.player_identity_events(
    correlation_id, event_type, source_global_player_id, target_global_player_id,
    before_state, after_state, reason, actor_user_id
  ) values (
    v_correlation, 'merged', p_source_global_player_id, p_target_global_player_id,
    jsonb_build_object('source_status', 'active'),
    jsonb_build_object('source_status', 'merged'), trim(p_reason), auth.uid()
  );
end;
$$;

create or replace function public.split_profile_identity_v2(p_profile_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_profile public.profiles; v_old uuid; v_new uuid; v_correlation uuid := gen_random_uuid();
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 identity를 분리할 수 있습니다.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception '분리 사유가 필요합니다.'; end if;
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'profile을 찾을 수 없습니다.'; end if;
  v_old := v_profile.global_player_id;
  insert into public.global_players(display_name) values (v_profile.name) returning id into v_new;
  update public.profiles set global_player_id = v_new where id = p_profile_id;
  insert into public.player_aliases(global_player_id, name, normalized_name, affiliation, source_type, source_profile_id)
  values (v_new, v_profile.name, lower(trim(v_profile.name)), v_profile.affiliation, 'profile', p_profile_id);
  insert into public.player_identity_events(
    correlation_id, event_type, source_global_player_id, target_global_player_id, profile_id,
    before_state, after_state, reason, actor_user_id
  ) values (
    v_correlation, 'split', v_old, v_new, p_profile_id,
    jsonb_build_object('global_player_id', v_old), jsonb_build_object('global_player_id', v_new),
    trim(p_reason), auth.uid()
  );
  return v_new;
end;
$$;

create or replace function public.review_identity_claim_v2(
  p_claim_id uuid, p_approve boolean, p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_claim public.player_identity_claims;
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 claim을 검수할 수 있습니다.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then raise exception '검수 사유가 필요합니다.'; end if;
  select * into v_claim from public.player_identity_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending' then raise exception '검수 가능한 claim을 찾을 수 없습니다.'; end if;
  if p_approve then
    perform public.merge_global_players_v2(v_claim.source_global_player_id, v_claim.target_global_player_id, p_reason);
    update public.player_identity_claims
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = trim(p_reason)
    where id = p_claim_id;
    insert into public.player_identity_events(
      correlation_id, event_type, source_global_player_id, target_global_player_id, profile_id,
      reason, actor_user_id
    ) values (
      gen_random_uuid(), 'claim_approved', v_claim.source_global_player_id,
      v_claim.target_global_player_id, v_claim.source_profile_id, trim(p_reason), auth.uid()
    );
  else
    update public.player_identity_claims
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = trim(p_reason)
    where id = p_claim_id;
    insert into public.player_identity_events(
      correlation_id, event_type, source_global_player_id, target_global_player_id, profile_id,
      reason, actor_user_id
    ) values (
      gen_random_uuid(), 'claim_rejected', v_claim.source_global_player_id,
      v_claim.target_global_player_id, v_claim.source_profile_id, trim(p_reason), auth.uid()
    );
  end if;
end;
$$;

create or replace function public.list_pending_identity_claims_v2()
returns table (
  claim_id uuid, claim_type text, source_profile_id uuid, target_profile_id uuid,
  source_global_player_id uuid, target_global_player_id uuid,
  evidence jsonb, requested_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 claim을 조회할 수 있습니다.'; end if;
  return query select c.id, c.claim_type, c.source_profile_id, c.target_profile_id,
    c.source_global_player_id, c.target_global_player_id, c.evidence, c.requested_at
  from public.player_identity_claims c where c.status = 'pending' order by c.requested_at;
end;
$$;

revoke execute on function public.ensure_profile_global_player() from public, anon, authenticated;
revoke execute on function public.create_guest_claim_candidates() from public, anon, authenticated;
revoke execute on function public.prevent_privilege_change() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.merge_global_players_v2(uuid, uuid, text) from public, anon;
revoke execute on function public.split_profile_identity_v2(uuid, text) from public, anon;
revoke execute on function public.review_identity_claim_v2(uuid, boolean, text) from public, anon;
revoke execute on function public.list_pending_identity_claims_v2() from public, anon;
grant execute on function public.merge_global_players_v2(uuid, uuid, text) to authenticated;
grant execute on function public.split_profile_identity_v2(uuid, text) to authenticated;
grant execute on function public.review_identity_claim_v2(uuid, boolean, text) to authenticated;
grant execute on function public.list_pending_identity_claims_v2() to authenticated;

commit;
