-- Skatteberegner — Supabase schema
-- Run this in the Supabase project: SQL Editor → New query → paste → Run.
--
-- One row per user. The app stores the whole tax input and the budget items as
-- JSONB blobs (mirroring the localStorage model), so the schema stays minimal.

create table if not exists public.skatteberegner_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tax_input jsonb,
  budget_items jsonb,
  planning jsonb,
  updated_at timestamptz not null default now()
);

-- Migration for existing databases (safe to run repeatedly):
alter table public.skatteberegner_user_data
  add column if not exists planning jsonb;

-- Row Level Security: every user may only touch their own row.
alter table public.skatteberegner_user_data enable row level security;

drop policy if exists "Users can read own data" on public.skatteberegner_user_data;
create policy "Users can read own data"
  on public.skatteberegner_user_data
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own data" on public.skatteberegner_user_data;
create policy "Users can insert own data"
  on public.skatteberegner_user_data
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own data" on public.skatteberegner_user_data;
create policy "Users can update own data"
  on public.skatteberegner_user_data
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own data" on public.skatteberegner_user_data;
create policy "Users can delete own data"
  on public.skatteberegner_user_data
  for delete
  using (auth.uid() = user_id);
