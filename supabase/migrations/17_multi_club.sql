-- ============================================================
-- 17_multi_club.sql
-- ?? ??: clubs / club_members / club_settings / club_id ??
-- ?? ??? ? slug=morning-star ???? ??
-- ============================================================

-- ------------------------------------------------------------
-- 1. ??? ?? ??? ???
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

comment on column public.profiles.is_platform_admin is
  'true? ??? ?????(?? ??·?? ??). ?? ???? ??.';

-- ?? admin ? ??? ?? (?? ??)
update public.profiles set is_platform_admin = true where role = 'admin';

-- ------------------------------------------------------------
-- 2. clubs
-- ------------------------------------------------------------
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  youtube_enabled boolean not null default true,
  absence_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_clubs_slug unique (slug),
  constraint chk_clubs_slug check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$')
);

comment on table public.clubs is '??. slug? URL #/c/{slug} ? ??. ??? ???.';

create index if not exists idx_clubs_slug on public.clubs (slug);

alter table public.clubs enable row level security;

-- ------------------------------------------------------------
-- 3. club_members
-- ------------------------------------------------------------
create table if not exists public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.user_role not null default 'user',
  status text not null default 'active'
    check (status in ('pending', 'active', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

comment on table public.club_members is '?? ???. ??·??? ?? ??.';

create index if not exists idx_club_members_user on public.club_members (user_id);
create index if not exists idx_club_members_club_status on public.club_members (club_id, status);

alter table public.club_members enable row level security;

-- ------------------------------------------------------------
-- 4. club_settings (??? app_settings)
-- ------------------------------------------------------------
create table if not exists public.club_settings (
  club_id uuid not null references public.clubs (id) on delete cascade,
  key text not null,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  primary key (club_id, key)
);

alter table public.club_settings enable row level security;

-- ------------------------------------------------------------
-- 5. matches / absences ? club_id
-- ------------------------------------------------------------
alter table public.matches
  add column if not exists club_id uuid references public.clubs (id);

alter table public.unexcused_absences
  add column if not exists club_id uuid references public.clubs (id);

-- ------------------------------------------------------------
-- 6. ?? ?? ?? + ??? ??
-- ------------------------------------------------------------
insert into public.clubs (id, name, slug, youtube_enabled, absence_enabled)
select gen_random_uuid(), '????', 'morning-star', true, true
where not exists (select 1 from public.clubs where slug = 'morning-star');

do $$
declare
  v_club uuid;
begin
  select id into v_club from public.clubs where slug = 'morning-star' limit 1;

  update public.matches set club_id = v_club where club_id is null;
  update public.unexcused_absences set club_id = v_club where club_id is null;

  insert into public.club_members (club_id, user_id, role, status)
  select v_club, p.id, p.role, case when p.is_active then 'active' else 'pending' end
  from public.profiles p
  on conflict (club_id, user_id) do nothing;

  insert into public.club_settings (club_id, key, value, description, updated_at, updated_by)
  select v_club, s.key, s.value, s.description, s.updated_at, s.updated_by
  from public.app_settings s
  on conflict (club_id, key) do nothing;
end $$;

-- NOT NULL (?? ?)
alter table public.matches alter column club_id set not null;
alter table public.unexcused_absences alter column club_id set not null;

create index if not exists idx_matches_club_date on public.matches (club_id, match_date);
create index if not exists idx_absences_club_date on public.unexcused_absences (club_id, absence_date);

-- ?? ???? ?? ???
alter table public.unexcused_absences drop constraint if exists uq_absence_date_user;
alter table public.unexcused_absences
  add constraint uq_absence_club_date_user unique (club_id, absence_date, user_id);

-- ------------------------------------------------------------
-- 7. ??
-- ------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select is_platform_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.get_club_role(p_club_id uuid)
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select cm.role
  from public.club_members cm
  where cm.club_id = p_club_id
    and cm.user_id = auth.uid()
    and cm.status = 'active'
$$;

create or replace function public.is_club_admin_or_sub(p_club_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role in ('admin', 'sub_admin')
    );
$$;

create or replace function public.is_active_club_member(p_club_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      join public.profiles p on p.id = cm.user_id
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and p.is_active = true
    );
$$;

create or replace function public.assert_club_member(p_club_id uuid)
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '???? ?????.';
  end if;
  if not public.is_active_club_member(p_club_id) then
    raise exception '? ??? ?? ??? ??? ? ????.';
  end if;
end;
$$;

create or replace function public.get_club_setting(p_club_id uuid, p_key text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select value from public.club_settings where club_id = p_club_id and key = p_key;
$$;

-- ------------------------------------------------------------
-- 8. RLS
-- ------------------------------------------------------------
drop policy if exists "clubs_select" on public.clubs;
create policy "clubs_select" on public.clubs for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.club_members cm
    where cm.club_id = clubs.id and cm.user_id = auth.uid()
  )
  -- ?? ???: ???? ?? ??? RPC ??. ??? ??/???.
);

drop policy if exists "club_members_select" on public.club_members;
create policy "club_members_select" on public.club_members for select to authenticated
using (
  public.is_platform_admin()
  or user_id = auth.uid()
  or public.is_active_club_member(club_id)
);

drop policy if exists "club_settings_select" on public.club_settings;
create policy "club_settings_select" on public.club_settings for select to authenticated
using (public.is_active_club_member(club_id) or public.is_platform_admin());

drop policy if exists "club_settings_update" on public.club_settings;
create policy "club_settings_update" on public.club_settings for update to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.club_members cm
    where cm.club_id = club_settings.club_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'admin'
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.club_members cm
    where cm.club_id = club_settings.club_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'admin'
  )
);

-- matches: ?? ???
drop policy if exists "matches_select_authenticated" on public.matches;
create policy "matches_select_authenticated" on public.matches for select to authenticated
using (public.is_active_club_member(club_id) or public.is_platform_admin());

drop policy if exists "absences_select_authenticated" on public.unexcused_absences;
create policy "absences_select_authenticated" on public.unexcused_absences for select to authenticated
using (public.is_active_club_member(club_id) or public.is_platform_admin());

-- ------------------------------------------------------------
-- 9. ?? CRUD / ?? RPC
-- ------------------------------------------------------------
create or replace function public.get_club_by_slug(p_slug text)
returns public.clubs
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_row public.clubs;
begin
  select * into v_row from public.clubs where slug = lower(trim(p_slug));
  if not found then
    raise exception '??? ?? ? ????.';
  end if;
  return v_row;
end;
$$;

-- ????? ????? ??? ?? ????? (anon)
grant execute on function public.get_club_by_slug(text) to anon, authenticated;

create or replace function public.list_my_clubs()
returns table (
  club_id uuid,
  name text,
  slug text,
  role public.user_role,
  status text,
  youtube_enabled boolean,
  absence_enabled boolean
)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, cm.role, cm.status, c.youtube_enabled, c.absence_enabled
  from public.club_members cm
  join public.clubs c on c.id = cm.club_id
  where cm.user_id = auth.uid()
  order by c.name;
$$;

create or replace function public.platform_list_clubs()
returns setof public.clubs
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception '?? ???? ?? ??? ??? ? ????.';
  end if;
  return query select * from public.clubs order by name;
end;
$$;

create or replace function public.platform_create_club(
  p_name text,
  p_slug text,
  p_youtube_enabled boolean default true,
  p_absence_enabled boolean default true
)
returns public.clubs
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_slug text := lower(trim(p_slug));
  v_row public.clubs;
  v_key text;
begin
  if not public.is_platform_admin() then
    raise exception '?? ??? ?? ???? ? ? ????.';
  end if;
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception '?? ??? 1~40?? ??????.';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$' then
    raise exception '???? ?? ???·??·???? ?????.';
  end if;
  if v_slug in ('login','signup','admin','settings','results','players','platform','select-club','c','api') then
    raise exception '??? ???? ??? ? ????.';
  end if;

  insert into public.clubs (name, slug, youtube_enabled, absence_enabled)
  values (v_name, v_slug, coalesce(p_youtube_enabled, true), coalesce(p_absence_enabled, true))
  returning * into v_row;

  -- ?? ?? ?? (??? app_settings ???)
  for v_key in select key from public.app_settings
  loop
    insert into public.club_settings (club_id, key, value, description)
    select v_row.id, s.key, s.value, s.description
    from public.app_settings s where s.key = v_key
    on conflict do nothing;
  end loop;

  -- ??? ?? ???
  insert into public.club_settings (club_id, key, value, description) values
    (v_row.id, 'confirm_mode', '"double"', '??? ?? ??'),
    (v_row.id, 'allow_tie', 'false', '?? ??'),
    (v_row.id, 'score_max', '99', '?? ??'),
    (v_row.id, 'min_matches_for_ranking', '0', '?? ?? ??'),
    (v_row.id, 'allow_proxy_registration', 'true', '?? ??'),
    (v_row.id, 'require_signup_approval', 'true', '?? ??'),
    (v_row.id, 'youtube_channel_handle', '""', '??? ??'),
    (v_row.id, 'youtube_upload_delay_days', '2', '??? ?? ??')
  on conflict do nothing;

  return v_row;
end;
$$;

create or replace function public.platform_update_club(
  p_club_id uuid,
  p_name text default null,
  p_youtube_enabled boolean default null,
  p_absence_enabled boolean default null
)
returns public.clubs
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.clubs;
begin
  if not public.is_platform_admin() then
    raise exception '?? ???? ??? ??? ? ????.';
  end if;
  select * into v_row from public.clubs where id = p_club_id for update;
  if not found then raise exception '??? ?? ? ????.'; end if;

  update public.clubs set
    name = coalesce(nullif(trim(p_name), ''), name),
    youtube_enabled = coalesce(p_youtube_enabled, youtube_enabled),
    absence_enabled = coalesce(p_absence_enabled, absence_enabled),
    updated_at = now()
  where id = p_club_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_club_feature_flags(
  p_club_id uuid,
  p_youtube_enabled boolean default null,
  p_absence_enabled boolean default null
)
returns public.clubs
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.clubs;
begin
  perform public.assert_active_caller();
  -- ?? ?? ?? admin
  if not (
    public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid()
        and cm.status = 'active' and cm.role = 'admin'
    )
  ) then
    raise exception '?? ??? ?? ?? ?? ???? ??? ? ????.';
  end if;

  update public.clubs set
    youtube_enabled = coalesce(p_youtube_enabled, youtube_enabled),
    absence_enabled = coalesce(p_absence_enabled, absence_enabled),
    updated_at = now()
  where id = p_club_id
  returning * into v_row;
  if not found then raise exception '??? ?? ? ????.'; end if;
  return v_row;
end;
$$;

-- ?? ?? (?? ?? ??)
create or replace function public.request_club_join(p_club_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '???? ?????.'; end if;
  if not exists (select 1 from public.clubs where id = p_club_id) then
    raise exception '??? ?? ? ????.';
  end if;
  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, auth.uid(), 'user', 'pending')
  on conflict (club_id, user_id) do update
    set status = case
      when club_members.status = 'rejected' then 'pending'
      else club_members.status
    end,
    updated_at = now()
  where club_members.status in ('rejected');
end;
$$;

create or replace function public.approve_club_member(
  p_club_id uuid,
  p_user_id uuid,
  p_approve boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_club_admin_or_sub(p_club_id) then
    raise exception '?? ??? ?? ???/??? ?????.';
  end if;
  update public.club_members
  set status = case when p_approve then 'active' else 'rejected' end,
      updated_at = now()
  where club_id = p_club_id and user_id = p_user_id;
  if not found then raise exception '???? ?? ? ????.'; end if;

  -- ?? ? ???? ???
  if p_approve then
    update public.profiles set is_active = true where id = p_user_id;
  end if;
end;
$$;

create or replace function public.set_club_member_role(
  p_club_id uuid,
  p_user_id uuid,
  p_role public.user_role
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  -- ?? admin ?? ??
  if not (
    public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid()
        and cm.status = 'active' and cm.role = 'admin'
    )
  ) then
    raise exception '?? ??? ?? ???? ?????.';
  end if;
  if p_user_id = auth.uid() then
    raise exception '?? ??? ??? ??? ? ????.';
  end if;
  update public.club_members
  set role = p_role, updated_at = now()
  where club_id = p_club_id and user_id = p_user_id and status = 'active';
  if not found then raise exception '?? ??? ?? ? ????.'; end if;
end;
$$;

-- ------------------------------------------------------------
-- 10. ???? ???: club_slug ?? ? pending ???
-- ------------------------------------------------------------
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
    when v_award in ('open', 'national_rookie', 'local_rookie', 'none')
      then v_award::public.award_level
    else 'none'::public.award_level
  end;

  if v_club_slug is null then
    raise exception '?? ? ??? ???? ???.';
  end if;

  select id into v_club_id from public.clubs where slug = lower(v_club_slug);
  if v_club_id is null then
    raise exception '???? ?? ?????.';
  end if;

  v_require_approval := coalesce(
    (public.get_club_setting(v_club_id, 'require_signup_approval'))::boolean,
    true
  );

  -- ?? ? ?? ??? ??
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

-- ------------------------------------------------------------
-- 11. create_match / create_guest / absences ? club_id
-- ------------------------------------------------------------
-- ??? ???? ?? ? club_id ?? ??
drop function if exists public.create_match(date, uuid, uuid, uuid);

create or replace function public.create_match(
  p_match_date date,
  p_club_id uuid,
  p_a2 uuid default null,
  p_b1 uuid default null,
  p_b2 uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_ids uuid[];
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if p_match_date is null then
    raise exception '?? ??? ??????.';
  end if;

  v_ids := array_remove(array[auth.uid(), p_a2, p_b1, p_b2], null);
  if (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    raise exception '?? ???? ? ??? ? ? ??? ? ????.';
  end if;

  insert into public.matches (match_date, created_by, status, club_id)
  values (p_match_date, auth.uid(), 'open', p_club_id)
  returning id into v_match_id;

  perform public.internal_add_player(v_match_id, auth.uid(), 'A1');
  if p_a2 is not null then perform public.internal_add_player(v_match_id, p_a2, 'A2'); end if;
  if p_b1 is not null then perform public.internal_add_player(v_match_id, p_b1, 'B1'); end if;
  if p_b2 is not null then perform public.internal_add_player(v_match_id, p_b2, 'B2'); end if;

  return v_match_id;
end;
$$;

create or replace function public.create_guest_profile(
  p_name text,
  p_club_id uuid,
  p_award_level public.award_level default 'none',
  p_affiliation text default null
)
returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_aff text := nullif(trim(coalesce(p_affiliation, '')), '');
  v_row public.profiles;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception '??? ??? 1~30?? ??????.';
  end if;
  if p_award_level is null then
    raise exception '?? ??? ??????.';
  end if;
  if v_aff is null or char_length(v_aff) < 1 or char_length(v_aff) > 40 then
    raise exception '??? 1~40?? ??????.';
  end if;

  select p.* into v_row
  from public.profiles p
  join public.club_members cm on cm.user_id = p.id and cm.club_id = p_club_id
  where p.is_guest = true
    and cm.status = 'active'
    and lower(trim(p.name)) = lower(v_name)
    and p.award_level = p_award_level
    and lower(trim(coalesce(p.affiliation, ''))) = lower(v_aff)
  order by p.created_at asc
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.profiles (id, name, award_level, role, is_active, is_guest, affiliation)
  values (gen_random_uuid(), v_name, p_award_level, 'user', true, true, v_aff)
  returning * into v_row;

  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, v_row.id, 'user', 'active');

  return v_row;
end;
$$;

drop function if exists public.create_guest_profile(text, public.award_level, text);
drop function if exists public.create_guest_profile(text, public.award_level);

create or replace function public.add_unexcused_absence(
  p_absence_date date,
  p_user_id uuid,
  p_club_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_enabled boolean;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  select absence_enabled into v_enabled from public.clubs where id = p_club_id;
  if not coalesce(v_enabled, false) then
    raise exception '? ????? ???? ??? ???? ????.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then raise exception '???? ?? ? ????.'; end if;
  if not v_target.is_active then raise exception '??? ???? ?? ??? ? ????.'; end if;

  if not exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception '?? ?? ??? ?? ??? ? ????.';
  end if;

  insert into public.unexcused_absences (absence_date, user_id, registered_by, club_id)
  values (p_absence_date, p_user_id, auth.uid(), p_club_id)
  on conflict (club_id, absence_date, user_id) do nothing;
end;
$$;

drop function if exists public.add_unexcused_absence(date, uuid);

create or replace function public.remove_unexcused_absence(
  p_absence_date date,
  p_user_id uuid,
  p_club_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.unexcused_absences;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  select * into v_row
  from public.unexcused_absences
  where absence_date = p_absence_date and user_id = p_user_id and club_id = p_club_id;

  if not found then
    raise exception '?? ?? ?? ??? ?? ? ????.';
  end if;

  if not public.is_club_admin_or_sub(p_club_id) and v_row.registered_by <> auth.uid() then
    raise exception '??? ??? ?? ?? ???? ??? ? ????.';
  end if;

  delete from public.unexcused_absences
  where club_id = p_club_id and absence_date = p_absence_date and user_id = p_user_id;
end;
$$;

drop function if exists public.remove_unexcused_absence(date, uuid);

-- ------------------------------------------------------------
-- 12. ?? RPC? club_id ?? (get_player_stats)
-- ------------------------------------------------------------
drop function if exists public.get_player_stats(date, date);

create function public.get_player_stats(p_from date, p_to date, p_club_id uuid)
returns table (
  user_id uuid,
  name text,
  award_level public.award_level,
  matches_played bigint,
  wins bigint,
  losses bigint,
  ties bigint,
  points_for bigint,
  points_against bigint,
  days_participated bigint,
  total_match_days bigint,
  absences bigint,
  is_guest boolean,
  affiliation text
)
language sql stable security definer
set search_path = public
as $$
  with registered as (
    select m.id, m.match_date, m.status, m.team_a_score, m.team_b_score
    from public.matches m
    where m.status <> 'canceled'
      and m.club_id = p_club_id
      and m.match_date between p_from and p_to
  ),
  confirmed as (
    select r.id, r.match_date, r.team_a_score, r.team_b_score
    from registered r
    where r.status = 'confirmed'
  ),
  total_days as (
    select count(distinct r.match_date) as cnt from registered r
  ),
  per_player_results as (
    select
      mp.user_id,
      count(*) as matches_played,
      count(*) filter (where
        case when public.position_team(mp.position) = 'A'
          then c.team_a_score > c.team_b_score
          else c.team_b_score > c.team_a_score end) as wins,
      count(*) filter (where
        case when public.position_team(mp.position) = 'A'
          then c.team_a_score < c.team_b_score
          else c.team_b_score < c.team_a_score end) as losses,
      count(*) filter (where c.team_a_score = c.team_b_score) as ties,
      sum(case when public.position_team(mp.position) = 'A' then c.team_a_score else c.team_b_score end) as points_for,
      sum(case when public.position_team(mp.position) = 'A' then c.team_b_score else c.team_a_score end) as points_against
    from public.match_players mp
    join confirmed c on c.id = mp.match_id
    group by mp.user_id
  ),
  per_player_days as (
    select mp.user_id, count(distinct r.match_date) as days_participated
    from public.match_players mp
    join registered r on r.id = mp.match_id
    group by mp.user_id
  ),
  per_absence as (
    select a.user_id, count(*) as absences
    from public.unexcused_absences a
    where a.club_id = p_club_id and a.absence_date between p_from and p_to
    group by a.user_id
  ),
  all_users as (
    select user_id from per_player_results
    union select user_id from per_player_days
    union select user_id from per_absence
  )
  select
    u.user_id, p.name, p.award_level,
    coalesce(pr.matches_played, 0), coalesce(pr.wins, 0), coalesce(pr.losses, 0), coalesce(pr.ties, 0),
    coalesce(pr.points_for, 0), coalesce(pr.points_against, 0),
    coalesce(pd.days_participated, 0),
    (select cnt from total_days),
    coalesce(pa.absences, 0),
    p.is_guest,
    nullif(trim(coalesce(p.affiliation, '')), '')
  from all_users u
  join public.profiles p on p.id = u.user_id
  left join per_player_results pr on pr.user_id = u.user_id
  left join per_player_days pd on pd.user_id = u.user_id
  left join per_absence pa on pa.user_id = u.user_id
  where auth.uid() is not null
    and (
      public.is_platform_admin()
      or exists (
        select 1 from public.club_members cm
        where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
      )
    );
$$;

-- ------------------------------------------------------------
-- 13. ?????? ????: ?÷??? ???? + ??? ????? ????
-- ------------------------------------------------------------
create or replace function public.is_admin_or_sub()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or coalesce(public.get_my_role() in ('admin', 'sub_admin'), false)
    or exists (
      select 1 from public.club_members cm
      where cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role in ('admin', 'sub_admin')
    );
$$;

-- ??? ??? ??? ??? ???(??? ????) ????
create or replace function public.assert_match_club_member(p_match_id uuid)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.matches where id = p_match_id;
  if v_club_id is null then
    raise exception '??? ã?? ?? ???????.';
  end if;
  perform public.assert_club_member(v_club_id);
end;
$$;

-- ------------------------------------------------------------
-- 14. ?????/???/????/??? ??? ??? ? club_id
-- ------------------------------------------------------------
drop function if exists public.get_partner_stats(uuid, date, date);

create function public.get_partner_stats(
  p_user_id uuid, p_from date, p_to date, p_club_id uuid
)
returns table (
  partner_id uuid,
  partner_name text,
  partner_award public.award_level,
  matches_played bigint,
  wins bigint,
  losses bigint,
  ties bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    partner.user_id,
    pr.name,
    pr.award_level,
    count(*) as matches_played,
    count(*) filter (where
      case when public.position_team(me.position) = 'A'
        then m.team_a_score > m.team_b_score
        else m.team_b_score > m.team_a_score end) as wins,
    count(*) filter (where
      case when public.position_team(me.position) = 'A'
        then m.team_a_score < m.team_b_score
        else m.team_b_score < m.team_a_score end) as losses,
    count(*) filter (where m.team_a_score = m.team_b_score) as ties
  from public.match_players me
  join public.matches m
    on m.id = me.match_id
   and m.status = 'confirmed'
   and m.club_id = p_club_id
   and m.match_date between p_from and p_to
  join public.match_players partner
    on partner.match_id = me.match_id
   and partner.user_id <> me.user_id
   and public.position_team(partner.position) = public.position_team(me.position)
  join public.profiles pr on pr.id = partner.user_id
  where me.user_id = p_user_id
    and auth.uid() is not null
    and (public.is_platform_admin() or public.is_active_club_member(p_club_id))
  group by partner.user_id, pr.name, pr.award_level
  order by count(*) desc, pr.name asc;
$$;

drop function if exists public.get_opponent_stats(uuid, date, date);

create function public.get_opponent_stats(
  p_user_id uuid, p_from date, p_to date, p_club_id uuid
)
returns table (
  opponent_id uuid,
  opponent_name text,
  opponent_award public.award_level,
  matches_played bigint,
  wins bigint,
  losses bigint,
  ties bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    opp.user_id,
    pr.name,
    pr.award_level,
    count(*) as matches_played,
    count(*) filter (where
      case when public.position_team(me.position) = 'A'
        then m.team_a_score > m.team_b_score
        else m.team_b_score > m.team_a_score end) as wins,
    count(*) filter (where
      case when public.position_team(me.position) = 'A'
        then m.team_a_score < m.team_b_score
        else m.team_b_score < m.team_a_score end) as losses,
    count(*) filter (where m.team_a_score = m.team_b_score) as ties
  from public.match_players me
  join public.matches m
    on m.id = me.match_id
   and m.status = 'confirmed'
   and m.club_id = p_club_id
   and m.match_date between p_from and p_to
  join public.match_players opp
    on opp.match_id = me.match_id
   and opp.user_id <> me.user_id
   and public.position_team(opp.position) <> public.position_team(me.position)
  join public.profiles pr on pr.id = opp.user_id
  where me.user_id = p_user_id
    and auth.uid() is not null
    and (public.is_platform_admin() or public.is_active_club_member(p_club_id))
  group by opp.user_id, pr.name, pr.award_level
  order by count(*) desc, pr.name asc;
$$;

drop function if exists public.get_player_monthly_trend(uuid, integer);

create function public.get_player_monthly_trend(
  p_user_id uuid, p_months integer default 12, p_club_id uuid default null
)
returns table (
  month text,
  matches_played bigint,
  wins bigint,
  losses bigint,
  days_participated bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    to_char(m.match_date, 'YYYY-MM') as month,
    count(*) as matches_played,
    count(*) filter (where
      case when public.position_team(mp.position) = 'A'
        then m.team_a_score > m.team_b_score
        else m.team_b_score > m.team_a_score end) as wins,
    count(*) filter (where
      case when public.position_team(mp.position) = 'A'
        then m.team_a_score < m.team_b_score
        else m.team_b_score < m.team_a_score end) as losses,
    count(distinct m.match_date) as days_participated
  from public.match_players mp
  join public.matches m on m.id = mp.match_id and m.status = 'confirmed'
  where mp.user_id = p_user_id
    and (p_club_id is null or m.club_id = p_club_id)
    and m.match_date >= (current_date - make_interval(months => p_months))::date
    and auth.uid() is not null
    and (
      p_club_id is null
      or public.is_platform_admin()
      or public.is_active_club_member(p_club_id)
    )
  group by to_char(m.match_date, 'YYYY-MM')
  order by month asc;
$$;

drop function if exists public.get_player_recent_matches(uuid, integer);

create function public.get_player_recent_matches(
  p_user_id uuid, p_limit integer default 10, p_club_id uuid default null
)
returns table (
  match_id uuid,
  match_date date,
  my_team public.team_side,
  team_a_score integer,
  team_b_score integer,
  result text,
  partner_names text[],
  partner_awards public.award_level[],
  opponent_names text[],
  opponent_awards public.award_level[]
)
language sql stable security definer
set search_path = public
as $$
  select
    m.id,
    m.match_date,
    public.position_team(me.position) as my_team,
    m.team_a_score,
    m.team_b_score,
    case
      when m.team_a_score = m.team_b_score then 'tie'
      when (public.position_team(me.position) = 'A') = (m.team_a_score > m.team_b_score) then 'win'
      else 'loss'
    end as result,
    (select coalesce(array_agg(pr.name order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and t.user_id <> me.user_id
        and public.position_team(t.position) = public.position_team(me.position)) as partner_names,
    (select coalesce(array_agg(pr.award_level order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and t.user_id <> me.user_id
        and public.position_team(t.position) = public.position_team(me.position)) as partner_awards,
    (select coalesce(array_agg(pr.name order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and public.position_team(t.position) <> public.position_team(me.position)) as opponent_names,
    (select coalesce(array_agg(pr.award_level order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and public.position_team(t.position) <> public.position_team(me.position)) as opponent_awards
  from public.match_players me
  join public.matches m on m.id = me.match_id and m.status = 'confirmed'
  where me.user_id = p_user_id
    and (p_club_id is null or m.club_id = p_club_id)
    and auth.uid() is not null
    and (
      p_club_id is null
      or public.is_platform_admin()
      or public.is_active_club_member(p_club_id)
    )
  order by m.match_date desc, m.created_at desc
  limit p_limit;
$$;

-- ------------------------------------------------------------
-- 15. ??? RPC: ??? ????? ???? ???? (??? ????)
--     ???? ??? ?????? ???????, ???? ?? assert_match_club_member ????????
--     register_player ?? ??? ????? ?????????? ??? ????? ????.
--     (is_admin_or_sub / is_active_club_member / RLS?? 1?? ???)
-- ------------------------------------------------------------

grant execute on function public.list_my_clubs() to authenticated;
grant execute on function public.platform_list_clubs() to authenticated;
grant execute on function public.platform_create_club(text, text, boolean, boolean) to authenticated;
grant execute on function public.platform_update_club(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.update_club_feature_flags(uuid, boolean, boolean) to authenticated;
grant execute on function public.request_club_join(uuid) to authenticated;
grant execute on function public.approve_club_member(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_club_member_role(uuid, uuid, public.user_role) to authenticated;
grant execute on function public.create_match(date, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_guest_profile(text, uuid, public.award_level, text) to authenticated;
grant execute on function public.add_unexcused_absence(date, uuid, uuid) to authenticated;
grant execute on function public.remove_unexcused_absence(date, uuid, uuid) to authenticated;
grant execute on function public.get_player_stats(date, date, uuid) to authenticated;
grant execute on function public.get_partner_stats(uuid, date, date, uuid) to authenticated;
grant execute on function public.get_opponent_stats(uuid, date, date, uuid) to authenticated;
grant execute on function public.get_player_monthly_trend(uuid, integer, uuid) to authenticated;
grant execute on function public.get_player_recent_matches(uuid, integer, uuid) to authenticated;
