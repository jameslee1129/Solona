-- Suggested tables for auth and wallets
-- Execute in Supabase SQL editor

create table if not exists public.users (
  id text primary key,
  created_at timestamp with time zone default now()
);

create table if not exists public.wallets (
  address text primary key,
  user_id text references public.users(id) on delete set null,
  last_login_at timestamp with time zone
);

create table if not exists public.custodial_wallets (
  id bigserial primary key,
  user_id text references public.users(id) on delete cascade,
  public_key text not null,
  secret_key_b64 text not null,
  created_at timestamp with time zone default now()
);

-- Enforce single custodial wallet per user
create unique index if not exists custodial_wallets_user_unique on public.custodial_wallets(user_id);

-- Settings per account
create table if not exists public.account_settings (
  user_id text primary key references public.users(id) on delete cascade,
  pnl_baseline_usd numeric,
  pnl_baseline_at timestamp with time zone
);

