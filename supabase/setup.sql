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
