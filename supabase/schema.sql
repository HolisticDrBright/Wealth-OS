-- ============================================================
-- Wealth OS — Supabase Database Schema
-- Run this in the Supabase SQL Editor to set up the database
-- ============================================================

-- Enable Row Level Security on all tables

-- ─── Profiles ────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  currency text default 'USD',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Assets ──────────────────────────────────────────────────
create table if not exists public.assets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  category text not null check (category in ('stock','crypto','real_estate','cash','bond','other')),
  symbol text,
  quantity numeric,
  current_value numeric not null default 0,
  purchase_price numeric,
  purchase_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.assets enable row level security;

create policy "Users can manage own assets"
  on public.assets for all using (auth.uid() = user_id);

-- ─── Transactions ────────────────────────────────────────────
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  date date not null default current_date,
  description text not null,
  amount numeric not null,
  category text not null,
  type text not null check (type in ('income','expense')),
  account text,
  created_at timestamptz default now()
);

alter table public.transactions enable row level security;

create policy "Users can manage own transactions"
  on public.transactions for all using (auth.uid() = user_id);

-- ─── Budgets ─────────────────────────────────────────────────
create table if not exists public.budgets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  category text not null,
  monthly_limit numeric not null,
  month text not null, -- format: YYYY-MM
  created_at timestamptz default now(),
  unique(user_id, category, month)
);

alter table public.budgets enable row level security;

create policy "Users can manage own budgets"
  on public.budgets for all using (auth.uid() = user_id);

-- ─── Goals ───────────────────────────────────────────────────
create table if not exists public.goals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  target_date date,
  category text not null check (category in ('retirement','home','education','emergency','vacation','other')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.goals enable row level security;

create policy "Users can manage own goals"
  on public.goals for all using (auth.uid() = user_id);

-- ─── Net Worth History ───────────────────────────────────────
create table if not exists public.net_worth_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  date text not null, -- format: YYYY-MM
  total_assets numeric not null,
  total_liabilities numeric not null,
  net_worth numeric generated always as (total_assets - total_liabilities) stored,
  created_at timestamptz default now(),
  unique(user_id, date)
);

alter table public.net_worth_history enable row level security;

create policy "Users can manage own net worth history"
  on public.net_worth_history for all using (auth.uid() = user_id);

-- ─── Indexes ─────────────────────────────────────────────────
create index if not exists assets_user_id_idx on public.assets(user_id);
create index if not exists transactions_user_id_date_idx on public.transactions(user_id, date desc);
create index if not exists goals_user_id_idx on public.goals(user_id);
create index if not exists budgets_user_id_month_idx on public.budgets(user_id, month);
create index if not exists net_worth_history_user_id_idx on public.net_worth_history(user_id, date desc);
