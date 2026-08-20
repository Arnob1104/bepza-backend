-- supabase_schema.sql
-- Run this ONCE in your Supabase project's SQL Editor (Dashboard → SQL Editor).
--
-- Supabase Auth (auth.users) already stores email + hashed password for
-- every user. This adds the one thing it doesn't have out of the box:
-- our own "is_active" flag, so an admin can disable a user without
-- deleting their account.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Row Level Security: nobody can read/write this table directly except
-- our backend, which uses the SUPABASE_SECRET_KEY (service role) and
-- therefore bypasses RLS entirely. This blocks any other client — most
-- importantly the extension itself, which only ever holds the
-- publishable key — from reading or editing is_active.
alter table public.profiles enable row level security;

-- Auto-create a profiles row (is_active = true) whenever a new user signs
-- up or is created via the Admin API, so /api/extract's is_active check
-- never has to special-case "no profile row found".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, is_active)
  values (new.id, true)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill: if you already created users before running this script,
-- give them a profile row too (defaults to active).
insert into public.profiles (id, is_active)
select id, true from auth.users
on conflict (id) do nothing;
