\set ON_ERROR_STOP on

begin;

-- Case 1: rejecting club 2 must preserve the platform account and club 1.
update public.profiles
set is_active = true
where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec';

update public.club_members
set status = case when club_id = (select id from public.clubs where slug = 'local-test-b')
                  then 'pending' else 'active' end
where user_id = 'dabb197e-7412-4e32-80f8-0cf607f10eec';

set local role authenticated;
select set_config('request.jwt.claim.sub', '795bcf56-5538-49e2-9114-edbb9da69078', true);
select public.approve_club_member(
  (select id from public.clubs where slug = 'local-test-b'),
  'dabb197e-7412-4e32-80f8-0cf607f10eec',
  false
);
reset role;

do $$
begin
  if not exists (select 1 from public.profiles where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and is_active) then
    raise exception 'case 1: profile was deactivated';
  end if;
  if not exists (
    select 1 from public.club_members cm join public.clubs c on c.id = cm.club_id
    where cm.user_id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and c.slug = 'morning-star' and cm.status = 'active'
  ) then raise exception 'case 1: club 1 membership changed'; end if;
  if not exists (
    select 1 from public.club_members cm join public.clubs c on c.id = cm.club_id
    where cm.user_id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and c.slug = 'local-test-b' and cm.status = 'rejected'
  ) then raise exception 'case 1: club 2 was not rejected'; end if;
  if not exists (select 1 from auth.users where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec') then
    raise exception 'case 1: auth user was removed';
  end if;
end;
$$;
\echo 'case 1 PASS'

-- Case 2: club 2 withdrawal must preserve Auth/profile/club 1.
update public.club_members set status = 'active'
where user_id = 'dabb197e-7412-4e32-80f8-0cf607f10eec';

set local role authenticated;
select set_config('request.jwt.claim.sub', '795bcf56-5538-49e2-9114-edbb9da69078', true);
do $$
begin
  perform public.admin_remove_user('dabb197e-7412-4e32-80f8-0cf607f10eec');
  raise exception 'case 2: legacy RPC unexpectedly succeeded';
exception
  when others then
    if sqlerrm = 'case 2: legacy RPC unexpectedly succeeded' then raise; end if;
end;
$$;
select public.admin_withdraw_club_member_v2(
  (select id from public.clubs where slug = 'local-test-b'),
  'dabb197e-7412-4e32-80f8-0cf607f10eec',
  'hotfix case 2'
);
reset role;

do $$
begin
  if not exists (select 1 from public.profiles where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and is_active) then
    raise exception 'case 2: profile was deactivated';
  end if;
  if not exists (select 1 from auth.users where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec') then
    raise exception 'case 2: auth user was removed';
  end if;
  if not exists (
    select 1 from public.club_members cm join public.clubs c on c.id = cm.club_id
    where cm.user_id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and c.slug = 'morning-star' and cm.status = 'active'
  ) then raise exception 'case 2: club 1 membership changed'; end if;
  if not exists (
    select 1 from public.club_members cm join public.clubs c on c.id = cm.club_id
    where cm.user_id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and c.slug = 'local-test-b' and cm.status = 'withdrawn'
  ) then raise exception 'case 2: club 2 was not withdrawn'; end if;
end;
$$;
\echo 'case 2 PASS'

-- Case 3: leaving the only club keeps the account active and leaves no active club.
update public.profiles set is_active = true
where id = '6d787d2f-3d7d-4c27-865d-fbe71d807adf';
update public.club_members set status = 'active'
where user_id = '6d787d2f-3d7d-4c27-865d-fbe71d807adf';

set local role authenticated;
select set_config('request.jwt.claim.sub', '6d787d2f-3d7d-4c27-865d-fbe71d807adf', true);
select public.self_withdraw_club_v2(
  (select id from public.clubs where slug = 'local-test-b'),
  'hotfix case 3'
);
reset role;

do $$
begin
  if not exists (select 1 from public.profiles where id = '6d787d2f-3d7d-4c27-865d-fbe71d807adf' and is_active) then
    raise exception 'case 3: profile was deactivated';
  end if;
  if exists (select 1 from public.club_members where user_id = '6d787d2f-3d7d-4c27-865d-fbe71d807adf' and status = 'active') then
    raise exception 'case 3: active membership remains';
  end if;
  if not exists (select 1 from auth.users where id = '6d787d2f-3d7d-4c27-865d-fbe71d807adf') then
    raise exception 'case 3: auth user was removed';
  end if;
end;
$$;
\echo 'case 3 PASS'

-- Case 4: only the platform RPC changes platform account activity.
update public.profiles set is_active = true
where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec';

set local role authenticated;
select set_config('request.jwt.claim.sub', '56f23bbf-c7a2-47ba-aefd-95aaf57e8b4c', true);
select public.platform_set_account_active_v2(
  'dabb197e-7412-4e32-80f8-0cf607f10eec',
  false,
  'hotfix case 4'
);
reset role;

do $$
begin
  if exists (select 1 from public.profiles where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec' and is_active) then
    raise exception 'case 4: platform suspension did not apply';
  end if;
  if not exists (select 1 from auth.users where id = 'dabb197e-7412-4e32-80f8-0cf607f10eec') then
    raise exception 'case 4: suspension unexpectedly deleted Auth user';
  end if;
end;
$$;
\echo 'case 4 PASS'

rollback;
