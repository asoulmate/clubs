\set ON_ERROR_STOP on

begin;

insert into public.profiles (
  id, name, award_level, role, is_active, is_guest, affiliation
) values
  ('48000000-0000-0000-0000-000000000001', 'Safe Signup Player', 'none', 'user', true, true, 'Shared Club'),
  ('48000000-0000-0000-0000-000000000002', ' Safe  Signup Player ', 'none', 'user', true, false, 'Shared  Club'),
  ('48000000-0000-0000-0000-000000000003', 'Safe Signup Player', 'none', 'user', true, true, 'Shared Club');

insert into public.player_identity_hints (profile_id, birth_year) values
  ('48000000-0000-0000-0000-000000000001', 1985),
  ('48000000-0000-0000-0000-000000000002', 1985),
  ('48000000-0000-0000-0000-000000000003', 1986);

insert into public.club_members (club_id, user_id, role, status)
select c.id, v.user_id, 'user', 'active'
from (
  values
    ('local-test-b', '48000000-0000-0000-0000-000000000001'::uuid),
    ('local-test-b', '48000000-0000-0000-0000-000000000003'::uuid)
) as v(slug, user_id)
join public.clubs c on c.slug = v.slug;

-- The non-guest membership insert represents the final step of safe signup.
-- It must create a review claim without moving or deleting guest records.
insert into public.club_members (club_id, user_id, role, status)
select id, '48000000-0000-0000-0000-000000000002', 'user', 'pending'
from public.clubs where slug = 'morning-star';

-- Exercise the real auth.users trigger path. The member must be created next
-- to the guest, not by transferring references and deleting the guest.
insert into public.profiles (
  id, name, award_level, role, is_active, is_guest, affiliation
) values (
  '48000000-0000-0000-0000-000000000011',
  'Auth Trigger Player', 'none', 'user', true, true, 'Trigger Club'
);
insert into public.player_identity_hints (profile_id, birth_year)
values ('48000000-0000-0000-0000-000000000011', 1990);
insert into public.club_members (club_id, user_id, role, status)
select id, '48000000-0000-0000-0000-000000000011', 'user', 'active'
from public.clubs where slug = 'local-test-b';

insert into auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '48000000-0000-0000-0000-000000000012',
  'authenticated', 'authenticated', 'safe-signup-trigger@example.test', '',
  '{}'::jsonb,
  jsonb_build_object(
    'name', 'Auth Trigger Player',
    'award_level', 'none',
    'club_slug', 'morning-star',
    'affiliation', 'Trigger Club',
    'birth_year', 1990
  ),
  now(), now()
);

do $$
declare
  v_guest_global uuid;
  v_member_global uuid;
begin
  if coalesce((public.get_setting('global_identity_guest_claim_enabled'))::boolean, false) is not true then
    raise exception 'safe guest claim cutover flag is not enabled';
  end if;

  if (select count(*) from public.profiles
      where id in (
        '48000000-0000-0000-0000-000000000001',
        '48000000-0000-0000-0000-000000000002',
        '48000000-0000-0000-0000-000000000003'
      )) <> 3 then
    raise exception 'safe signup deleted a guest or member profile';
  end if;

  select global_player_id into v_guest_global from public.profiles
  where id = '48000000-0000-0000-0000-000000000001';
  select global_player_id into v_member_global from public.profiles
  where id = '48000000-0000-0000-0000-000000000002';
  if v_guest_global = v_member_global then
    raise exception 'signup linked global identities before review';
  end if;

  if (select count(*) from public.player_identity_claims
      where claim_type = 'guest_claim'
        and status = 'pending'
        and source_profile_id = '48000000-0000-0000-0000-000000000001'
        and target_profile_id = '48000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'exact signup guest claim was not generated once';
  end if;

  if exists (
    select 1 from public.player_identity_claims
    where claim_type = 'guest_claim'
      and status = 'pending'
      and source_profile_id = '48000000-0000-0000-0000-000000000003'
      and target_profile_id = '48000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'different birth year guest became a signup claim';
  end if;

  if not exists (
    select 1 from public.club_members
    where user_id = '48000000-0000-0000-0000-000000000001'
      and status = 'active'
  ) then
    raise exception 'guest membership was changed by member signup';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = '48000000-0000-0000-0000-000000000011' and is_guest
  ) then
    raise exception 'auth signup trigger deleted its matching guest profile';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = '48000000-0000-0000-0000-000000000012'
      and not is_guest and is_active and affiliation = 'Trigger Club'
  ) then
    raise exception 'auth signup trigger did not create an independent active member profile';
  end if;
  if (select birth_year from public.player_identity_hints
      where profile_id = '48000000-0000-0000-0000-000000000012') <> 1990 then
    raise exception 'auth signup trigger did not preserve private birth year';
  end if;
  if not exists (
    select 1 from public.player_identity_claims
    where claim_type = 'guest_claim' and status = 'pending'
      and source_profile_id = '48000000-0000-0000-0000-000000000011'
      and target_profile_id = '48000000-0000-0000-0000-000000000012'
  ) then
    raise exception 'auth signup trigger did not create a review claim';
  end if;
end;
$$;

\echo 'safe guest signup claim PASS'
rollback;
