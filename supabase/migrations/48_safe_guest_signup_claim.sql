-- ============================================================
-- 48_safe_guest_signup_claim.sql
-- Never absorb a same-name guest during signup. Create an
-- independent member profile and require platform-admin review
-- before canonical global player identities are linked.
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create or replace function public.create_guest_claim_candidates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.profiles;
  v_member_birth_year smallint;
  v_guest record;
  v_claim_id uuid;
begin
  if new.status not in ('pending', 'active')
     or coalesce((public.get_setting('global_identity_guest_claim_enabled'))::boolean, false) = false then
    return new;
  end if;

  select p.* into v_member
  from public.profiles p
  where p.id = new.user_id;

  if not found or v_member.is_guest or v_member.global_player_id is null then
    return new;
  end if;

  select h.birth_year into v_member_birth_year
  from public.player_identity_hints h
  where h.profile_id = v_member.id;

  for v_guest in
    select p.*, h.birth_year
    from public.profiles p
    left join public.player_identity_hints h on h.profile_id = p.id
    where p.is_guest
      and p.global_player_id is not null
      and p.global_player_id <> v_member.global_player_id
      and regexp_replace(lower(trim(p.name)), '\s+', ' ', 'g') =
          regexp_replace(lower(trim(v_member.name)), '\s+', ' ', 'g')
      and p.award_level = v_member.award_level
      and nullif(regexp_replace(lower(trim(coalesce(p.affiliation, ''))), '\s+', ' ', 'g'), '') is not null
      and regexp_replace(lower(trim(coalesce(p.affiliation, ''))), '\s+', ' ', 'g') =
          regexp_replace(lower(trim(coalesce(v_member.affiliation, ''))), '\s+', ' ', 'g')
      and (h.birth_year is null or v_member_birth_year is null or h.birth_year = v_member_birth_year)
      and exists (
        select 1 from public.club_members cm where cm.user_id = p.id
        union all
        select 1 from public.match_players mp where mp.user_id = p.id
      )
      and exists (
        select 1 from public.global_players gp
        where gp.id = p.global_player_id and gp.status = 'active'
      )
  loop
    if exists (
      select 1
      from public.player_identity_claims c
      where c.claim_type = 'guest_claim'
        and c.status in ('pending', 'approved', 'rejected')
        and (
          (c.source_global_player_id = v_guest.global_player_id
            and c.target_global_player_id = v_member.global_player_id)
          or
          (c.source_global_player_id = v_member.global_player_id
            and c.target_global_player_id = v_guest.global_player_id)
        )
    ) then
      continue;
    end if;

    insert into public.player_identity_claims (
      claim_type, source_profile_id, target_profile_id,
      source_global_player_id, target_global_player_id,
      evidence, requested_by
    ) values (
      'guest_claim', v_guest.id, v_member.id,
      v_guest.global_player_id, v_member.global_player_id,
      jsonb_build_object(
        'match_basis', 'signup_exact_name_award_affiliation',
        'source', jsonb_build_object(
          'profile_id', v_guest.id,
          'name', v_guest.name,
          'award_level', v_guest.award_level,
          'affiliation', v_guest.affiliation,
          'birth_year', v_guest.birth_year,
          'is_guest', v_guest.is_guest,
          'clubs', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
            from public.club_members cm
            join public.clubs c on c.id = cm.club_id
            where cm.user_id = v_guest.id and cm.status in ('pending', 'active')
          ), '[]'::jsonb),
          'confirmed_matches', (
            select count(*) from public.match_players mp
            join public.matches m on m.id = mp.match_id
            where mp.user_id = v_guest.id and m.status = 'confirmed'
          )
        ),
        'target', jsonb_build_object(
          'profile_id', v_member.id,
          'name', v_member.name,
          'award_level', v_member.award_level,
          'affiliation', v_member.affiliation,
          'birth_year', v_member_birth_year,
          'is_guest', v_member.is_guest,
          'clubs', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
            from public.club_members cm
            join public.clubs c on c.id = cm.club_id
            where cm.user_id = v_member.id and cm.status in ('pending', 'active')
          ), '[]'::jsonb),
          'confirmed_matches', (
            select count(*) from public.match_players mp
            join public.matches m on m.id = mp.match_id
            where mp.user_id = v_member.id and m.status = 'confirmed'
          )
        )
      ),
      auth.uid()
    )
    returning id into v_claim_id;

    insert into public.player_identity_events (
      correlation_id, event_type, source_global_player_id, target_global_player_id,
      profile_id, reason, actor_user_id
    ) values (
      gen_random_uuid(), 'claim_requested', v_guest.global_player_id,
      v_member.global_player_id, v_guest.id,
      'safe signup guest identity candidate', auth.uid()
    );
  end loop;

  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_award text := new.raw_user_meta_data ->> 'award_level';
  v_name text;
  v_award_level public.award_level;
  v_require_approval boolean;
  v_club_slug text := nullif(trim(new.raw_user_meta_data ->> 'club_slug'), '');
  v_club_id uuid;
  v_affiliation text := nullif(trim(new.raw_user_meta_data ->> 'affiliation'), '');
  v_birth_year_text text := nullif(trim(new.raw_user_meta_data ->> 'birth_year'), '');
  v_birth_year smallint;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  );

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

  if v_club_slug is null then
    raise exception '가입 시 클럽을 지정해야 합니다.';
  end if;
  select id into v_club_id from public.clubs where slug = lower(v_club_slug);
  if v_club_id is null then
    raise exception '존재하지 않는 클럽입니다.';
  end if;
  if v_affiliation is not null and char_length(v_affiliation) > 40 then
    raise exception '소속은 40자 이하로 입력해주세요.';
  end if;
  if v_birth_year_text is not null then
    if v_birth_year_text !~ '^[0-9]{4}$' then
      raise exception '출생연도를 확인해주세요.';
    end if;
    v_birth_year := v_birth_year_text::smallint;
    if v_birth_year not between 1900 and extract(year from current_date)::integer then
      raise exception '출생연도를 확인해주세요.';
    end if;
  end if;

  v_require_approval := coalesce(
    (public.get_club_setting(v_club_id, 'require_signup_approval'))::boolean,
    true
  );

  -- Always create a distinct member profile. Never move references or delete
  -- a guest merely because signup metadata looks similar.
  insert into public.profiles (
    id, name, award_level, role, is_active, is_guest, is_platform_admin, affiliation
  ) values (
    new.id, v_name, v_award_level, 'user', true, false, false, v_affiliation
  );

  if v_birth_year is not null then
    insert into public.player_identity_hints (
      profile_id, birth_year, created_by, updated_by
    ) values (
      new.id, v_birth_year, new.id, new.id
    );
  end if;

  insert into public.club_members (club_id, user_id, role, status)
  values (
    v_club_id,
    new.id,
    'user',
    case when v_require_approval then 'pending' else 'active' end
  );

  return new;
end;
$$;

insert into public.app_settings (key, value, description)
values (
  'global_identity_guest_claim_enabled',
  'true'::jsonb,
  '신규가입 시 게스트 기록을 자동 이전하지 않고 플랫폼 관리자 검수 후보만 생성'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.create_guest_claim_candidates() from public, anon, authenticated;

commit;
