-- ============================================================
-- 33_award_level_7_migrate.sql
-- ※ 32_award_level_7.sql 실행·커밋 후 이어서 실행
-- 기존 4단계 → 7단계(입상) 이관 + 회원가입 트리거 갱신
-- ============================================================

-- 기존 라벨을 "입상" 쪽으로 이관 (우승은 관리자가 수동 재지정)
update public.profiles set award_level = 'open_place' where award_level::text = 'open';
update public.profiles set award_level = 'national_rookie_place' where award_level::text = 'national_rookie';
update public.profiles set award_level = 'local_rookie_place' where award_level::text = 'local_rookie';

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
  v_club_slug text := nullif(trim(new.raw_user_meta_data ->> 'club_slug'), '');
  v_club_id uuid;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  );

  v_award_level := case
    when v_award in (
      'open_champion', 'open_place',
      'national_rookie_champion', 'national_rookie_place',
      'local_rookie_champion', 'local_rookie_place',
      'none'
    ) then v_award::public.award_level
    -- 구 클라이언트 호환
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

  v_require_approval := coalesce(
    (public.get_club_setting(v_club_id, 'require_signup_approval'))::boolean,
    true
  );

  select cm.user_id into v_guest_id
  from public.club_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.club_id = v_club_id
    and p.is_guest = true
    and lower(trim(p.name)) = lower(trim(v_name))
  order by
    case when p.award_level = v_award_level then 0 else 1 end,
    p.created_at asc
  limit 1;

  insert into public.profiles (id, name, award_level, role, is_active, is_guest, is_platform_admin)
  values (
    new.id,
    v_name,
    v_award_level,
    'user',
    not v_require_approval,
    false,
    false
  );

  if v_guest_id is not null then
    perform public.transfer_profile_refs(v_guest_id, new.id);
    delete from public.club_members where user_id = v_guest_id;
    delete from public.profiles where id = v_guest_id;
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
