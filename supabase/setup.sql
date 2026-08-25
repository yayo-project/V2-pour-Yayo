-- ═══════════════════════════════════════════════════════════
-- YAYO — one-time Supabase setup
-- HOW TO RUN (2 minutes):
--   1. Open https://supabase.com/dashboard → your project
--   2. Left menu → "SQL Editor" → "New query"
--   3. Paste this WHOLE file → click "Run"
-- Safe to run twice: every statement checks if it already exists.
-- ═══════════════════════════════════════════════════════════

-- 1) PHOTO STORAGE — bucket where dealers upload car photos
insert into storage.buckets (id, name, public)
values ('car-photos', 'car-photos', true)
on conflict (id) do nothing;

drop policy if exists "car-photos public read" on storage.objects;
create policy "car-photos public read"
  on storage.objects for select
  using (bucket_id = 'car-photos');

drop policy if exists "car-photos authenticated upload" on storage.objects;
create policy "car-photos authenticated upload"
  on storage.objects for insert
  with check (bucket_id = 'car-photos');

-- 2) REVIEWS — ratings for dealers AND agencies (real reviews only)
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('dealer','agency')),
  subject_id uuid not null,
  user_id uuid,
  author text,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- 3) AGENCY CHAT — let conversations point to an agency instead of a dealer
alter table public.conversations
  add column if not exists agency_id uuid references public.shipping_agencies(id);
alter table public.conversations
  alter column dealer_id drop not null;

-- 4) LOGOS + GALLERIES — profile images for dealers and agencies
alter table public.dealers
  add column if not exists logo_url text;
alter table public.dealers
  add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.shipping_agencies
  add column if not exists logo_url text;
alter table public.shipping_agencies
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- agency-photos bucket (safe to re-run even if it already exists)
insert into storage.buckets (id, name, public)
values ('agency-photos', 'agency-photos', true)
on conflict (id) do nothing;

drop policy if exists "agency-photos public read" on storage.objects;
create policy "agency-photos public read"
  on storage.objects for select
  using (bucket_id = 'agency-photos');

drop policy if exists "agency-photos authenticated upload" on storage.objects;
create policy "agency-photos authenticated upload"
  on storage.objects for insert
  with check (bucket_id = 'agency-photos');

-- 5) ADMIN ACCESS — makes your account the admin.
-- Log in on the site at least once with this email first, then run this.
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'yayoapp20@gmail.com';

-- ═══════════════════════════════════════════════════════════
-- 6) ADMIN TEAM & ROLES — who can administer Yayo, and how much
-- super_admin: everything · admin_dealers: dealers+agencies
-- admin_support: users+listings · admin_stats: statistics only
-- ═══════════════════════════════════════════════════════════
create table if not exists public.admin_users (
  email text primary key,
  role text not null default 'admin_stats'
    check (role in ('super_admin','admin_dealers','admin_support','admin_stats')),
  added_by text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- The role of the person calling (null = not an admin). Security definer so
-- RLS policies can use it without recursion.
create or replace function public.yayo_admin_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admin_users
  where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
$$;

drop policy if exists "admin_users read" on public.admin_users;
create policy "admin_users read" on public.admin_users
  for select using (public.yayo_admin_role() is not null);
drop policy if exists "admin_users write" on public.admin_users;
create policy "admin_users write" on public.admin_users
  for all using (public.yayo_admin_role() = 'super_admin')
  with check (public.yayo_admin_role() = 'super_admin');

-- Founder = super admin
insert into public.admin_users (email, role, added_by)
values ('yayoapp20@gmail.com', 'super_admin', 'setup')
on conflict (email) do update set role = 'super_admin';

-- Requires the caller to hold one of the listed roles (raises otherwise)
create or replace function public._yayo_require(roles text[])
returns text language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  r := public.yayo_admin_role();
  if r is null or not (r = any(roles)) then
    raise exception 'admin access denied';
  end if;
  return r;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 7) AUDIT LOG — every admin action is recorded (who, what, when)
-- ═══════════════════════════════════════════════════════════
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_email text not null,
  action text not null,
  subject_type text,
  subject_id text,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
drop policy if exists "audit read" on public.admin_audit_log;
create policy "audit read" on public.admin_audit_log
  for select using (public.yayo_admin_role() is not null);
-- no insert policy: rows are only written by the security-definer functions below

create or replace function public._yayo_log(a text, st text, sid text, d text)
returns void language sql security definer set search_path = public as $$
  insert into admin_audit_log (admin_email, action, subject_type, subject_id, detail)
  values (coalesce(auth.jwt()->>'email','?'), a, st, sid, d)
$$;

-- ═══════════════════════════════════════════════════════════
-- 8) NEW COLUMNS — statuses, license documents, view counter
-- ═══════════════════════════════════════════════════════════
alter table public.dealers add column if not exists suspended boolean not null default false;
alter table public.dealers add column if not exists rejected_reason text;
alter table public.dealers add column if not exists license_path text;
alter table public.shipping_agencies add column if not exists suspended boolean not null default false;
alter table public.shipping_agencies add column if not exists rejected_reason text;
alter table public.shipping_agencies add column if not exists license_path text;
alter table public.listings add column if not exists hidden boolean not null default false;
alter table public.listings add column if not exists views int not null default 0;
alter table public.users add column if not exists banned boolean not null default false;

-- ═══════════════════════════════════════════════════════════
-- 9) VIEW COUNTER + TOP DESTINATIONS (public, write-only counters)
-- ═══════════════════════════════════════════════════════════
create or replace function public.yayo_view(lid uuid)
returns void language sql security definer set search_path = public as $$
  update listings set views = coalesce(views,0) + 1 where id = lid
$$;

create table if not exists public.destination_stats (
  city text primary key,
  picks bigint not null default 0
);
alter table public.destination_stats enable row level security;
drop policy if exists "dest read" on public.destination_stats;
create policy "dest read" on public.destination_stats for select using (true);

create or replace function public.yayo_dest(c text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if lower(c) not in ('kinshasa','douala','abidjan','dakar','dubai') then return; end if;
  insert into destination_stats (city, picks) values (lower(c), 1)
  on conflict (city) do update set picks = destination_stats.picks + 1;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 10) LICENSES — private bucket for trade licenses.
-- Only the owner and admins can open a file (admins via signed URL).
-- ═══════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('licenses', 'licenses', false)
on conflict (id) do nothing;

drop policy if exists "licenses upload" on storage.objects;
create policy "licenses upload"
  on storage.objects for insert
  with check (bucket_id = 'licenses' and auth.role() = 'authenticated');

drop policy if exists "licenses read" on storage.objects;
create policy "licenses read"
  on storage.objects for select
  using (bucket_id = 'licenses' and (public.yayo_admin_role() is not null or owner = auth.uid()));

-- ═══════════════════════════════════════════════════════════
-- 11) ADMIN ACTIONS — all mutations go through these functions,
-- which check the caller's role and write the audit log.
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_set_verified(subject text, sid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set verified = val, rejected_reason = case when val then null else rejected_reason end where id = sid;
  else
    update shipping_agencies set verified = val, rejected_reason = case when val then null else rejected_reason end where id = sid;
  end if;
  perform _yayo_log(case when val then 'verify' else 'unverify' end, subject, sid::text, null);
end $$;

create or replace function public.admin_reject(subject text, sid uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set verified = false, rejected_reason = reason where id = sid;
  else
    update shipping_agencies set verified = false, rejected_reason = reason where id = sid;
  end if;
  perform _yayo_log('reject', subject, sid::text, reason);
end $$;

create or replace function public.admin_set_suspended(subject text, sid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set suspended = val where id = sid;
    update listings set hidden = val where dealer_id = sid;
  else
    update shipping_agencies set suspended = val where id = sid;
  end if;
  perform _yayo_log(case when val then 'suspend' else 'unsuspend' end, subject, sid::text, null);
end $$;

create or replace function public.admin_delete_business(subject text, sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    delete from messages where conversation_id in (select id from conversations where dealer_id = sid);
    delete from conversations where dealer_id = sid;
    begin delete from favorites where listing_id in (select id from listings where dealer_id = sid); exception when others then null; end;
    begin delete from leads where dealer_id = sid; exception when others then null; end;
    delete from reviews where subject_type = 'dealer' and subject_id = sid;
    delete from listings where dealer_id = sid;
    delete from dealers where id = sid;
  else
    delete from messages where conversation_id in (select id from conversations where agency_id = sid);
    delete from conversations where agency_id = sid;
    delete from reviews where subject_type = 'agency' and subject_id = sid;
    delete from shipping_agencies where id = sid;
  end if;
  perform _yayo_log('delete', subject, sid::text, null);
end $$;

create or replace function public.admin_set_listing_hidden(lid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_support']);
  update listings set hidden = val where id = lid;
  perform _yayo_log(case when val then 'hide_listing' else 'show_listing' end, 'listing', lid::text, null);
end $$;

create or replace function public.admin_delete_listing(lid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_support']);
  begin delete from favorites where listing_id = lid; exception when others then null; end;
  delete from listings where id = lid;
  perform _yayo_log('delete_listing', 'listing', lid::text, null);
end $$;

-- (superseded by §13b below — same function with phone support; dropping here
-- so re-running the file never hits "cannot change return type")
drop function if exists public.admin_list_users(text);

create or replace function public.admin_ban_user(uid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_support']);
  update auth.users set banned_until = case when val then 'infinity'::timestamptz else null end where id = uid;
  begin update users set banned = val where id = uid; exception when others then null; end;
  perform _yayo_log(case when val then 'ban_user' else 'unban_user' end, 'user', uid::text, null);
end $$;

create or replace function public.admin_delete_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_support']);
  begin delete from favorites where user_id = uid; exception when others then null; end;
  delete from messages where sender_id = uid
    or conversation_id in (select id from conversations where user_id = uid);
  delete from conversations where user_id = uid;
  begin delete from reviews where user_id = uid; exception when others then null; end;
  begin delete from users where id = uid; exception when others then null; end;
  delete from auth.users where id = uid;
  perform _yayo_log('delete_user', 'user', uid::text, null);
end $$;

-- ═══════════════════════════════════════════════════════════
-- 12) UNREAD MESSAGES — badge for buyers, dealers AND agencies
-- A message is unread until the OTHER side opens the conversation.
-- ═══════════════════════════════════════════════════════════
alter table public.messages add column if not exists seen boolean not null default false;

-- Unread count per conversation, for whoever is calling:
-- buyer (conversations.user_id) or business (dealers/agencies matched by email)
create or replace function public.yayo_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select m.conversation_id, count(*)::bigint
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.seen = false
    and m.sender_id is distinct from auth.uid()
    and (
      c.user_id = auth.uid()
      or c.dealer_id in (select d.id from dealers d
                         where lower(d.email) = lower(coalesce(auth.jwt()->>'email','')))
      or c.agency_id in (select a.id from shipping_agencies a
                         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))
    )
  group by m.conversation_id
$$;

-- Mark a conversation read for the caller (only if they are a participant)
create or replace function public.yayo_mark_read(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from conversations c where c.id = cid and (
      c.user_id = auth.uid()
      or c.dealer_id in (select d.id from dealers d
                         where lower(d.email) = lower(coalesce(auth.jwt()->>'email','')))
      or c.agency_id in (select a.id from shipping_agencies a
                         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))
    )
  ) then return; end if;
  update messages set seen = true
  where conversation_id = cid and sender_id is distinct from auth.uid();
end $$;

-- ═══════════════════════════════════════════════════════════
-- 13) PHONE ACCOUNTS — old WhatsApp/phone users + SMS login.
-- Phone-only accounts live in auth.users with email = null and
-- the number in the "phone" column. The admin list now shows them.
-- ═══════════════════════════════════════════════════════════
-- (function itself is created in §13b below, with smarter phone search)

-- ═══════════════════════════════════════════════════════════
-- 13b) PHONE SEARCH FIX — find phone accounts by typing digits
-- in any format (+243..., 0812..., "812 345 678" all match).
-- Also returns whether the account is phone-only.
-- ═══════════════════════════════════════════════════════════
-- (function itself is created in §13c below, which also merges the legacy
-- WhatsApp accounts from the old public.users table)
drop function if exists public.admin_list_users(text);

-- Diagnostic: how many phone-only accounts exist? (run alone to see the count)
-- select count(*) as phone_only_accounts from auth.users where phone is not null and coalesce(email,'') = '';

-- ═══════════════════════════════════════════════════════════
-- 13c) OLD WHATSAPP/PHONE USERS — they are NOT in Supabase Auth
-- (count above returned 0). The original Yayo stored WhatsApp
-- signups in the public.users table with the phone number in
-- "identifier". The admin list now merges those legacy accounts
-- in (shown with the 📱 tag, searchable by number).
-- ═══════════════════════════════════════════════════════════
drop function if exists public.admin_list_users(text);
create or replace function public.admin_list_users(q text default null)
returns table (id uuid, email text, phone text, created_at timestamptz, last_sign_in_at timestamptz, banned boolean)
language plpgsql stable security definer set search_path = public as $$
declare qd text;
begin
  perform _yayo_require(array['super_admin','admin_support']);
  qd := regexp_replace(coalesce(q, ''), '\D', '', 'g');  -- digits only

  -- 1) real login accounts (Supabase Auth)
  return query
    select u.id, u.email::text, u.phone::text, u.created_at, u.last_sign_in_at,
           (u.banned_until is not null and u.banned_until > now()) as banned
    from auth.users u
    where q is null or q = ''
       or u.email ilike '%' || q || '%'
       or (qd <> '' and regexp_replace(coalesce(u.phone::text, ''), '\D', '', 'g') like '%' || qd || '%')
    order by u.created_at desc
    limit 500;

  -- 2) legacy accounts from the old Yayo (public.users): WhatsApp/phone rows
  -- (identifier = the number → shown in the phone column with the 📱 tag) AND
  -- old email rows (identifier = the email). Only rows with no matching Auth
  -- account, so nothing appears twice. Wrapped in EXECUTE + exception so an
  -- unexpected old schema can never break the admin list.
  begin
    return query execute
      'select l.id, ' ||
      '       case when l.identifier like ''%@%'' then l.identifier end::text as email, ' ||
      '       case when l.identifier ~ ''^\+?[0-9][0-9 ()./-]{5,}$'' then l.identifier end::text as phone, ' ||
      '       l.created_at, null::timestamptz, coalesce(l.banned, false) ' ||
      'from public.users l ' ||
      'where l.identifier is not null ' ||
      '  and l.claimed_at is null ' ||     -- reconnected old accounts merged into an Auth login: never show twice
      '  and (l.identifier like ''%@%'' or l.identifier ~ ''^\+?[0-9][0-9 ()./-]{5,}$'') ' ||
      '  and not exists (select 1 from auth.users a where a.id = l.id ' ||
      '        or lower(coalesce(a.email,'''')) = lower(l.identifier) ' ||
      '        or (l.identifier not like ''%@%'' and regexp_replace(coalesce(a.phone::text,''''), ''\D'', '''', ''g'') = regexp_replace(l.identifier, ''\D'', '''', ''g''))) ' ||
      '  and ($1 = '''' or l.identifier ilike ''%'' || $1 || ''%'' ' ||
      '       or ($2 <> '''' and regexp_replace(l.identifier, ''\D'', '''', ''g'') like ''%'' || $2 || ''%'')) ' ||
      'order by l.created_at desc limit 500'
      using coalesce(q, ''), qd;
  exception when others then
    -- old table has a different shape — retry without created_at/banned
    begin
      return query execute
        'select l.id, ' ||
        '       case when l.identifier like ''%@%'' then l.identifier end::text, ' ||
        '       case when l.identifier ~ ''^\+?[0-9][0-9 ()./-]{5,}$'' then l.identifier end::text, ' ||
        '       null::timestamptz, null::timestamptz, false ' ||
        'from public.users l ' ||
        'where l.identifier is not null ' ||
        '  and l.identifier not like ''%(ancien compte)%'' ' ||
        '  and (l.identifier like ''%@%'' or l.identifier ~ ''^\+?[0-9][0-9 ()./-]{5,}$'') ' ||
        '  and ($1 = '''' or l.identifier ilike ''%'' || $1 || ''%'' ' ||
        '       or ($2 <> '''' and regexp_replace(l.identifier, ''\D'', '''', ''g'') like ''%'' || $2 || ''%'')) ' ||
        'limit 500'
        using coalesce(q, ''), qd;
    exception when others then null;
    end;
  end;
end $$;

-- Diagnostics for the old table (run each line alone to see the results):
-- select count(*) as old_yayo_users from public.users;
-- select login_type, count(*) from public.users group by login_type;

-- ═══════════════════════════════════════════════════════════
-- 14) PLATFORM STATISTICS — one call returns everything
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare o json;
begin
  perform _yayo_require(array['super_admin','admin_dealers','admin_support','admin_stats']);
  select json_build_object(
    'users_total',       (select count(*) from auth.users),
    'signups_today',     (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    'signups_7d',        (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'signups_30d',       (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'active_7d',         (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'active_30d',        (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
    'signups_by_day',    (select coalesce(json_agg(json_build_object('d', d, 'n', n) order by d), '[]'::json)
                          from (select date_trunc('day', created_at)::date d, count(*) n
                                from auth.users where created_at >= now() - interval '30 days' group by 1) t),
    'dealers',           (select count(*) from dealers),
    'dealers_verified',  (select count(*) from dealers where verified),
    'agencies',          (select count(*) from shipping_agencies),
    'agencies_verified', (select count(*) from shipping_agencies where verified),
    'listings_total',    (select count(*) from listings),
    'listings_active',   (select count(*) from listings where active and not sold and not hidden),
    'listings_new_7d',   (select count(*) from listings where created_at >= now() - interval '7 days'),
    'sold',              (select count(*) from listings where sold),
    'messages',          (select count(*) from messages),
    'conversations',     (select count(*) from conversations),
    'favorites',         (select count(*) from favorites),
    'reviews',           (select count(*) from reviews),
    'top_cars',          (select coalesce(json_agg(row_to_json(c)), '[]'::json)
                          from (select id, car_name, views from listings
                                where coalesce(views,0) > 0 order by views desc limit 5) c),
    'top_destinations',  (select coalesce(json_agg(row_to_json(dd)), '[]'::json)
                          from (select city, picks from destination_stats order by picks desc limit 5) dd)
  ) into o;
  return o;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 15) SECURITY — verification is ADMIN-ONLY, never automatic.
-- Logging in (Google/email/phone) only proves identity. Anyone
-- can APPLY to become a dealer/agency, but the "verified" and
-- "suspended" flags can only be changed by an admin. A trigger
-- enforces it at the database level, so even a hacked client
-- cannot self-verify. Existing rows (e.g. Mukoma) are untouched.
-- ═══════════════════════════════════════════════════════════
create or replace function public.yayo_guard_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.yayo_admin_role(), '') in ('super_admin','admin_dealers') then
    return new;  -- admins may change anything
  end if;
  if TG_OP = 'INSERT' then
    -- every new application starts pending, never pre-verified
    new.verified := false;
    new.suspended := false;
    new.rejected_reason := null;
  else
    -- non-admins can edit their profile but NOT their status
    new.verified := old.verified;
    new.suspended := old.suspended;
    new.rejected_reason := old.rejected_reason;
  end if;
  return new;
end $$;

drop trigger if exists yayo_guard_dealers on public.dealers;
create trigger yayo_guard_dealers
  before insert or update on public.dealers
  for each row execute function public.yayo_guard_verification();

drop trigger if exists yayo_guard_agencies on public.shipping_agencies;
create trigger yayo_guard_agencies
  before insert or update on public.shipping_agencies
  for each row execute function public.yayo_guard_verification();

-- Dealer application details ("Devenir dealer" form)
alter table public.dealers add column if not exists description text;

-- The admin RPCs (§11) bypass the trigger correctly because they are
-- called BY an admin — yayo_admin_role() sees the admin's login.

-- ═══════════════════════════════════════════════════════════
-- 16) REAL-TIME CHAT — messages appear instantly, no refresh.
-- Adds the messages table to the Realtime publication (RLS
-- still applies: each person only receives their own convos).
-- Safe to re-run: the exception handler ignores "already added".
-- ═══════════════════════════════════════════════════════════
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════
-- 17) LISTINGS — separate make/model (kills the "Ferrari shown
-- as Toyota" bug class) + photos array for the photo gallery
-- on the car page (photo_url stays = the cover photo).
-- ═══════════════════════════════════════════════════════════
alter table public.listings add column if not exists make text;
alter table public.listings add column if not exists model text;
alter table public.listings add column if not exists photos jsonb;

-- ═══════════════════════════════════════════════════════════
-- 18) "SIGNALER UN PROBLÈME" — reports from any visitor
-- (logged in or not) land in the admin dashboard with a
-- status workflow: nouveau → en cours → résolu.
-- ═══════════════════════════════════════════════════════════
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  url text,
  kind text,
  message text not null,
  contact text,
  user_id uuid,
  status text not null default 'nouveau',
  admin_note text
);
alter table public.reports enable row level security;
drop policy if exists reports_insert_any on public.reports;
create policy reports_insert_any on public.reports
  for insert to anon, authenticated with check (true);
drop policy if exists reports_admin_select on public.reports;
create policy reports_admin_select on public.reports
  for select to authenticated using (coalesce(public.yayo_admin_role(), '') <> '');
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports
  for update to authenticated using (coalesce(public.yayo_admin_role(), '') <> '');

-- ═══════════════════════════════════════════════════════════
-- 19) LEGACY ACCOUNT RECONNECTION — the 29 old-Yayo accounts
-- (WhatsApp/email in public.users.identifier) get their old
-- favorites/conversations re-attached the FIRST time they log
-- in with the same email (or phone, once SMS login is live).
-- Called automatically by the client after login; safe to call
-- many times (already-claimed rows are skipped).
-- ═══════════════════════════════════════════════════════════
alter table public.users add column if not exists claimed_at timestamptz;

create or replace function public.yayo_claim_legacy()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text; ph text; legacy_id uuid;
  moved_favs int := 0; moved_convos int := 0;
begin
  if uid is null then return jsonb_build_object('claimed', false); end if;
  select email, phone into em, ph from auth.users where id = uid;
  select u.id into legacy_id from public.users u
    where u.id <> uid and u.claimed_at is null
      and (
        (em is not null and em <> '' and lower(trim(u.identifier)) = lower(em))
        or (ph is not null and ph <> ''
            and regexp_replace(coalesce(u.identifier, ''), '\D', '', 'g') <> ''
            and regexp_replace(coalesce(u.identifier, ''), '\D', '', 'g')
              = regexp_replace(ph, '\D', '', 'g'))
      )
    limit 1;
  if legacy_id is null then return jsonb_build_object('claimed', false); end if;

  -- re-attach the old data to the fresh auth account (each step defensive:
  -- an unknown old schema must never abort the login flow)
  begin
    update public.favorites set user_id = uid where user_id = legacy_id;
    get diagnostics moved_favs = row_count;
  exception when others then null; end;
  begin
    update public.conversations set user_id = uid where user_id = legacy_id;
    get diagnostics moved_convos = row_count;
  exception when others then null; end;
  begin
    update public.users set claimed_at = now() where id = legacy_id;
  exception when others then null; end;

  return jsonb_build_object('claimed', true,
    'favorites', moved_favs, 'conversations', moved_convos);
end $$;
grant execute on function public.yayo_claim_legacy() to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 20) EMAIL NOTIFICATION "un acheteur vous a écrit" — throttle
-- column: one notification email per conversation per 30 min,
-- stamped by the Netlify function (service role).
-- ═══════════════════════════════════════════════════════════
alter table public.conversations add column if not exists last_notified_at timestamptz;

-- ═══════════════════════════════════════════════════════════
-- 21) PHOTOS IN CHAT — a message can carry a photo (dealer
-- sends extra pictures when the buyer asks). Stored in the
-- public car-photos bucket under chat/<conversation>/.
-- ═══════════════════════════════════════════════════════════
alter table public.messages add column if not exists image_url text;

-- ═══════════════════════════════════════════════════════════
-- 22) ENSURE USER ROW + LEGACY TAKEOVER (root fix)
-- messages/conversations point at public.users(id). Old-Yayo
-- accounts already occupy their email/phone identifier, so a
-- returning user could never get a row (unique conflict) and
-- every chat write failed silently. This RPC, called at login
-- and before chatting: creates the caller's row, and if a
-- legacy row holds the same email/phone, frees it and moves
-- its favorites/conversations to the new account.
-- ═══════════════════════════════════════════════════════════
create or replace function public.yayo_ensure_user()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text; ph text; legacy_id uuid;
begin
  if uid is null then return; end if;
  if exists (select 1 from users where id = uid) then return; end if;
  select email, phone into em, ph from auth.users where id = uid;

  -- ANY row holding this identifier blocks us — even one already marked
  -- claimed (the first-generation claim RPC set claimed_at without freeing
  -- the identifier, which left those users permanently unable to chat).
  select u.id into legacy_id from users u
    where u.id <> uid and (
      (em is not null and em <> '' and lower(trim(u.identifier)) = lower(em))
      or (ph is not null and ph <> ''
          and regexp_replace(coalesce(u.identifier, ''), '\D', '', 'g') <> ''
          and regexp_replace(coalesce(u.identifier, ''), '\D', '', 'g')
            = regexp_replace(ph, '\D', '', 'g'))
    ) limit 1;

  if legacy_id is not null then
    -- free the identifier, keep the old row traceable in admin
    update users set identifier = identifier || ' (ancien compte)',
      claimed_at = coalesce(claimed_at, now())
      where id = legacy_id;
  end if;

  begin
    insert into users (id, identifier, login_type, role)
      values (uid, coalesce(em, ph, uid::text), 'supabase', 'user');
  exception when unique_violation then null; end;

  if legacy_id is not null then
    begin update favorites set user_id = uid where user_id = legacy_id;
    exception when others then null; end;
    begin update conversations set user_id = uid where user_id = legacy_id;
    exception when others then null; end;
  end if;
end $$;
grant execute on function public.yayo_ensure_user() to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 23) INBOX MODEL (WhatsApp-style) — every conversation keeps
-- its last message + time, maintained by a trigger, so inboxes
-- show previews and sort by activity with ONE query. A future
-- voice note only adds a column; the model doesn't change.
-- ═══════════════════════════════════════════════════════════
alter table public.conversations add column if not exists last_message text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists last_sender uuid;

create or replace function public.yayo_touch_convo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set
    last_message = left(coalesce(new.content, ''), 120),
    last_message_at = new.created_at,
    last_sender = new.sender_id
  where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists yayo_touch_convo on public.messages;
create trigger yayo_touch_convo after insert on public.messages
  for each row execute function public.yayo_touch_convo();

-- backfill existing conversations once
update public.conversations c set
  last_message = left(coalesce(sub.content, ''), 120),
  last_message_at = sub.created_at,
  last_sender = sub.sender_id
from (
  select distinct on (conversation_id)
    conversation_id, content, created_at, sender_id
  from public.messages
  order by conversation_id, created_at desc
) sub
where sub.conversation_id = c.id and c.last_message_at is null;

-- ═══════════════════════════════════════════════════════════
-- 24) REVIEWS — only real contacts can review. A buyer may
-- review a dealer/agency ONLY if they have a conversation with
-- them (enforced in the database, not just hidden in the UI).
-- ═══════════════════════════════════════════════════════════
do $$ declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'reviews' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.reviews', p.policyname);
  end loop;
end $$;
create policy reviews_insert_contacted on public.reviews
  for insert to authenticated with check (
    user_id = auth.uid() and (
      (subject_type = 'dealer' and exists (
        select 1 from conversations c
        where c.user_id = auth.uid() and c.dealer_id::text = subject_id::text))
      or (subject_type = 'agency' and exists (
        select 1 from conversations c
        where c.user_id = auth.uid() and c.agency_id::text = subject_id::text))
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 25) PUSH NOTIFICATIONS (PWA) — a phone that installed Yayo
-- buzzes when a message arrives, even with the app closed.
-- One row per device the user enabled notifications on.
-- ═══════════════════════════════════════════════════════════
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_email_idx on public.push_subscriptions (lower(email));

alter table public.push_subscriptions enable row level security;
drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- 26) SHIPMENT TRACKING — the agency updates each step; the
-- buyer follows a live timeline (suivi.html). Statuses:
-- picked_up → container → departed → at_sea → arrived →
-- customs → ready. Every change is kept in shipment_events.
-- ═══════════════════════════════════════════════════════════
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  agency_id uuid not null,
  user_id uuid not null,
  car_name text,
  status text not null default 'picked_up'
    check (status in ('picked_up','container','departed','at_sea','arrived','customs','ready')),
  eta date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;

-- the agency (matched by its account email) manages its own shipments
drop policy if exists ship_agency_all on public.shipments;
create policy ship_agency_all on public.shipments
  for all to authenticated
  using (agency_id in (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email',''))))
  with check (agency_id in (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email',''))));
-- the buyer sees their own shipments
drop policy if exists ship_buyer_read on public.shipments;
create policy ship_buyer_read on public.shipments
  for select to authenticated using (user_id = auth.uid());

drop policy if exists shipev_agency_all on public.shipment_events;
create policy shipev_agency_all on public.shipment_events
  for all to authenticated
  using (shipment_id in (select s.id from shipments s where s.agency_id in
        (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))))
  with check (shipment_id in (select s.id from shipments s where s.agency_id in
        (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))));
drop policy if exists shipev_buyer_read on public.shipment_events;
create policy shipev_buyer_read on public.shipment_events
  for select to authenticated
  using (shipment_id in (select s.id from shipments s where s.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════
-- 27) REVIEWS v2 — VERIFIED BUYERS ONLY. A review is allowed
-- only after a real purchase through Yayo, not just a chat:
--   dealer  → the dealer marked one of his cars "Vendu" to
--             this buyer (listings.sold_to)
--   agency  → the agency created a shipment for this buyer
-- Replaces the §24 contact-based policy.
-- ═══════════════════════════════════════════════════════════
alter table public.listings add column if not exists sold_to uuid;

do $$ declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'reviews' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.reviews', p.policyname);
  end loop;
end $$;
create policy reviews_insert_buyers on public.reviews
  for insert to authenticated with check (
    user_id = auth.uid() and (
      (subject_type = 'dealer' and exists (
        select 1 from listings l
        where l.sold_to = auth.uid() and l.dealer_id::text = subject_id::text))
      or (subject_type = 'agency' and exists (
        select 1 from shipments s
        where s.user_id = auth.uid() and s.agency_id::text = subject_id::text))
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 28) ADMIN RENAME — fix a business display name (e.g. a
-- dealership typed in Arabic script that buyers can't read).
-- Same pattern as the other admin actions: role check + audit.
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_rename_business(subject text, sid uuid, newname text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if newname is null or length(trim(newname)) < 2 then
    raise exception 'name too short';
  end if;
  if subject = 'dealer' then
    update dealers set name = trim(newname) where id = sid;
  else
    update shipping_agencies set name = trim(newname) where id = sid;
  end if;
  perform _yayo_log('rename', subject, sid::text, trim(newname));
end $$;

-- ═══════════════════════════════════════════════════════════
-- 29) WEBSITE IMPORT + LISTING LIMITS — schema only (step 1).
-- Limits are DATA on the dealer row, never code:
--   effective limit = promo_limit while today < promo_until,
--   else normal_limit. -1 = unlimited (sentinel).
-- Import fields let a listing remember where it came from so
-- re-imports skip duplicates. dormant = hidden by a limit
-- downgrade (NOT deleted, NOT the dealer's active switch,
-- NOT the admin's hidden flag — those already exist).
-- ═══════════════════════════════════════════════════════════
alter table public.dealers add column if not exists plan text not null default 'starter';
alter table public.dealers add column if not exists normal_limit int not null default 10;
alter table public.dealers add column if not exists promo_limit int;
alter table public.dealers add column if not exists promo_until date;

alter table public.listings add column if not exists source_url text;
alter table public.listings add column if not exists import_method text;
alter table public.listings add column if not exists imported_at timestamptz;
alter table public.listings add column if not exists dormant boolean not null default false;

-- one car from one source site can exist only once per dealer —
-- duplicate protection at the database level, not just in code
create unique index if not exists listings_dealer_source_uniq
  on public.listings (dealer_id, source_url) where source_url is not null;

-- launch promo: every currently verified dealer (the "first dealers")
-- gets UNLIMITED for 3 months from today. New dealers get their own
-- 3 months at verification time (wired in step 2).
update public.dealers
  set promo_limit = -1, promo_until = current_date + interval '3 months'
  where verified = true and promo_until is null;
-- ═══════════════════════════════════════════════════════════
-- 30) LISTING LIMITS — the rule, admin control, auto-promo.
-- Effective limit = promo_limit while today < promo_until,
-- else normal_limit; -1 = unlimited. Enforced by a DB trigger
-- (like verification §15): a hacked client cannot exceed it.
-- Sold and dormant cars do not count toward the limit.
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_set_limits(sid uuid, p_plan text, p_normal int, p_promo int, p_until date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  update dealers set
    plan = coalesce(p_plan, plan),
    normal_limit = coalesce(p_normal, normal_limit),
    promo_limit = p_promo,
    promo_until = p_until
  where id = sid;
  perform _yayo_log('set_limits', 'dealer', sid::text,
    coalesce(p_plan,'-') || ' n=' || coalesce(p_normal::text,'-') ||
    ' promo=' || coalesce(p_promo::text,'-') || ' until=' || coalesce(p_until::text,'-'));
end $$;

-- verifying a dealer for the FIRST time starts their 3-month
-- unlimited launch promo automatically (only if no promo set yet)
create or replace function public.admin_set_verified(subject text, sid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set verified = val, rejected_reason = case when val then null else rejected_reason end where id = sid;
    if val then
      update dealers set promo_limit = -1, promo_until = current_date + interval '3 months'
        where id = sid and promo_until is null;
    end if;
  else
    update shipping_agencies set verified = val, rejected_reason = case when val then null else rejected_reason end where id = sid;
  end if;
  perform _yayo_log(case when val then 'verify' else 'unverify' end, subject, sid::text, null);
end $$;

-- the enforcement trigger: block INSERTs beyond the effective limit
create or replace function public.yayo_enforce_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record; lim int; cnt int;
begin
  if coalesce(public.yayo_admin_role(),'') in ('super_admin','admin_dealers') then
    return new;
  end if;
  select * into d from dealers where id = new.dealer_id;
  if d is null then return new; end if;
  if d.promo_until is not null and current_date < d.promo_until and d.promo_limit is not null then
    lim := d.promo_limit;
  else
    lim := coalesce(d.normal_limit, 10);
  end if;
  if lim < 0 then return new; end if;
  select count(*) into cnt from listings
    where dealer_id = new.dealer_id and coalesce(sold,false) = false and coalesce(dormant,false) = false;
  if cnt >= lim then
    raise exception 'YAYO_LIMIT_REACHED';
  end if;
  return new;
end $$;
drop trigger if exists yayo_listing_limit on public.listings;
create trigger yayo_listing_limit before insert on public.listings
  for each row execute function public.yayo_enforce_listing_limit();

-- ═══════════════════════════════════════════════════════════
-- 31) IMPORT OWNERSHIP — one website = one dealer, and one
-- dealer account = one website. Invisible for honest dealers.
-- Rules:
--   • a website can never be claimed by two dealers
--   • once a dealer has imported cars, their account is bound
--     to that website (a typo costs nothing: while they have
--     imported 0 cars they can freely change it)
--   • an imported listing must come from the dealer's own
--     claimed website — enforced by trigger, not by the client
--   • admin can free an account (rebrand / genuine 2nd site)
-- ═══════════════════════════════════════════════════════════
alter table public.dealers add column if not exists import_domain text;
alter table public.dealers add column if not exists import_claimed_at timestamptz;

create unique index if not exists dealers_import_domain_uniq
  on public.dealers (lower(import_domain)) where import_domain is not null;

-- claim a website for the CALLING dealer
-- → 'ok' | 'taken' (another account) | 'locked:<domain>' (this account is
--   already bound to a different site) | 'nodealer'
create or replace function public.yayo_claim_import_domain(dom text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid; mine text; owner_id uuid; clean text; imported int;
begin
  clean := lower(regexp_replace(coalesce(dom,''), '^www\.', ''));
  if clean = '' then return 'nodealer'; end if;

  select id, lower(regexp_replace(coalesce(import_domain,''), '^www\.', ''))
    into me, mine
    from dealers where lower(email) = lower(coalesce(auth.jwt()->>'email','')) limit 1;
  if me is null then return 'nodealer'; end if;

  -- same site again (re-import) is always fine
  if mine = clean then return 'ok'; end if;

  -- is this website already another dealer's?
  select id into owner_id from dealers
    where lower(regexp_replace(coalesce(import_domain,''), '^www\.', '')) = clean limit 1;
  if owner_id is not null and owner_id <> me then return 'taken'; end if;

  -- this account already bound to a different site AND has imported cars?
  if coalesce(mine,'') <> '' then
    select count(*) into imported from listings
      where dealer_id = me and source_url is not null;
    if imported > 0 then return 'locked:' || mine; end if;
  end if;

  update dealers set import_domain = clean, import_claimed_at = now() where id = me;
  return 'ok';
end $$;

-- an imported listing must come from THIS dealer's claimed website
create or replace function public.yayo_guard_import_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare dom text; claimed text;
begin
  if new.source_url is null or new.source_url = '' then return new; end if;
  dom := lower(regexp_replace(coalesce(substring(new.source_url from '^https?://([^/:]+)'),''), '^www\.', ''));
  select lower(regexp_replace(coalesce(import_domain,''), '^www\.', '')) into claimed
    from dealers where id = new.dealer_id;
  if coalesce(claimed,'') = '' or dom is distinct from claimed then
    raise exception 'YAYO_IMPORT_NOT_YOURS';
  end if;
  return new;
end $$;
drop trigger if exists yayo_import_source on public.listings;
create trigger yayo_import_source before insert on public.listings
  for each row execute function public.yayo_guard_import_source();

-- admin frees an account: the dealer can then link a different website,
-- and the old website becomes claimable again. Already-imported cars stay.
create or replace function public.admin_reset_import_domain(sid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old text;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  select import_domain into old from dealers where id = sid;
  update dealers set import_domain = null, import_claimed_at = null where id = sid;
  perform _yayo_log('reset_import_domain', 'dealer', sid::text, old);
end $$;
-- ═══════════════════════════════════════════════════════════
-- 32) GRACEFUL DOWNGRADE — when a promo ends, a dealer's extra
-- cars are put to sleep (dormant), NEVER deleted. They come
-- back automatically the moment the dealer makes room: sells a
-- car, hides one, or gets a bigger plan.
-- Oldest listings keep their place; the newest sleep first.
-- ═══════════════════════════════════════════════════════════
create or replace function public.yayo_reconcile_dealer(d_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare d record; lim int; live int; changed int := 0;
begin
  select * into d from dealers where id = d_id;
  if d is null then return 0; end if;

  if d.promo_until is not null and current_date < d.promo_until and d.promo_limit is not null
    then lim := d.promo_limit;
    else lim := coalesce(d.normal_limit, 10);
  end if;

  -- unlimited: wake everything up
  if lim < 0 then
    update listings set dormant = false
      where dealer_id = d_id and coalesce(dormant,false) = true;
    get diagnostics changed = row_count;
    return changed;
  end if;

  select count(*) into live from listings
    where dealer_id = d_id and coalesce(sold,false) = false and coalesce(dormant,false) = false;

  if live > lim then
    -- too many: the NEWEST extra cars go to sleep
    with extra as (
      select id from listings
        where dealer_id = d_id and coalesce(sold,false) = false and coalesce(dormant,false) = false
        order by created_at desc
        limit (live - lim)
    )
    update listings set dormant = true where id in (select id from extra);
    get diagnostics changed = row_count;
  elsif live < lim then
    -- room again: wake the oldest sleeping cars first
    with wake as (
      select id from listings
        where dealer_id = d_id and coalesce(sold,false) = false and coalesce(dormant,false) = true
        order by created_at asc
        limit (lim - live)
    )
    update listings set dormant = false where id in (select id from wake);
    get diagnostics changed = row_count;
  end if;
  return changed;
end $$;

-- the dealer's own dashboard can reconcile their account on load
create or replace function public.yayo_reconcile_me()
returns int language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  select id into me from dealers
    where lower(email) = lower(coalesce(auth.jwt()->>'email','')) limit 1;
  if me is null then return 0; end if;
  return public.yayo_reconcile_dealer(me);
end $$;

-- nightly sweep for every dealer (called by the scheduled function)
create or replace function public.yayo_reconcile_all()
returns int language plpgsql security definer set search_path = public as $$
declare r record; total int := 0;
begin
  for r in select id from dealers loop
    total := total + public.yayo_reconcile_dealer(r.id);
  end loop;
  return total;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 33) CAR REQUESTS — a buyer searches for a car that isn't on
-- Yayo yet. Instead of losing them, we record what they want
-- (make/model/budget/destination) so we can tell them when a
-- match appears, and so the founder sees a live map of demand.
-- Anyone (logged in or not) can create one; a buyer sees only
-- their own; admins see and triage them all.
-- Status: nouveau → contacte → satisfait.
-- ═══════════════════════════════════════════════════════════
create table if not exists public.car_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,               -- null when the buyer wasn't logged in
  make text,
  model text,
  budget_usd numeric,         -- buyer's max budget, in USD
  city text,                  -- destination city key (kinshasa/douala/abidjan/dakar)
  year_min int,
  note text,
  contact text,               -- email or phone so we can reach them
  source_q text,              -- the raw search that triggered the request
  status text not null default 'nouveau',
  admin_note text
);
alter table public.car_requests enable row level security;

-- create: anyone; a logged-in buyer can only stamp their OWN id
drop policy if exists car_requests_insert_any on public.car_requests;
create policy car_requests_insert_any on public.car_requests
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- read: the buyer sees their own …
drop policy if exists car_requests_owner_select on public.car_requests;
create policy car_requests_owner_select on public.car_requests
  for select to authenticated using (user_id = auth.uid());

-- … and any admin sees them all
drop policy if exists car_requests_admin_select on public.car_requests;
create policy car_requests_admin_select on public.car_requests
  for select to authenticated using (coalesce(public.yayo_admin_role(), '') <> '');

-- the buyer can cancel (delete) their own request
drop policy if exists car_requests_owner_delete on public.car_requests;
create policy car_requests_owner_delete on public.car_requests
  for delete to authenticated using (user_id = auth.uid());

-- admins triage the status (nouveau → contacte → satisfait)
drop policy if exists car_requests_admin_update on public.car_requests;
create policy car_requests_admin_update on public.car_requests
  for update to authenticated using (coalesce(public.yayo_admin_role(), '') <> '');

create index if not exists car_requests_city_idx on public.car_requests (city);
create index if not exists car_requests_user_idx on public.car_requests (user_id);

-- ═══════════════════════════════════════════════════════════
-- 34) CAR REQUEST MATCHES — when a dealer publishes a car that
-- matches an open request, the buyer gets ONE email ("a car
-- matching your search is available"). Two guards so a 400-car
-- import can never spam anyone:
--   • last_notified_at  → at most one email per request per day
--   • car_request_matches → the same car is never announced twice
-- lang remembers the buyer's language so the email is in THEIR
-- language, not French-only.
-- ═══════════════════════════════════════════════════════════
alter table public.car_requests add column if not exists lang text;
alter table public.car_requests add column if not exists last_notified_at timestamptz;

create table if not exists public.car_request_matches (
  request_id uuid not null,
  listing_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (request_id, listing_id)
);
alter table public.car_request_matches enable row level security;
-- the notifier runs with the service key (bypasses RLS); admins can look
drop policy if exists car_request_matches_admin_select on public.car_request_matches;
create policy car_request_matches_admin_select on public.car_request_matches
  for select to authenticated using (coalesce(public.yayo_admin_role(), '') <> '');
-- ═══════════════════════════════════════════════════════════
-- 35) ONE BUSINESS ACCOUNT PER EMAIL
-- A real dealership (IBITISAM MOTORS FZCO) ended up with FOUR
-- records: two because the signup form filed a new application
-- on every press, then two more because the dashboard's lookup
-- expected exactly one record, silently answered "none" when it
-- found two, and created another one on each visit — a loop that
-- would never have stopped, and that hid his cars behind an
-- empty duplicate.
-- This section repairs the damage, then makes it structurally
-- impossible: merge each email group onto ONE survivor (verified
-- first, then the one holding the cars, then the oldest), move
-- everything that pointed at a duplicate onto the survivor, keep
-- whatever the survivor was missing, delete the rest — and add a
-- unique index so no future code mistake can create a second one.
-- Safe to re-run: with no duplicates left it does nothing.
-- ═══════════════════════════════════════════════════════════
create or replace function public._yayo_merge_dupes()
returns text language plpgsql security definer set search_path = public as $$
declare
  g record; keep uuid; dupes uuid[]; n int := 0;
  v_logo text; v_lic text; v_dom text; v_claim timestamptz;
  v_wa text; v_desc text; v_city text; v_photos jsonb;
begin
  -- ── dealers ──
  for g in
    select lower(email) as em from dealers
    where coalesce(email, '') <> '' group by lower(email) having count(*) > 1
  loop
    select d.id into keep from dealers d
      where lower(d.email) = g.em
      order by d.verified desc nulls last,
               (select count(*) from listings l where l.dealer_id = d.id) desc,
               d.created_at asc nulls last
      limit 1;
    select array_agg(d.id) into dupes from dealers d where lower(d.email) = g.em and d.id <> keep;

    -- everything that pointed at a duplicate now points at the survivor
    update listings      set dealer_id = keep where dealer_id = any(dupes);
    update conversations set dealer_id = keep where dealer_id = any(dupes);
    begin update leads set dealer_id = keep where dealer_id = any(dupes); exception when others then null; end;
    begin update reviews set subject_id = keep where subject_type = 'dealer' and subject_id = any(dupes); exception when others then null; end;

    -- remember anything the survivor is missing (logo, licence, website…)
    select
      (select d.logo_url          from dealers d where d.id = any(dupes) and d.logo_url is not null           order by d.created_at desc limit 1),
      (select d.license_path      from dealers d where d.id = any(dupes) and d.license_path is not null       order by d.created_at desc limit 1),
      (select d.import_domain     from dealers d where d.id = any(dupes) and d.import_domain is not null      order by d.created_at desc limit 1),
      (select d.import_claimed_at from dealers d where d.id = any(dupes) and d.import_claimed_at is not null  order by d.created_at desc limit 1),
      (select d.whatsapp          from dealers d where d.id = any(dupes) and coalesce(d.whatsapp,'') <> ''    order by d.created_at desc limit 1),
      (select d.description       from dealers d where d.id = any(dupes) and coalesce(d.description,'') <> '' order by d.created_at desc limit 1),
      (select d.city              from dealers d where d.id = any(dupes) and coalesce(d.city,'') <> ''        order by d.created_at desc limit 1),
      (select d.photos            from dealers d where d.id = any(dupes) and coalesce(d.photos,'[]'::jsonb) <> '[]'::jsonb order by d.created_at desc limit 1)
      into v_logo, v_lic, v_dom, v_claim, v_wa, v_desc, v_city, v_photos;

    -- delete FIRST: the website link is unique, so the survivor can only
    -- inherit it once the duplicate holding it is gone
    delete from dealers where id = any(dupes);
    n := n + coalesce(array_length(dupes, 1), 0);

    update dealers set
      logo_url          = coalesce(logo_url, v_logo),
      license_path      = coalesce(license_path, v_lic),
      import_domain     = coalesce(import_domain, v_dom),
      import_claimed_at = coalesce(import_claimed_at, v_claim),
      whatsapp          = coalesce(nullif(whatsapp, ''), v_wa),
      description       = coalesce(nullif(description, ''), v_desc),
      city              = coalesce(nullif(city, ''), v_city),
      -- photos defaults to '[]', so it is never null: test for EMPTY
      photos            = case when coalesce(photos, '[]'::jsonb) = '[]'::jsonb
                               then coalesce(v_photos, photos) else photos end
    where id = keep;
  end loop;

  -- ── shipping agencies (same story, same cure) ──
  for g in
    select lower(email) as em from shipping_agencies
    where coalesce(email, '') <> '' group by lower(email) having count(*) > 1
  loop
    select a.id into keep from shipping_agencies a
      where lower(a.email) = g.em
      order by a.verified desc nulls last, a.created_at asc nulls last
      limit 1;
    select array_agg(a.id) into dupes from shipping_agencies a where lower(a.email) = g.em and a.id <> keep;

    update conversations set agency_id = keep where agency_id = any(dupes);
    begin update shipments set agency_id = keep where agency_id = any(dupes); exception when others then null; end;
    begin update reviews set subject_id = keep where subject_type = 'agency' and subject_id = any(dupes); exception when others then null; end;

    select
      (select a.logo_url     from shipping_agencies a where a.id = any(dupes) and a.logo_url is not null       order by a.created_at desc limit 1),
      (select a.license_path from shipping_agencies a where a.id = any(dupes) and a.license_path is not null   order by a.created_at desc limit 1),
      (select a.whatsapp     from shipping_agencies a where a.id = any(dupes) and coalesce(a.whatsapp,'') <> '' order by a.created_at desc limit 1),
      (select a.photos       from shipping_agencies a where a.id = any(dupes) and coalesce(a.photos,'[]'::jsonb) <> '[]'::jsonb order by a.created_at desc limit 1)
      into v_logo, v_lic, v_wa, v_photos;

    delete from shipping_agencies where id = any(dupes);
    n := n + coalesce(array_length(dupes, 1), 0);

    update shipping_agencies set
      logo_url     = coalesce(logo_url, v_logo),
      license_path = coalesce(license_path, v_lic),
      whatsapp     = coalesce(nullif(whatsapp, ''), v_wa),
      photos       = case when coalesce(photos, '[]'::jsonb) = '[]'::jsonb
                          then coalesce(v_photos, photos) else photos end
    where id = keep;
  end loop;

  return n || ' duplicate(s) merged';
end $$;

select public._yayo_merge_dupes();

-- the structural guarantee: a second record with the same email
-- can no longer be created, by any client, ever
create unique index if not exists dealers_email_uniq
  on public.dealers (lower(email)) where coalesce(email, '') <> '';
create unique index if not exists agencies_email_uniq
  on public.shipping_agencies (lower(email)) where coalesce(email, '') <> '';

-- ═══════════════════════════════════════════════════════════
-- 36) ADMIN CREATES A SELLER ACCOUNT
-- A dealer met in person (Al Aweer, a showroom visit) rarely
-- fills a form. The founder opens the account for him, hands him
-- the login, and his stock is online the same day. The auth login
-- itself is created by the create-login function (service key);
-- this RPC creates the seller record, marks it verified — a
-- handshake IS the verification here — starts the 3-month
-- unlimited promo, claims his website so the import works, and
-- writes the whole thing to the audit log like every other admin
-- action. Idempotent: run twice on the same email and it updates
-- instead of duplicating (see §35).
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_create_dealer(
  p_name text, p_email text, p_phone text, p_city text, p_site text)
returns uuid language plpgsql security definer set search_path = public as $$
declare newid uuid; dom text;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if coalesce(p_name, '') = '' or coalesce(p_email, '') = '' then
    raise exception 'name and email are required';
  end if;

  -- "https://www.mohamedhakim.com/cars" → "mohamedhakim.com"
  dom := lower(trim(coalesce(p_site, '')));
  dom := regexp_replace(dom, '^https?://', '');
  dom := regexp_replace(dom, '^www\.', '');
  dom := split_part(split_part(split_part(dom, '/', 1), '?', 1), ':', 1);
  if dom = '' then dom := null; end if;

  select id into newid from dealers where lower(email) = lower(p_email) limit 1;
  if newid is null then
    insert into dealers (name, email, whatsapp, city, verified, plan, promo_limit, promo_until)
    values (p_name, lower(p_email), nullif(p_phone, ''), coalesce(nullif(p_city, ''), 'Dubai'),
            true, 'starter', -1, (current_date + interval '3 months')::date)
    returning id into newid;
  else
    update dealers set
      name = p_name,
      whatsapp = coalesce(nullif(p_phone, ''), whatsapp),
      city = coalesce(nullif(p_city, ''), city),
      verified = true, suspended = false, rejected_reason = null,
      promo_limit = coalesce(promo_limit, -1),
      promo_until = coalesce(promo_until, (current_date + interval '3 months')::date)
    where id = newid;
  end if;

  -- claim his website unless another account already owns it (§31)
  if dom is not null and not exists (
    select 1 from dealers where lower(import_domain) = dom and id <> newid
  ) then
    update dealers set import_domain = dom, import_claimed_at = coalesce(import_claimed_at, now())
    where id = newid;
  end if;

  perform _yayo_log('create_dealer', 'dealer', newid::text,
    p_name || ' · ' || lower(p_email) || coalesce(' · ' || dom, ''));
  return newid;
end $$;

grant execute on function public.admin_create_dealer(text, text, text, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════
-- 37) ADMIN WORKS ON BEHALF OF A BUSINESS
-- Two things the founder needs after opening an account for a
-- dealer he met in person:
--   • put that dealer's stock online FOR him (he will not do it
--     himself the first day) — admin_import_listing
--   • open an account for a shipping AGENCY the same way —
--     admin_create_agency
-- Both are audited like every other admin action.
-- ═══════════════════════════════════════════════════════════

-- Publish one imported car into someone else's inventory.
-- The listing tables are protected by row-level rules that (rightly)
-- only let a business touch its OWN cars, so an admin cannot simply
-- insert one from the browser. This runs with the database's own
-- authority after checking the caller is an admin — and it still
-- goes through the ownership trigger (§31) and the listing-limit
-- trigger (§30), so nothing is bypassed except the "it must be your
-- own account" rule.
create or replace function public.admin_import_listing(p_dealer uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare newid uuid; dom text; cur text;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if p_dealer is null then raise exception 'dealer required'; end if;

  -- an imported car must come from the website this dealer owns; if he has
  -- no website claimed yet, claim it now (unless another account owns it)
  if coalesce(p->>'source_url', '') <> '' then
    dom := lower(regexp_replace(regexp_replace(p->>'source_url', '^https?://', ''), '^www\.', ''));
    dom := split_part(split_part(split_part(dom, '/', 1), '?', 1), ':', 1);
    select import_domain into cur from dealers where id = p_dealer;
    if coalesce(cur, '') = '' and dom <> '' and not exists (
      select 1 from dealers where lower(import_domain) = dom and id <> p_dealer
    ) then
      update dealers set import_domain = dom, import_claimed_at = now() where id = p_dealer;
    end if;
  end if;

  insert into listings (
    dealer_id, car_name, make, model, price, year, mileage, condition, color,
    photo_url, photos, description, city, export_africa, active, sold,
    source_url, import_method, imported_at
  ) values (
    p_dealer,
    p->>'car_name', p->>'make', p->>'model',
    nullif(p->>'price', '')::numeric,
    nullif(p->>'year', '')::int,
    nullif(p->>'mileage', '')::int,
    coalesce(p->>'condition', 'Très bon état'),
    p->>'color',
    p->>'photo_url',
    coalesce(p->'photos', '[]'::jsonb),
    p->>'description',
    coalesce(nullif(p->>'city', ''), 'Dubai'),
    true, true, false,
    nullif(p->>'source_url', ''),
    coalesce(nullif(p->>'import_method', ''), 'import'),
    now()
  ) returning id into newid;

  return newid;
end $$;

grant execute on function public.admin_import_listing(uuid, jsonb) to authenticated;

-- Open an account for a shipping agency met in person — the mirror of
-- admin_create_dealer (§36). Same handshake-is-verification logic.
create or replace function public.admin_create_agency(
  p_name text, p_email text, p_phone text, p_country text, p_desc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare newid uuid;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if coalesce(p_name, '') = '' or coalesce(p_email, '') = '' then
    raise exception 'name and email are required';
  end if;

  select id into newid from shipping_agencies where lower(email) = lower(p_email) limit 1;
  if newid is null then
    insert into shipping_agencies (name, email, whatsapp, country, routes, verified)
    values (p_name, lower(p_email), nullif(p_phone, ''),
            coalesce(nullif(p_country, ''), 'Dubai UAE'),
            jsonb_build_object('v', 2, 'description', p_desc, 'offices', '{}'::jsonb, 'routes', '[]'::jsonb)::text,
            true)
    returning id into newid;
  else
    update shipping_agencies set
      name = p_name,
      whatsapp = coalesce(nullif(p_phone, ''), whatsapp),
      country = coalesce(nullif(p_country, ''), country),
      verified = true, suspended = false, rejected_reason = null
    where id = newid;
  end if;

  perform _yayo_log('create_agency', 'agency', newid::text, p_name || ' · ' || lower(p_email));
  return newid;
end $$;

grant execute on function public.admin_create_agency(text, text, text, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════
-- 38) TRADING IS NOT THE SAME AS BEING VERIFIED
-- One flag was doing two jobs: it made a business visible to
-- buyers AND it granted the blue badge. So a dealership the
-- founder opened an account for in person got a badge nobody
-- had earned — no trade licence had ever been checked.
-- Split in two:
--   approved → his cars are visible, buyers can write to him
--   verified → the licence was checked: THE BADGE
-- A business met in person is approved on the spot; the badge
-- still has to be earned. Existing businesses keep exactly what
-- they have today (approved is backfilled from verified), so
-- nothing disappears from the site when this runs.
-- ═══════════════════════════════════════════════════════════
alter table public.dealers            add column if not exists approved boolean not null default false;
alter table public.shipping_agencies  add column if not exists approved boolean not null default false;

-- whoever is live today stays live
update public.dealers           set approved = true where verified and not approved;
update public.shipping_agencies set approved = true where verified and not approved;

-- The status guard (§15) now covers the new flag too: a business can no more
-- approve itself than it could verify itself.
create or replace function public.yayo_guard_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.yayo_admin_role(), '') in ('super_admin','admin_dealers') then
    return new;  -- admins may change anything
  end if;
  if TG_OP = 'INSERT' then
    -- every new application starts pending, never pre-approved
    new.verified := false;
    new.suspended := false;
    new.approved := false;
    new.rejected_reason := null;
  else
    -- non-admins can edit their profile but NOT their status
    new.verified := old.verified;
    new.suspended := old.suspended;
    new.approved := old.approved;
    new.rejected_reason := old.rejected_reason;
  end if;
  return new;
end $$;

-- Let a business trade (or stop it) without touching the badge
create or replace function public.admin_set_approved(subject text, sid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set approved = val,
      rejected_reason = case when val then null else rejected_reason end,
      -- withdrawing permission to trade withdraws the badge with it
      verified = case when val then verified else false end
    where id = sid;
    if val then
      update dealers set promo_limit = -1, promo_until = (current_date + interval '3 months')::date
        where id = sid and promo_until is null;
    end if;
  else
    update shipping_agencies set approved = val,
      rejected_reason = case when val then null else rejected_reason end,
      verified = case when val then verified else false end
    where id = sid;
  end if;
  perform _yayo_log(case when val then 'approve' else 'unapprove' end, subject, sid::text, null);
end $$;

grant execute on function public.admin_set_approved(text, uuid, boolean) to authenticated;

-- Granting the badge implies the business may trade (a badge on someone
-- invisible would mean nothing); removing the badge leaves him trading.
create or replace function public.admin_set_verified(subject text, sid uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set verified = val,
      approved = case when val then true else approved end,
      rejected_reason = case when val then null else rejected_reason end
    where id = sid;
    if val then
      update dealers set promo_limit = -1, promo_until = (current_date + interval '3 months')::date
        where id = sid and promo_until is null;
    end if;
  else
    update shipping_agencies set verified = val,
      approved = case when val then true else approved end,
      rejected_reason = case when val then null else rejected_reason end
    where id = sid;
  end if;
  perform _yayo_log(case when val then 'verify' else 'unverify' end, subject, sid::text, null);
end $$;

-- Rejecting takes away the right to trade as well as the badge
create or replace function public.admin_reject(subject text, sid uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if subject = 'dealer' then
    update dealers set verified = false, approved = false, rejected_reason = reason where id = sid;
  else
    update shipping_agencies set verified = false, approved = false, rejected_reason = reason where id = sid;
  end if;
  perform _yayo_log('reject', subject, sid::text, reason);
end $$;

-- An account opened by an admin for someone met in person: allowed to trade
-- immediately (that is the whole point), but NOT badged — the licence still
-- has to arrive. Replaces the §36 / §37 versions.
create or replace function public.admin_create_dealer(
  p_name text, p_email text, p_phone text, p_city text, p_site text)
returns uuid language plpgsql security definer set search_path = public as $$
declare newid uuid; dom text;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if coalesce(p_name, '') = '' or coalesce(p_email, '') = '' then
    raise exception 'name and email are required';
  end if;

  dom := lower(trim(coalesce(p_site, '')));
  dom := regexp_replace(dom, '^https?://', '');
  dom := regexp_replace(dom, '^www\.', '');
  dom := split_part(split_part(split_part(dom, '/', 1), '?', 1), ':', 1);
  if dom = '' then dom := null; end if;

  select id into newid from dealers where lower(email) = lower(p_email) limit 1;
  if newid is null then
    insert into dealers (name, email, whatsapp, city, approved, verified, plan, promo_limit, promo_until)
    values (p_name, lower(p_email), nullif(p_phone, ''), coalesce(nullif(p_city, ''), 'Dubai'),
            true, false, 'starter', -1, (current_date + interval '3 months')::date)
    returning id into newid;
  else
    update dealers set
      name = p_name,
      whatsapp = coalesce(nullif(p_phone, ''), whatsapp),
      city = coalesce(nullif(p_city, ''), city),
      approved = true, suspended = false, rejected_reason = null,
      promo_limit = coalesce(promo_limit, -1),
      promo_until = coalesce(promo_until, (current_date + interval '3 months')::date)
    where id = newid;
  end if;

  if dom is not null and not exists (
    select 1 from dealers where lower(import_domain) = dom and id <> newid
  ) then
    update dealers set import_domain = dom, import_claimed_at = coalesce(import_claimed_at, now())
    where id = newid;
  end if;

  perform _yayo_log('create_dealer', 'dealer', newid::text,
    p_name || ' · ' || lower(p_email) || coalesce(' · ' || dom, ''));
  return newid;
end $$;

create or replace function public.admin_create_agency(
  p_name text, p_email text, p_phone text, p_country text, p_desc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare newid uuid;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if coalesce(p_name, '') = '' or coalesce(p_email, '') = '' then
    raise exception 'name and email are required';
  end if;

  select id into newid from shipping_agencies where lower(email) = lower(p_email) limit 1;
  if newid is null then
    insert into shipping_agencies (name, email, whatsapp, country, routes, approved, verified)
    values (p_name, lower(p_email), nullif(p_phone, ''),
            coalesce(nullif(p_country, ''), 'Dubai UAE'),
            jsonb_build_object('v', 2, 'description', p_desc, 'offices', '{}'::jsonb, 'routes', '[]'::jsonb)::text,
            true, false)
    returning id into newid;
  else
    update shipping_agencies set
      name = p_name,
      whatsapp = coalesce(nullif(p_phone, ''), whatsapp),
      country = coalesce(nullif(p_country, ''), country),
      approved = true, suspended = false, rejected_reason = null
    where id = newid;
  end if;

  perform _yayo_log('create_agency', 'agency', newid::text, p_name || ' · ' || lower(p_email));
  return newid;
end $$;


-- ═══════════════════════════════════════════════════════════
-- 39) A PRICE IS A NUMBER
-- listings.price was stored as text, so every list ordered by
-- price ordered it alphabetically: "9530" came after "108918".
-- That is why hiding "everything above $100 000" from the admin
-- table missed the worst rows — the table was showing an order
-- that was not the order of the money.
-- Converts the column, keeping every existing value.
-- ═══════════════════════════════════════════════════════════
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'listings'
      and column_name = 'price' and data_type in ('text','character varying')
  ) then
    alter table public.listings
      alter column price type numeric
      using nullif(regexp_replace(coalesce(price, ''), '[^0-9.]', '', 'g'), '')::numeric;
  end if;
end $$;

create index if not exists listings_price_idx on public.listings (price);

-- Correct one imported price (the reader used to read a filter's maximum
-- instead of the car's own price). Audited like every admin action; also
-- brings the car back if it was hidden while its price was wrong.
create or replace function public.admin_set_listing_price(lid uuid, val numeric, unhide boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare old_price numeric;
begin
  perform _yayo_require(array['super_admin','admin_dealers','admin_support']);
  if val is null or val <= 0 then raise exception 'price must be positive'; end if;
  select price into old_price from listings where id = lid;
  update listings set price = val, hidden = case when unhide then false else hidden end where id = lid;
  perform _yayo_log('set_price', 'listing', lid::text,
    coalesce(old_price::text, '-') || ' → ' || val::text);
end $$;

grant execute on function public.admin_set_listing_price(uuid, numeric, boolean) to authenticated;


-- ═══════════════════════════════════════════════════════════
-- 40) THE ADMIN CAN FIX A BUSINESS'S PROFILE PICTURE
-- A dealer signed up in person will not upload a logo on his
-- first evening, and a nameless grey circle next to his cars is
-- the weakest thing on the marketplace. The founder can now set
-- it for him from the admin panel. Audited like every other
-- admin action; the business can still change it himself.
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_set_logo(subject text, sid uuid, url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  -- only a Yayo storage URL: this can never be pointed at another site
  if url is not null and url not like 'https://wkjxdkeqffsjarjxlsyh.supabase.co/storage/v1/object/public/%' then
    raise exception 'logo must be an uploaded Yayo image';
  end if;
  if subject = 'dealer' then
    update dealers set logo_url = url where id = sid;
  else
    update shipping_agencies set logo_url = url where id = sid;
  end if;
  perform _yayo_log('set_logo', subject, sid::text, coalesce(url, 'removed'));
end $$;

grant execute on function public.admin_set_logo(text, uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════
-- 41) THE ADMIN CAN ADD A BUSINESS'S SHOWROOM PHOTOS
-- The mirror of §40 for the gallery: a buyer 5 000 km away
-- judges a seller on the photos of his showroom (or an agency
-- on its warehouse and trucks). A dealer signed up in person
-- will not upload them himself, so the founder can do it for
-- him. Same guard: only images already uploaded to Yayo.
-- ═══════════════════════════════════════════════════════════
create or replace function public.admin_set_photos(subject text, sid uuid, urls jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u text; n int := 0;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if urls is null or jsonb_typeof(urls) <> 'array' then
    raise exception 'urls must be a json array';
  end if;
  for u in select jsonb_array_elements_text(urls) loop
    n := n + 1;
    if u not like 'https://wkjxdkeqffsjarjxlsyh.supabase.co/storage/v1/object/public/%' then
      raise exception 'photos must be uploaded Yayo images';
    end if;
  end loop;
  if n > 12 then raise exception 'too many photos'; end if;

  if subject = 'dealer' then
    update dealers set photos = urls where id = sid;
  else
    update shipping_agencies set photos = urls where id = sid;
  end if;
  perform _yayo_log('set_photos', subject, sid::text, n || ' photo(s)');
end $$;

grant execute on function public.admin_set_photos(text, uuid, jsonb) to authenticated;


-- ═══════════════════════════════════════════════════════════
-- 42) THE WELCOME EMAIL
-- A seller who registers gets a confirmation link and then
-- silence — at the exact moment he is most willing to act. He
-- now gets one email telling him how to put his stock online.
-- The stamp below is what makes it safe to send to the sellers
-- already registered: nobody can be welcomed twice, whatever
-- happens, because the server writes the date BEFORE sending.
-- ═══════════════════════════════════════════════════════════
alter table public.dealers           add column if not exists welcomed_at timestamptz;
alter table public.shipping_agencies add column if not exists welcomed_at timestamptz;


-- ═══════════════════════════════════════════════════════════
-- 43) ASKING FOR THE TRADE LICENCE
-- The badge is the whole trust machine, and it cannot be given
-- until someone has read the licence. This records WHEN we last
-- asked, so a reminder can be sent to everyone who still owes
-- one without asking the same business twice in a week.
-- ═══════════════════════════════════════════════════════════
alter table public.dealers           add column if not exists licence_asked_at timestamptz;
alter table public.shipping_agencies add column if not exists licence_asked_at timestamptz;



-- ═══════════════════════════════════════════════════════════
-- 44) CLEANING UP WHAT THE IMPORTER WROTE
-- The website importer filled make / model / year from scraped
-- page titles, and it got a lot of them wrong: 41 cars have the
-- YEAR sitting in the make column ("2023 Toyota" became
-- make=2023, model=Toyota), 361 have no year at all, and some
-- makes arrived shouting ("MITSUBISHI FUSO") so the same brand
-- splits into two in every filter.
--
-- This matters far beyond tidiness. The make is the brand in
-- the car's web address, its page title, and any brand landing
-- page. A page called "2023 Toyota" ranks for nothing and looks
-- fake to a buyer.
--
-- RUN THE SELECT FIRST and look at what it will change. The
-- updates below only touch rows that are demonstrably wrong,
-- and never overwrite a value that is already sensible.
-- ═══════════════════════════════════════════════════════════

-- PREVIEW — read this before running anything else
-- select id, make, model, year, car_name from public.listings
--   where make ~ '^[0-9]{4}$' or year is null or make = upper(make)
--   order by make limit 100;

-- 44a) The year landed in the make column. Move everything back
--      one place: the model becomes the make, and the year we
--      found becomes the year (unless one is already recorded).
update public.listings
   set year  = coalesce(year, nullif(make, '')::int),
       make  = nullif(model, ''),
       model = null
 where make ~ '^[0-9]{4}$'
   and nullif(make,'')::int between 1980 and 2030;

-- 44b) Recover a missing year from the advert title ("2024 Toyota
--      Camry"). Only a plausible car year is accepted.
update public.listings
   set year = (substring(car_name from '(19[8-9][0-9]|20[0-3][0-9])'))::int
 where year is null
   and car_name ~ '(19[8-9][0-9]|20[0-3][0-9])';

-- 44c) One spelling per brand. "MITSUBISHI FUSO" and "Mitsubishi
--      Fuso" are the same company and must group as one.
update public.listings
   set make = initcap(lower(make))
 where make is not null
   and make = upper(make)
   and make !~ '^[0-9]+$'
   and length(make) > 3;   -- leaves BMW, MG, KIA, GMC alone

-- 44d) A handful of rows have no real name at all (car_name and
--      make are both "New"). They cannot be described honestly,
--      so hide them from buyers rather than publish a car called
--      "New". Un-hide any that a dealer later fills in properly.
update public.listings
   set hidden = true
 where (coalesce(nullif(trim(car_name),''), '') = ''
        or lower(trim(car_name)) in ('new','used','other'))
   and coalesce(nullif(trim(model),''), '') = '';

-- 44e) Rebuild the display name from the clean columns wherever
--      it disagrees with them, so the card, the page title and
--      the web address all say the same thing.
update public.listings
   set car_name = trim(both ' ' from concat_ws(' ', make, model))
 where make is not null
   and nullif(trim(model),'') is not null
   and car_name is distinct from trim(both ' ' from concat_ws(' ', make, model));


-- ═══════════════════════════════════════════════════════════
-- 45) THE TWENTY CARS §44 COULD NOT NAME
-- After §44, twenty listings were left with no usable brand:
-- sixteen called just "2023" or "2024", and four whose brand
-- was a model number ("400 Z", "407"). §44 could not fix them
-- because the advert title on the dealer's site was only a year.
--
-- But the ADDRESS the car was imported from still holds the
-- truth: .../listings/new-2023-suzuki-baleno-3/. This reads the
-- make and model back out of that address, so the cars keep
-- their photos and their price and simply get their name back.
--
-- Only rows that are currently broken are touched: a real
-- Suzuki that already says Suzuki is never rewritten.
-- ═══════════════════════════════════════════════════════════

update public.listings l
   set make  = v.mk,
       model = coalesce(nullif(trim(l.model), ''), v.md)
  from (values
    ('suzuki-baleno',        'Suzuki',  'Baleno'),
    ('suzuki-grand-vitara',  'Suzuki',  'Grand Vitara'),
    ('suzuki-apv',           'Suzuki',  'APV'),
    ('nissan-400z',          'Nissan',  '400Z'),
    ('nissan-patrol',        'Nissan',  'Patrol'),
    ('peugeot-407',          'Peugeot', '407'),
    ('peugeot-308',          'Peugeot', '308'),
    ('peugeot-2008',         'Peugeot', '2008'),
    ('jeep-grand-cherokee',  'Jeep',    'Grand Cherokee')
  ) as v(pat, mk, md)
 where l.source_url ilike '%' || v.pat || '%'
   and (l.make is null or trim(l.make) = '' or l.make ~ '^[0-9]+$');

-- Put the corrected name back on the card and in the web address.
update public.listings
   set car_name = trim(both ' ' from concat_ws(' ', make, model))
 where make is not null
   and nullif(trim(model), '') is not null
   and (car_name ~ '^[0-9]{4}( |$)' or car_name ~ '^[0-9]+ ' or trim(car_name) = '');

-- One car remains genuinely nameless: its address is only
-- "/listings/new-2023/" and the page never said what it was.
-- Hide it rather than show a buyer a car called "2023".
update public.listings
   set hidden = true
 where (make is null or trim(make) = '')
   and coalesce(nullif(trim(model), ''), '') = ''
   and car_name ~ '^[0-9]{4}$';


-- ═══════════════════════════════════════════════════════════
-- 46) A CAR WITH NO PRICE IS A DRAFT
-- Some Dubai dealers never publish prices — Target Motors is
-- one: his whole site says "price on request". Refusing to
-- import him until he has prices means never importing him.
--
-- So a price-less car can now be imported. It arrives switched
-- OFF: buyers only ever see active = true, so it is invisible
-- from the first second. It sits in his dashboard until he
-- types a price, and typing the price is what publishes it.
--
-- Two rules the database enforces, so nothing can slip out by
-- accident or by clicking the wrong toggle:
--   a) a car cannot be active while it has no real price
--   b) a price-less draft does not eat the dealer's listing
--      allowance — he only spends it on cars buyers can see
-- ═══════════════════════════════════════════════════════════

-- 46a) The car may not go public without a price.
create or replace function public.yayo_price_before_public()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.active, false) = true
     and (new.price is null or new.price <= 0) then
    new.active := false;
  end if;
  return new;
end $$;

drop trigger if exists yayo_price_gate on public.listings;
create trigger yayo_price_gate before insert or update on public.listings
  for each row execute function public.yayo_price_before_public();

-- 46b) Drafts do not count against the limit. Only cars a buyer
--      could actually find do.
create or replace function public.yayo_enforce_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record; lim int; cnt int;
begin
  if coalesce(public.yayo_admin_role(),'') in ('super_admin','admin_dealers') then
    return new;
  end if;
  select * into d from dealers where id = new.dealer_id;
  if d is null then return new; end if;
  if d.promo_until is not null and current_date < d.promo_until and d.promo_limit is not null then
    lim := d.promo_limit;
  else
    lim := coalesce(d.normal_limit, 10);
  end if;
  if lim < 0 then return new; end if;
  -- a car being inserted without a price is a draft: let it in
  if new.price is null or new.price <= 0 then return new; end if;
  select count(*) into cnt from listings
    where dealer_id = new.dealer_id
      and coalesce(sold,false) = false
      and coalesce(dormant,false) = false
      and price is not null and price > 0;   -- drafts are free
  if cnt >= lim then
    raise exception 'YAYO_LIMIT_REACHED';
  end if;
  return new;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 47) WHERE THE BUYER WANTS THE CAR DELIVERED
-- The seller never learns who the buyer is — no name, no email,
-- no number. But an inbox where every row reads "Acheteur" is
-- unusable the moment two people ask about the same Hilux.
-- So the conversation carries the destination city the buyer had
-- selected when he wrote. The dashboard pairs it with a short
-- code derived from the user id: same buyer, same code, always.
-- The dealer can finally tell his conversations apart, and the
-- one fact he gains — where the car is going — is the one he
-- needs to quote shipping. It still says nothing about who.
-- Old conversations keep dest null and simply show the code.
-- ═══════════════════════════════════════════════════════════

alter table public.conversations
  add column if not exists dest text;

-- ═══════════════════════════════════════════════════════════
-- 48) LET THE ADMIN GIVE A CAR ITS NAME BACK
-- §44e rebuilt every display name as make + model. That made
-- the columns agree, and it also erased what told two cars
-- apart: "Toyota Dyna Model#BU162-0101914" became "Toyota
-- Dyna", eighteen times over. On the marketplace those show
-- as eighteen identical cards, which reads as a broken site
-- rather than as eighteen trucks.
--
-- The distinguishing part is still in the address each car
-- was imported from, so it can be put back. The repair runs
-- from the admin dashboard, which needs a way to write a name
-- on a car it does not own — same audited, role-checked shape
-- as the other admin actions.
--
-- Do NOT re-run §44e after this: it would erase the names
-- again.
-- ═══════════════════════════════════════════════════════════

create or replace function public.admin_rename_listing(lid uuid, val text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _yayo_require(array['super_admin','admin_support']);
  if coalesce(trim(val), '') = '' then return; end if;
  update listings set car_name = left(trim(val), 160) where id = lid;
  perform _yayo_log('rename_listing', 'listing', lid::text, left(trim(val), 160));
end $$;

-- ═══════════════════════════════════════════════════════════
-- 49) CONTACT DETAILS STAY INSIDE YAYO UNTIL THERE IS AN ORDER
-- One dealer typed his WhatsApp number into eleven of his own
-- listing descriptions and into his first reply to a buyer.
-- Nothing in the code stopped him, because nothing had ever
-- been built to: the rule existed only in the brief.
--
-- The client now refuses to send a message or save a listing
-- that carries a phone number, an e-mail or a messaging link,
-- and tells the sender why. This adds the two database pieces:
-- a counter so a pattern is visible to an admin, and the
-- clean-up of what is already stored.
-- ═══════════════════════════════════════════════════════════

alter table public.dealers            add column if not exists contact_attempts int not null default 0;
alter table public.shipping_agencies  add column if not exists contact_attempts int not null default 0;

-- 49a) Count one refused attempt against whoever sent it.
-- Security definer: the sender must not be able to edit his own
-- counter, and a buyer must not be able to inflate a seller's.
create or replace function public.yayo_flag_contact_attempt(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from conversations where id = cid;
  if c is null then return; end if;
  -- the buyer of this conversation is not the one being counted
  if c.user_id = auth.uid() then return; end if;
  if c.dealer_id is not null then
    update dealers set contact_attempts = contact_attempts + 1 where id = c.dealer_id;
  elsif c.agency_id is not null then
    update shipping_agencies set contact_attempts = contact_attempts + 1 where id = c.agency_id;
  end if;
end $$;

-- 49b) Clean what is already published.
-- Only the phone number and the label in front of it are removed;
-- the specifications, the showroom address and everything else
-- the dealer wrote are his and stay untouched.
-- The number always sits on its own line, behind its own label
-- ("• Tel / WhatsApp: +971 50 541 2007"), so the whole line goes:
-- removing only the digits would leave a dangling "Tel / WhatsApp:"
-- that reads worse than the number did.
update public.listings
   set description = nullif(btrim(
         regexp_replace(
           regexp_replace(description,
             '[^\n]*(\+|00)[ ]?[0-9][0-9()., -]{6,20}[0-9][^\n]*', '', 'g'),
           '\n{3,}', E'\n\n', 'g')
       ), '')
 where description is not null
   and description ~ '(\+|00)[0-9 ()., -]{8,}';

-- ═══════════════════════════════════════════════════════════
-- 50) THE LICENCE VERIFIES, IT NEVER SHOWS
-- The trade licence scan stays where it is: the private
-- "licenses" bucket, admin-only (§10). Nothing here is ever
-- shown to a buyer.
--
-- What the admin records while READING that scan is a
-- reference: the legal name a payment must match, and an
-- expiry date a machine can watch. The dealer never types
-- these himself — he would write what suits him, and the
-- whole chain would be worthless at its root.
--
-- The trading name matters as much as the legal one: in the
-- UAE they almost always differ ("Ibtisam Motors" vs
-- "IBITISAM MOTORS FZCO"), and a check that ignores that
-- would accuse honest dealers.
-- ═══════════════════════════════════════════════════════════

do $$
declare tbl text;
begin
  foreach tbl in array array['dealers','shipping_agencies'] loop
    execute format('alter table public.%I
      add column if not exists legal_name         text,
      add column if not exists trading_name       text,
      add column if not exists licence_number     text,
      add column if not exists licence_authority  text,
      add column if not exists licence_expiry     date,
      add column if not exists registered_address text,
      add column if not exists licence_checked_at timestamptz,
      add column if not exists licence_warned_at  timestamptz,
      add column if not exists licence_expired_at timestamptz', tbl);
  end loop;
end $$;

-- 50a) Only an admin writes these, and every write is logged.
create or replace function public.admin_set_licence(kind text, sid uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare exp date;
begin
  perform _yayo_require(array['super_admin','admin_dealers']);
  if kind not in ('dealer','agency') then return; end if;

  -- an empty string is "not recorded", not a date
  exp := nullif(p->>'licence_expiry','')::date;

  if kind = 'dealer' then
    update dealers set
      legal_name         = nullif(btrim(p->>'legal_name'),''),
      trading_name       = nullif(btrim(p->>'trading_name'),''),
      licence_number     = nullif(btrim(p->>'licence_number'),''),
      licence_authority  = nullif(btrim(p->>'licence_authority'),''),
      registered_address = nullif(btrim(p->>'registered_address'),''),
      licence_expiry     = exp,
      licence_checked_at = now(),
      -- a fresh licence clears the two automatic marks
      licence_warned_at  = case when exp > current_date then null else licence_warned_at end,
      licence_expired_at = case when exp > current_date then null else licence_expired_at end
    where id = sid;
  else
    update shipping_agencies set
      legal_name         = nullif(btrim(p->>'legal_name'),''),
      trading_name       = nullif(btrim(p->>'trading_name'),''),
      licence_number     = nullif(btrim(p->>'licence_number'),''),
      licence_authority  = nullif(btrim(p->>'licence_authority'),''),
      registered_address = nullif(btrim(p->>'registered_address'),''),
      licence_expiry     = exp,
      licence_checked_at = now(),
      licence_warned_at  = case when exp > current_date then null else licence_warned_at end,
      licence_expired_at = case when exp > current_date then null else licence_expired_at end
    where id = sid;
  end if;

  perform _yayo_log('set_licence', kind, sid::text,
    coalesce(nullif(btrim(p->>'legal_name'),''),'') ||
    case when exp is null then '' else ' · exp ' || exp::text end);
end $$;

-- ═══════════════════════════════════════════════════════════
-- 51) A MESSAGE CAN BE A VOICE NOTE OR A DOCUMENT
-- Text and one photo was everything the chat could carry, and
-- next to WhatsApp that looks poor — which is the real reason
-- people ask to move the conversation there.
--
-- A voice note carries four things, not one: where the audio
-- lives, how long it runs, the shape to draw before the audio
-- has loaded, and the transcript THE SENDER APPROVED. The
-- transcript is stored because it is what gets translated for
-- the other side, and what the contact filter reads (§49) —
-- so a number dictated aloud is caught exactly like a typed
-- one, without transcribing the same audio twice.
-- ═══════════════════════════════════════════════════════════

alter table public.messages
  add column if not exists audio_url   text,
  add column if not exists transcript  text,
  add column if not exists duration_ms int,
  add column if not exists waveform    text,      -- 40 digits, 0-9, drawn instantly
  add column if not exists file_url    text,
  add column if not exists file_name   text,
  add column if not exists file_size   int;

-- Voice notes and documents live beside the chat photos, in a
-- bucket that already exists and already has the right rules.

-- ═══════════════════════════════════════════════════════════
-- 52) AN ORDER IS CREATED BY AN ACCEPTED PRICED OFFER
-- Two people could talk in Yayo forever and nothing ever became
-- real. Everything after the handshake — the shipping form, the
-- transport, the tracking, the invoice — needs something to hang
-- on, and there was nothing.
--
-- The seller offers a PRICE with a validity, the buyer accepts,
-- and the acceptance creates the order. Never a buyer-only "I
-- want to buy" button: a dealer would simply tell the buyer to
-- press it, and the price would never be written down.
--
-- An order holds OPTIONAL LINES — car, transport, later spare
-- parts — so a car alone works, transport alone works (a car
-- bought outside Yayo), and both work. Transport arranged later
-- JOINS the existing order instead of opening a second one.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  buyer_id   uuid not null,
  status     text not null default 'open'
             check (status in ('open','closed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_lines (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  kind            text not null check (kind in ('car','transport','part')),
  dealer_id       uuid,
  agency_id       uuid,
  conversation_id uuid,
  listing_id      uuid,
  offer_id        uuid,
  shipment_id     uuid,          -- step 8 hangs the existing shipments table here
  label           text,
  amount          numeric(12,2),
  currency        text not null default 'USD',
  status          text not null default 'agreed'
                  check (status in ('agreed','cancelled')),
  created_at      timestamptz not null default now()
);

create table if not exists public.offers (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id       uuid not null,
  kind            text not null default 'car' check (kind in ('car','transport','part')),
  listing_id      uuid,
  label           text,
  amount          numeric(12,2) not null check (amount > 0),
  currency        text not null default 'USD',
  valid_until     timestamptz,
  note            text,
  status          text not null default 'pending'
                  check (status in ('pending','accepted','declined','expired','cancelled')),
  order_id        uuid,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz
);

create index if not exists offers_convo_idx     on public.offers(conversation_id, created_at desc);
create index if not exists order_lines_ord_idx  on public.order_lines(order_id);
create index if not exists orders_buyer_idx     on public.orders(buyer_id, created_at desc);

-- An offer travels as a normal message, so it lands in the inbox
-- preview, fires the unread badge, arrives live and sends the
-- e-mail — all of that already works and none of it is rebuilt.
alter table public.messages add column if not exists offer_id uuid;

-- 52a) Who is the SELLER side of this conversation?
-- A business is matched by the e-mail on its account, the same
-- way every other policy in this file does it.
create or replace function public.yayo_is_seller_of(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversations c
    left join dealers d           on d.id = c.dealer_id
    left join shipping_agencies a on a.id = c.agency_id
    where c.id = cid
      and (lower(coalesce(d.email,'')) = lower(coalesce(auth.jwt()->>'email',''))
        or lower(coalesce(a.email,'')) = lower(coalesce(auth.jwt()->>'email','')))
  );
$$;

create or replace function public.yayo_is_buyer_of(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversations c where c.id = cid and c.user_id = auth.uid());
$$;

-- 52b) A short code a human can say on the phone: YO-26-K3P9
create or replace function public.yayo_order_code()
returns text language plpgsql as $$
declare c text; i int := 0;
begin
  loop
    c := 'YO-' || to_char(now(),'YY') || '-' ||
         upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 4));
    exit when not exists (select 1 from orders where code = c);
    i := i + 1; exit when i > 20;   -- never spin forever
  end loop;
  return c;
end $$;

-- 52c) The seller makes a priced offer.
-- Only the seller side may call this. The price and the validity
-- are the whole point: an offer with no deadline is a chat message.
create or replace function public.yayo_make_offer(
  cid uuid, p_amount numeric, p_kind text default 'car',
  p_listing uuid default null, p_valid_days int default 7,
  p_note text default null, p_label text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare oid uuid; c record; txt text;
begin
  if not yayo_is_seller_of(cid) then raise exception 'not the seller of this conversation'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'a price is required'; end if;
  select * into c from conversations where id = cid;
  if c is null then raise exception 'conversation not found'; end if;

  -- one live offer at a time: a new one replaces whatever was pending
  update offers set status = 'cancelled', responded_at = now()
   where conversation_id = cid and status = 'pending';

  insert into offers (conversation_id, sender_id, kind, listing_id, label, amount,
                      valid_until, note)
  values (cid, auth.uid(), coalesce(p_kind,'car'), p_listing,
          coalesce(nullif(btrim(p_label),''), c.car_name), p_amount,
          now() + (greatest(coalesce(p_valid_days,7),1) || ' days')::interval,
          nullif(btrim(p_note),''))
  returning id into oid;

  -- the message the buyer actually sees in the thread
  txt := 'Offre : ' || to_char(p_amount,'FM999G999G999') || ' USD';
  insert into messages (conversation_id, sender_id, content, offer_id)
  values (cid, auth.uid(), txt, oid);

  return oid;
end $$;

-- 52d) The buyer accepts or declines. Acceptance is what creates
-- the order — and what joins a second line to an order that
-- already exists, so transport never opens a second order.
create or replace function public.yayo_respond_offer(oid uuid, accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record; ord record; txt text;
begin
  select * into o from offers where id = oid;
  if o is null then raise exception 'offer not found'; end if;
  if not yayo_is_buyer_of(o.conversation_id) then raise exception 'not your offer to answer'; end if;
  if o.status <> 'pending' then raise exception 'this offer has already been answered'; end if;
  if o.valid_until is not null and o.valid_until < now() then
    update offers set status = 'expired', responded_at = now() where id = oid;
    raise exception 'this offer has expired';
  end if;

  select * into c from conversations where id = o.conversation_id;

  if not accept then
    update offers set status = 'declined', responded_at = now() where id = oid;
    insert into messages (conversation_id, sender_id, content)
    values (o.conversation_id, auth.uid(), 'Offre refusée');
    return jsonb_build_object('accepted', false);
  end if;

  -- Which order does this line belong to? One rule: join the most recent open
  -- order that does NOT already have a line of this kind.
  --
  -- Transport agreed after a car joins that car's order, and a car bought
  -- after transport was booked joins that one — which is what the corridor
  -- actually does. But a SECOND car opens a SECOND order, because two cars
  -- from two dealers are two deals, and merging them would put one dealer's
  -- price on another dealer's invoice.
  select * into ord from orders o2
   where o2.buyer_id = auth.uid() and o2.status = 'open'
     and not exists (select 1 from order_lines l
                      where l.order_id = o2.id and l.kind = o.kind and l.status <> 'cancelled')
   order by o2.created_at desc limit 1;
  if ord is null then
    insert into orders (code, buyer_id) values (yayo_order_code(), auth.uid())
    returning * into ord;
  end if;

  insert into order_lines (order_id, kind, dealer_id, agency_id, conversation_id,
                           listing_id, offer_id, label, amount, currency)
  values (ord.id, o.kind, c.dealer_id, c.agency_id, o.conversation_id,
          o.listing_id, o.id, o.label, o.amount, o.currency);

  update offers set status = 'accepted', responded_at = now(), order_id = ord.id where id = oid;
  update orders set updated_at = now() where id = ord.id;

  txt := 'Offre acceptée — commande ' || ord.code;
  insert into messages (conversation_id, sender_id, content)
  values (o.conversation_id, auth.uid(), txt);

  return jsonb_build_object('accepted', true, 'order_id', ord.id, 'code', ord.code);
end $$;

-- 52e) The buyer's orders, newest first, with their lines.
create or replace function public.yayo_my_orders()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', o.id, 'code', o.code, 'status', o.status,
      'created_at', o.created_at,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'kind', l.kind, 'label', l.label, 'amount', l.amount,
          'currency', l.currency, 'status', l.status,
          'conversation_id', l.conversation_id, 'listing_id', l.listing_id,
          'shipment_id', l.shipment_id,
          'seller', coalesce(d.name, a.name),
          'seller_kind', case when l.agency_id is not null then 'agency' else 'dealer' end
        ) order by l.created_at)
        from order_lines l
        left join dealers d           on d.id = l.dealer_id
        left join shipping_agencies a on a.id = l.agency_id
        where l.order_id = o.id and l.status <> 'cancelled'
      ), '[]'::jsonb)
    ) as x
    from orders o
    where o.buyer_id = auth.uid()
  ) s;
$$;

-- 52f) Has this conversation produced an accepted offer?
-- This is the switch the contact filter reads: before an order,
-- no numbers travel; after one, the parties need to reach each
-- other and the filter lifts (§49).
create or replace function public.yayo_convo_unlocked(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from offers where conversation_id = cid and status = 'accepted'
  ) and (yayo_is_buyer_of(cid) or yayo_is_seller_of(cid));
$$;

-- 52g) Stage 1 of contact: once an offer is accepted, the BUYER
-- receives the seller's business identity — and nothing flows
-- back the other way. The licence is never part of this: it
-- exists to verify, never to display.
create or replace function public.yayo_seller_identity(cid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; j jsonb;
begin
  if not yayo_is_buyer_of(cid) then return null; end if;
  if not exists (select 1 from offers where conversation_id = cid and status = 'accepted')
    then return null; end if;
  select * into c from conversations where id = cid;

  if c.dealer_id is not null then
    select to_jsonb(d) into j from dealers d where d.id = c.dealer_id;
  else
    select to_jsonb(a) into j from shipping_agencies a where a.id = c.agency_id;
  end if;
  if j is null then return null; end if;

  -- named keys only. Reading j->>'x' is safe whether or not the
  -- column exists, and nothing about the licence is ever included.
  return jsonb_build_object(
    'name',         coalesce(j->>'trading_name', j->>'name'),
    'legal_name',   j->>'legal_name',
    'address',      j->>'registered_address',
    'city',         j->>'city',
    'phone',        coalesce(j->>'phone', j->>'whatsapp'),
    'email',        j->>'email',
    'verified',     coalesce((j->>'verified')::boolean, false)
  );
end $$;

-- 52h) Row level security.
-- Nothing is written directly: every write goes through the
-- functions above, which check who is asking. These policies
-- only decide who may READ.
alter table public.orders      enable row level security;
alter table public.order_lines enable row level security;
alter table public.offers      enable row level security;

drop policy if exists orders_buyer_read on public.orders;
create policy orders_buyer_read on public.orders
  for select to authenticated using (buyer_id = auth.uid());

-- a seller sees the orders that carry one of their own lines
drop policy if exists orders_seller_read on public.orders;
create policy orders_seller_read on public.orders
  for select to authenticated using (
    exists (select 1 from order_lines l where l.order_id = orders.id
            and (l.dealer_id in (select d.id from dealers d
                   where lower(d.email) = lower(coalesce(auth.jwt()->>'email','')))
              or l.agency_id in (select a.id from shipping_agencies a
                   where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))))
  );

drop policy if exists lines_read on public.order_lines;
create policy lines_read on public.order_lines
  for select to authenticated using (
    order_id in (select o.id from orders o where o.buyer_id = auth.uid())
    or dealer_id in (select d.id from dealers d
         where lower(d.email) = lower(coalesce(auth.jwt()->>'email','')))
    or agency_id in (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))
  );

drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers
  for select to authenticated using (
    yayo_is_buyer_of(conversation_id) or yayo_is_seller_of(conversation_id)
  );

-- 52i) An offer that nobody answered stops being live on its own.
create or replace function public.yayo_expire_offers()
returns int language sql security definer set search_path = public as $$
  with done as (
    update offers set status = 'expired', responded_at = now()
     where status = 'pending' and valid_until is not null and valid_until < now()
    returning 1
  ) select count(*)::int from done;
$$;

grant execute on function public.yayo_make_offer(uuid,numeric,text,uuid,int,text,text) to authenticated;
grant execute on function public.yayo_respond_offer(uuid,boolean)  to authenticated;
grant execute on function public.yayo_my_orders()                  to authenticated;
grant execute on function public.yayo_convo_unlocked(uuid)         to authenticated;
grant execute on function public.yayo_seller_identity(uuid)        to authenticated;
grant execute on function public.yayo_expire_offers()              to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 53) THE DOOR THAT WAS NEVER LOCKED  ***RUN THIS FIRST***
--
-- Found on 2026-08-25 while checking something else. Five tables
-- were readable by anyone holding the publishable key — and that
-- key ships inside js/config.js, which every visitor downloads.
-- It is not a secret and was never meant to be one: row level
-- security is what is supposed to stand behind it, and on these
-- five tables nothing did.
--
--   users          42 rows — including password_hash, and the
--                  identifier column, which holds the phone
--                  numbers and e-mail addresses of the old-Yayo
--                  accounts
--   conversations  10 rows — including last_message previews
--   messages        1 row  — and it contained a phone number
--   favorites       4 rows
--   price_alerts    2 rows
--
-- The new tables from §52 (orders, order_lines, offers) were
-- already closed, which is how this was noticed: they returned
-- nothing while the older tables answered freely.
--
-- Every existing policy on these five is dropped first. A single
-- leftover permissive policy would keep the door open, and the
-- names of what is already there cannot be assumed.
-- ═══════════════════════════════════════════════════════════

do $$
declare tbl text; pol record;
begin
  foreach tbl in array array['users','conversations','messages','favorites','price_alerts'] loop
    execute format('alter table public.%I enable row level security', tbl);
    for pol in select policyname from pg_policies
               where schemaname = 'public' and tablename = tbl loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

-- 53a) users — nobody reads anybody else.
-- The admin list goes through admin_list_users (security definer)
-- and the login row through yayo_ensure_user, so neither needs a
-- read policy here. Nothing else ever reads this table.
create policy users_read_self on public.users
  for select to authenticated
  using (id = auth.uid() or public.yayo_admin_role() is not null);
create policy users_insert_self on public.users
  for insert to authenticated with check (id = auth.uid());
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 53b) conversations — the buyer, the business, the admin.
-- The business is matched by the e-mail on its account, the same
-- way every other policy in this file does it.
create policy convo_read on public.conversations
  for select to authenticated using (
    user_id = auth.uid()
    or dealer_id in (select d.id from dealers d
         where lower(d.email) = lower(coalesce(auth.jwt()->>'email','')))
    or agency_id in (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))
    or public.yayo_admin_role() is not null
  );
-- a buyer opens the conversation; the business never creates one
create policy convo_insert_buyer on public.conversations
  for insert to authenticated with check (user_id = auth.uid());
create policy convo_update on public.conversations
  for update to authenticated using (
    user_id = auth.uid()
    or dealer_id in (select d.id from dealers d
         where lower(d.email) = lower(coalesce(auth.jwt()->>'email','')))
    or agency_id in (select a.id from shipping_agencies a
         where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))
  );

-- 53c) messages — only the two people in the conversation.
-- yayo_is_buyer_of / yayo_is_seller_of are the §52 helpers, and
-- being security definer they answer without dragging the
-- conversations policy into every row check.
create policy msg_read on public.messages
  for select to authenticated using (
    public.yayo_is_buyer_of(conversation_id)
    or public.yayo_is_seller_of(conversation_id)
    or public.yayo_admin_role() is not null
  );
-- you may only send AS yourself, and only into your own conversation
create policy msg_insert on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (public.yayo_is_buyer_of(conversation_id)
         or public.yayo_is_seller_of(conversation_id))
  );
-- read receipts and the inbox preview are written by security
-- definer functions (yayo_mark_read, yayo_touch_convo), so no
-- update policy is needed and none is given.

-- 53d) a buyer's own lists
create policy fav_own on public.favorites
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy alert_own on public.price_alerts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 53e) The old passwords are dead weight.
-- Logging in has gone through Supabase Auth since the rebuild;
-- nothing reads password_hash and nothing ever will. A hash that
-- is never used cannot be stolen if it is not there.
update public.users set password_hash = null where password_hash is not null;

-- ═══════════════════════════════════════════════════════════
-- 54) A DEALER'S PAPERWORK IS NOT PART OF HIS SHOP WINDOW
--
-- §53 closed five tables. This is the same fault one table over,
-- and it breaks two rules that are written down as locked:
--
--   "NO contact details are ever public — no phone, WhatsApp or
--    email visible to anyone browsing, from dealers OR agencies"
--   "THE TRADE LICENCE IS NEVER SHOWN TO ANYONE ... those fields
--    exist to VERIFY, not to display"
--
-- dealers and shipping_agencies answer every column to anyone:
-- whatsapp, email, licence_number, licence_authority,
-- licence_expiry, registered_address, legal_name, license_path,
-- rejected_reason, contact_attempts. And the marketplace asks for
-- them itself — index, acheter and voiture all select dealers(*),
-- so the licence data was travelling to every visitor's browser
-- on every page load, displayed or not.
--
-- The rows must stay public: that is the shop window. So this is
-- done with COLUMN privileges rather than row policies. Table-wide
-- SELECT is revoked, then granted back column by column, skipping
-- the private ones. The two readers who legitimately need a whole
-- row — the business looking at itself, and an admin verifying a
-- licence — get it through security definer functions instead.
-- ═══════════════════════════════════════════════════════════

-- Columns nobody browsing may read. Anything not on this list
-- stays public, so the shop window keeps working exactly as it did.
create or replace function public.yayo_private_biz_cols()
returns text[] language sql immutable as $$
  select array[
    'email','whatsapp','phone',
    'license_path','licence_number','licence_authority','licence_expiry',
    'licence_checked_at','licence_warned_at','licence_expired_at','licence_asked_at',
    'legal_name','trading_name','registered_address',
    'rejected_reason','contact_attempts',
    'plan','normal_limit','promo_limit','promo_until',
    'import_domain','import_claimed_at','welcomed_at'
  ]
$$;

-- Done for `anon` only, on purpose. Anonymous is where the whole
-- internet reads from, and it is the marketplace's own queries
-- that were shipping licence data to every visitor. Narrowing
-- `authenticated` the same way means moving the dealer dashboard
-- and the admin panel onto the two functions below — worth doing,
-- but not blind: it is the dealer's own screen, and breaking it is
-- an outage. The functions are written and waiting for that pass.
do $$
declare tbl text; col text; cols text;
begin
  foreach tbl in array array['dealers','shipping_agencies'] loop
    -- from PUBLIC as well as anon: a privilege granted to the PUBLIC
    -- pseudo-role survives a revoke aimed at anon, and the door would
    -- stay open with nothing in the script admitting it
    execute format('revoke select on public.%I from public', tbl);
    execute format('revoke select on public.%I from anon', tbl);
    cols := '';
    for col in
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = tbl
         and not (column_name = any (public.yayo_private_biz_cols()))
       order by ordinal_position
    loop
      cols := cols || case when cols = '' then '' else ', ' end || quote_ident(col);
    end loop;
    if cols <> '' then
      execute format('grant select (%s) on public.%I to anon', cols, tbl);
    end if;
  end loop;
end $$;

-- 54a) A business looking at its own record gets all of it.
-- Its own e-mail, its own licence — none of that is a secret from
-- the person it belongs to.
create or replace function public.yayo_my_business()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb; mail text;
begin
  mail := lower(coalesce(auth.jwt()->>'email',''));
  if mail = '' then return null; end if;
  select to_jsonb(d) into j from dealers d where lower(d.email) = mail
   order by d.verified desc nulls last, d.created_at asc limit 1;
  if j is not null then return jsonb_set(j, '{kind}', '"dealer"'); end if;
  select to_jsonb(a) into j from shipping_agencies a where lower(a.email) = mail
   order by a.verified desc nulls last, a.created_at asc limit 1;
  if j is not null then return jsonb_set(j, '{kind}', '"agency"'); end if;
  return null;
end $$;

-- 54b) The admin verifying a licence needs the whole row, and is
-- the only other person who does.
create or replace function public.admin_list_businesses(kind text default 'dealer')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb;
begin
  if public.yayo_admin_role() is null then raise exception 'admins only'; end if;
  if kind = 'agency' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
      into j from shipping_agencies a;
  else
    select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
      into j from dealers d;
  end if;
  return j;
end $$;

grant execute on function public.yayo_my_business()              to authenticated;
grant execute on function public.admin_list_businesses(text)     to authenticated;
