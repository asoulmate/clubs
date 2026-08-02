begin;

-- Birth year is optional, private identity evidence. It is deliberately kept
-- outside profiles so existing profile reads never expose it.
create table public.player_identity_hints (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  birth_year smallint check (birth_year between 1900 and 2100),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_identity_hints enable row level security;
revoke all on public.player_identity_hints from public, anon, authenticated;
grant select on public.player_identity_hints to service_role;

-- Preserve the legacy create_guest_profile signature. New UI calls this
-- additive RPC so same-name guests with different birth years stay separate.
create or replace function public.create_guest_profile_v2(
  p_name text,
  p_club_id uuid,
  p_award_level public.award_level default 'none',
  p_affiliation text default null,
  p_birth_year smallint default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_affiliation text := nullif(trim(coalesce(p_affiliation, '')), '');
  v_row public.profiles;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception '이름은 1~30자로 입력해주세요.';
  end if;
  if p_award_level is null then
    raise exception '입상 구분을 선택해주세요.';
  end if;
  if v_affiliation is null or char_length(v_affiliation) > 40 then
    raise exception '소속은 1~40자로 입력해주세요.';
  end if;
  if p_birth_year is not null
     and p_birth_year not between 1900 and extract(year from current_date)::integer then
    raise exception '출생연도를 확인해주세요.';
  end if;

  select p.* into v_row
  from public.profiles p
  join public.club_members cm
    on cm.user_id = p.id and cm.club_id = p_club_id and cm.status = 'active'
  left join public.player_identity_hints h on h.profile_id = p.id
  where p.is_guest
    and lower(trim(p.name)) = lower(v_name)
    and p.award_level = p_award_level
    and lower(trim(coalesce(p.affiliation, ''))) = lower(v_affiliation)
    and h.birth_year is not distinct from p_birth_year
  order by p.created_at
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.profiles (
    id, name, award_level, role, is_active, is_guest, affiliation
  ) values (
    gen_random_uuid(), v_name, p_award_level, 'user', true, true, v_affiliation
  ) returning * into v_row;

  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, v_row.id, 'user', 'active');

  if p_birth_year is not null then
    insert into public.player_identity_hints (
      profile_id, birth_year, created_by, updated_by
    ) values (
      v_row.id, p_birth_year, auth.uid(), auth.uid()
    );
  end if;

  return v_row;
end;
$$;

-- Generate review candidates only for exact guest identity evidence.
-- Nothing is merged until a platform administrator explicitly approves a claim.
create or replace function public.refresh_guest_identity_claim_candidates_v2()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair record;
  v_source public.profiles;
  v_target public.profiles;
  v_claim_id uuid;
  v_inserted integer := 0;
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 게스트 동일인 후보를 생성할 수 있습니다.';
  end if;

  for v_pair in
    with eligible as (
      select
        p.*,
        h.birth_year,
        regexp_replace(lower(trim(p.name)), '\s+', ' ', 'g') as normalized_name,
        nullif(
          regexp_replace(lower(trim(coalesce(p.affiliation, ''))), '\s+', ' ', 'g'),
          ''
        ) as normalized_affiliation
      from public.profiles p
      left join public.player_identity_hints h on h.profile_id = p.id
      where p.global_player_id is not null
        and exists (
          select 1 from public.club_members cm where cm.user_id = p.id
          union all
          select 1 from public.match_players mp where mp.user_id = p.id
        )
    ), pairs as (
      select
        case
          when a.is_guest and not b.is_guest then a.id
          when b.is_guest and not a.is_guest then b.id
          when a.created_at > b.created_at then a.id
          else b.id
        end as source_profile_id,
        case
          when a.is_guest and not b.is_guest then b.id
          when b.is_guest and not a.is_guest then a.id
          when a.created_at > b.created_at then b.id
          else a.id
        end as target_profile_id,
        case
          when a.is_guest and not b.is_guest then a.global_player_id
          when b.is_guest and not a.is_guest then b.global_player_id
          when a.created_at > b.created_at then a.global_player_id
          else b.global_player_id
        end as source_global_player_id,
        case
          when a.is_guest and not b.is_guest then b.global_player_id
          when b.is_guest and not a.is_guest then a.global_player_id
          when a.created_at > b.created_at then b.global_player_id
          else a.global_player_id
        end as target_global_player_id
      from eligible a
      join eligible b on a.id < b.id
      where (a.is_guest or b.is_guest)
        and a.global_player_id <> b.global_player_id
        and a.normalized_name = b.normalized_name
        and a.award_level = b.award_level
        and a.normalized_affiliation is not null
        and a.normalized_affiliation = b.normalized_affiliation
        and (a.birth_year is null or b.birth_year is null or a.birth_year = b.birth_year)
    )
    select distinct on (source_global_player_id, target_global_player_id) *
    from pairs
    order by source_global_player_id, target_global_player_id, source_profile_id, target_profile_id
  loop
    if exists (
      select 1
      from public.player_identity_claims c
      where c.claim_type = 'guest_claim'
        and c.status in ('pending', 'approved', 'rejected')
        and (
          (c.source_global_player_id = v_pair.source_global_player_id
            and c.target_global_player_id = v_pair.target_global_player_id)
          or
          (c.source_global_player_id = v_pair.target_global_player_id
            and c.target_global_player_id = v_pair.source_global_player_id)
        )
    ) then
      continue;
    end if;

    select * into v_source from public.profiles where id = v_pair.source_profile_id;
    select * into v_target from public.profiles where id = v_pair.target_profile_id;

    insert into public.player_identity_claims (
      claim_type, source_profile_id, target_profile_id,
      source_global_player_id, target_global_player_id,
      evidence, requested_by
    ) values (
      'guest_claim', v_source.id, v_target.id,
      v_source.global_player_id, v_target.global_player_id,
      jsonb_build_object(
        'match_basis', 'exact_name_award_affiliation',
        'source', jsonb_build_object(
          'profile_id', v_source.id,
          'name', v_source.name,
          'award_level', v_source.award_level,
          'affiliation', v_source.affiliation,
          'birth_year', (select h.birth_year from public.player_identity_hints h where h.profile_id = v_source.id),
          'is_guest', v_source.is_guest,
          'clubs', coalesce((
            select jsonb_agg(jsonb_build_object(
              'club_id', c.id, 'name', c.name, 'slug', c.slug, 'status', cm.status
            ) order by c.name)
            from public.club_members cm
            join public.clubs c on c.id = cm.club_id
            where cm.user_id = v_source.id
          ), '[]'::jsonb),
          'confirmed_matches', (
            select count(distinct m.id)
            from public.match_players mp
            join public.matches m on m.id = mp.match_id
            where mp.user_id = v_source.id and m.status = 'confirmed'
          )
        ),
        'target', jsonb_build_object(
          'profile_id', v_target.id,
          'name', v_target.name,
          'award_level', v_target.award_level,
          'affiliation', v_target.affiliation,
          'birth_year', (select h.birth_year from public.player_identity_hints h where h.profile_id = v_target.id),
          'is_guest', v_target.is_guest,
          'clubs', coalesce((
            select jsonb_agg(jsonb_build_object(
              'club_id', c.id, 'name', c.name, 'slug', c.slug, 'status', cm.status
            ) order by c.name)
            from public.club_members cm
            join public.clubs c on c.id = cm.club_id
            where cm.user_id = v_target.id
          ), '[]'::jsonb),
          'confirmed_matches', (
            select count(distinct m.id)
            from public.match_players mp
            join public.matches m on m.id = mp.match_id
            where mp.user_id = v_target.id and m.status = 'confirmed'
          )
        )
      ),
      auth.uid()
    )
    returning id into v_claim_id;

    insert into public.player_identity_events (
      correlation_id, event_type, source_global_player_id,
      target_global_player_id, profile_id, reason, actor_user_id
    ) values (
      gen_random_uuid(), 'claim_requested', v_source.global_player_id,
      v_target.global_player_id, v_source.id,
      'exact guest identity candidate refresh', auth.uid()
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

-- Reject stale approvals and cancel claims that still reference an identity
-- that has just been merged. Existing match/profile foreign keys are untouched.
create or replace function public.review_identity_claim_v2(
  p_claim_id uuid,
  p_approve boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.player_identity_claims;
  v_source_current uuid;
  v_target_current uuid;
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 claim을 검수할 수 있습니다.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception '검수 사유가 필요합니다.';
  end if;

  select * into v_claim
  from public.player_identity_claims
  where id = p_claim_id
  for update;

  if not found or v_claim.status <> 'pending' then
    raise exception '검수 가능한 claim을 찾을 수 없습니다.';
  end if;

  if p_approve then
    select global_player_id into v_source_current
    from public.profiles where id = v_claim.source_profile_id;
    select global_player_id into v_target_current
    from public.profiles where id = v_claim.target_profile_id;

    if v_source_current is distinct from v_claim.source_global_player_id
       or v_target_current is distinct from v_claim.target_global_player_id
       or not exists (
         select 1 from public.global_players
         where id = v_claim.source_global_player_id and status = 'active'
       )
       or not exists (
         select 1 from public.global_players
         where id = v_claim.target_global_player_id and status = 'active'
       ) then
      raise exception 'identity가 변경된 오래된 후보입니다. 후보를 새로 생성해주세요.';
    end if;

    perform public.merge_global_players_v2(
      v_claim.source_global_player_id,
      v_claim.target_global_player_id,
      p_reason
    );

    update public.player_identity_claims
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
        review_reason = trim(p_reason)
    where id = p_claim_id;

    update public.player_identity_claims
    set status = 'canceled', reviewed_by = auth.uid(), reviewed_at = now(),
        review_reason = 'identity changed by approved claim ' || p_claim_id::text
    where id <> p_claim_id
      and status = 'pending'
      and (
        source_global_player_id = v_claim.source_global_player_id
        or target_global_player_id = v_claim.source_global_player_id
      );

    insert into public.player_identity_events (
      correlation_id, event_type, source_global_player_id, target_global_player_id,
      profile_id, reason, actor_user_id
    ) values (
      gen_random_uuid(), 'claim_approved', v_claim.source_global_player_id,
      v_claim.target_global_player_id, v_claim.source_profile_id,
      trim(p_reason), auth.uid()
    );
  else
    update public.player_identity_claims
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        review_reason = trim(p_reason)
    where id = p_claim_id;

    insert into public.player_identity_events (
      correlation_id, event_type, source_global_player_id, target_global_player_id,
      profile_id, reason, actor_user_id
    ) values (
      gen_random_uuid(), 'claim_rejected', v_claim.source_global_player_id,
      v_claim.target_global_player_id, v_claim.source_profile_id,
      trim(p_reason), auth.uid()
    );
  end if;
end;
$$;

revoke execute on function public.refresh_guest_identity_claim_candidates_v2() from public, anon;
grant execute on function public.refresh_guest_identity_claim_candidates_v2() to authenticated;

revoke execute on function public.create_guest_profile_v2(text, uuid, public.award_level, text, smallint) from public, anon;
grant execute on function public.create_guest_profile_v2(text, uuid, public.award_level, text, smallint) to authenticated;

revoke execute on function public.review_identity_claim_v2(uuid, boolean, text) from public, anon;
grant execute on function public.review_identity_claim_v2(uuid, boolean, text) to authenticated;

commit;
