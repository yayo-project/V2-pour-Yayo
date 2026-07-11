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
