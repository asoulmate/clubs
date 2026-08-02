\set ON_ERROR_STOP on

begin;

insert into public.profiles (
  id, name, award_level, role, is_active, is_guest, affiliation
) values
  ('47000000-0000-0000-0000-000000000001', 'Guest Link Test', 'none', 'user', true, true, 'Same Club'),
  ('47000000-0000-0000-0000-000000000002', ' Guest   Link Test ', 'none', 'user', true, true, 'Same  Club'),
  ('47000000-0000-0000-0000-000000000003', 'Guest Link Test', 'none', 'user', true, true, 'Same Club'),
  ('47000000-0000-0000-0000-000000000004', 'Guest Link Test', 'none', 'user', true, true, 'Different Club');

insert into public.player_identity_hints (profile_id, birth_year) values
  ('47000000-0000-0000-0000-000000000001', 1980),
  ('47000000-0000-0000-0000-000000000002', 1980),
  ('47000000-0000-0000-0000-000000000003', 1981),
  ('47000000-0000-0000-0000-000000000004', 1980);

insert into public.club_members (club_id, user_id, role, status)
select c.id, v.user_id, 'user', 'active'
from (
  values
    ('morning-star', '47000000-0000-0000-0000-000000000001'::uuid),
    ('local-test-b', '47000000-0000-0000-0000-000000000002'::uuid),
    ('local-test-b', '47000000-0000-0000-0000-000000000003'::uuid),
    ('local-test-b', '47000000-0000-0000-0000-000000000004'::uuid)
) as v(slug, user_id)
join public.clubs c on c.slug = v.slug;

set local role authenticated;
select set_config('request.jwt.claim.sub', '56f23bbf-c7a2-47ba-aefd-95aaf57e8b4c', true);
select (public.create_guest_profile_v2(
  'Guest Birth Split',
  (select id from public.clubs where slug = 'morning-star'),
  'none', 'Birth Test Club', 1970::smallint
)).id;
select (public.create_guest_profile_v2(
  'Guest Birth Split',
  (select id from public.clubs where slug = 'morning-star'),
  'none', 'Birth Test Club', 1971::smallint
)).id;
select (public.create_guest_profile_v2(
  'Guest Birth Split',
  (select id from public.clubs where slug = 'morning-star'),
  'none', 'Birth Test Club', 1970::smallint
)).id;
reset role;

do $$
begin
  if (select count(*) from public.profiles where name = 'Guest Birth Split') <> 2 then
    raise exception 'birth year must distinguish same-name guests and reuse exact matches';
  end if;
  if (select count(distinct h.birth_year)
      from public.player_identity_hints h
      join public.profiles p on p.id = h.profile_id
      where p.name = 'Guest Birth Split') <> 2 then
    raise exception 'private guest birth-year hints were not preserved';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'dabb197e-7412-4e32-80f8-0cf607f10eec', true);
do $$
begin
  perform public.refresh_guest_identity_claim_candidates_v2();
  raise exception 'non-platform caller unexpectedly refreshed identity claims';
exception
  when others then
    if sqlerrm = 'non-platform caller unexpectedly refreshed identity claims' then raise; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '56f23bbf-c7a2-47ba-aefd-95aaf57e8b4c', true);
select public.refresh_guest_identity_claim_candidates_v2();
reset role;

do $$
begin
  if (select count(*) from public.player_identity_claims
      where status = 'pending'
        and source_profile_id in (
          '47000000-0000-0000-0000-000000000001',
          '47000000-0000-0000-0000-000000000002'
        )
        and target_profile_id in (
          '47000000-0000-0000-0000-000000000001',
          '47000000-0000-0000-0000-000000000002'
        )) <> 1 then
    raise exception 'exact cross-club guest pair was not generated once';
  end if;

  if exists (
    select 1 from public.player_identity_claims
    where status = 'pending'
      and (
        source_profile_id in (
          '47000000-0000-0000-0000-000000000003',
          '47000000-0000-0000-0000-000000000004'
        )
        or target_profile_id in (
          '47000000-0000-0000-0000-000000000003',
          '47000000-0000-0000-0000-000000000004'
        )
      )
  ) then
    raise exception 'different birth year or affiliation guest must not become a candidate';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '56f23bbf-c7a2-47ba-aefd-95aaf57e8b4c', true);
select public.review_identity_claim_v2(
  (
    select claim_id from public.list_pending_identity_claims_v2()
    where true
      and source_profile_id in (
        '47000000-0000-0000-0000-000000000001',
        '47000000-0000-0000-0000-000000000002'
      )
      and target_profile_id in (
        '47000000-0000-0000-0000-000000000001',
        '47000000-0000-0000-0000-000000000002'
      )
    limit 1
  ),
  true,
  'guest identity regression approval'
);
reset role;

do $$
declare
  v_first uuid;
  v_second uuid;
  v_other uuid;
  v_other_affiliation uuid;
begin
  select global_player_id into v_first from public.profiles
  where id = '47000000-0000-0000-0000-000000000001';
  select global_player_id into v_second from public.profiles
  where id = '47000000-0000-0000-0000-000000000002';
  select global_player_id into v_other from public.profiles
  where id = '47000000-0000-0000-0000-000000000003';
  select global_player_id into v_other_affiliation from public.profiles
  where id = '47000000-0000-0000-0000-000000000004';

  if v_first is distinct from v_second then
    raise exception 'approved guest profiles were not linked';
  end if;
  if v_first = v_other then
    raise exception 'different birth year guest was incorrectly linked';
  end if;
  if v_first = v_other_affiliation then
    raise exception 'different affiliation guest was incorrectly linked';
  end if;
  if (select count(*) from public.profiles
      where id in (
        '47000000-0000-0000-0000-000000000001',
        '47000000-0000-0000-0000-000000000002'
      )) <> 2 then
    raise exception 'profile rows must be preserved';
  end if;
  if (select count(*) from public.club_members
      where user_id in (
        '47000000-0000-0000-0000-000000000001',
        '47000000-0000-0000-0000-000000000002'
      )) <> 2 then
    raise exception 'club memberships must be preserved';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '56f23bbf-c7a2-47ba-aefd-95aaf57e8b4c', true);
select public.refresh_guest_identity_claim_candidates_v2();
reset role;

do $$
begin
  if exists (
    select 1 from public.player_identity_claims
    where status = 'pending'
      and source_profile_id in (
        '47000000-0000-0000-0000-000000000001',
        '47000000-0000-0000-0000-000000000002'
      )
      and target_profile_id in (
        '47000000-0000-0000-0000-000000000001',
        '47000000-0000-0000-0000-000000000002'
      )
  ) then
    raise exception 'approved pair was recreated';
  end if;
end;
$$;

\echo 'guest global identity linking PASS'
rollback;
