-- ============================================================
-- Wealth OS — Supabase Database Schema (idempotent version)
-- Safe to run multiple times — drops existing policies first
-- ============================================================

-- ─── Profiles ────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  currency text default 'USD',
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
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
drop policy if exists "Users can manage own assets" on public.assets;
create policy "Users can manage own assets" on public.assets for all using (auth.uid() = user_id);

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
drop policy if exists "Users can manage own transactions" on public.transactions;
create policy "Users can manage own transactions" on public.transactions for all using (auth.uid() = user_id);

-- ─── Budgets ─────────────────────────────────────────────────
create table if not exists public.budgets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  category text not null,
  monthly_limit numeric not null,
  month text not null,
  created_at timestamptz default now(),
  unique(user_id, category, month)
);
alter table public.budgets enable row level security;
drop policy if exists "Users can manage own budgets" on public.budgets;
create policy "Users can manage own budgets" on public.budgets for all using (auth.uid() = user_id);

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
drop policy if exists "Users can manage own goals" on public.goals;
create policy "Users can manage own goals" on public.goals for all using (auth.uid() = user_id);

-- ─── Net Worth History ───────────────────────────────────────
create table if not exists public.net_worth_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  date text not null,
  total_assets numeric not null,
  total_liabilities numeric not null,
  net_worth numeric generated always as (total_assets - total_liabilities) stored,
  created_at timestamptz default now(),
  unique(user_id, date)
);
alter table public.net_worth_history enable row level security;
drop policy if exists "Users can manage own net worth history" on public.net_worth_history;
create policy "Users can manage own net worth history" on public.net_worth_history for all using (auth.uid() = user_id);

-- ─── Indexes ─────────────────────────────────────────────────
create index if not exists assets_user_id_idx on public.assets(user_id);
create index if not exists transactions_user_id_date_idx on public.transactions(user_id, date desc);
create index if not exists goals_user_id_idx on public.goals(user_id);
create index if not exists budgets_user_id_month_idx on public.budgets(user_id, month);
create index if not exists net_worth_history_user_id_idx on public.net_worth_history(user_id, date desc);

-- ─── Traders (global — written by sync workers via service role) ──
create table if not exists public.traders (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  handle text unique not null,
  asset_class text not null check (asset_class in ('stock','crypto','forex','polymarket')),
  source text not null check (source in ('unusual_whales','quiver_quant','nansen','arkham','myfxbook','polymarket','manual')),
  source_id text,
  avatar_url text,
  bio text,
  total_return_pct numeric default 0,
  ytd_return_pct numeric default 0,
  win_rate_pct numeric default 0,
  avg_trade_size_usd numeric default 0,
  trade_count integer default 0,
  followers_count integer default 0,
  verified boolean default false,
  is_active boolean default true,
  metadata jsonb default '{}',
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.traders enable row level security;
drop policy if exists "Authenticated users can read traders" on public.traders;
create policy "Authenticated users can read traders" on public.traders for select using (auth.role() = 'authenticated');

-- ─── Trader Trades ────────────────────────────────────────────
create table if not exists public.trader_trades (
  id uuid default gen_random_uuid() primary key,
  trader_id uuid references public.traders on delete cascade not null,
  asset_class text not null,
  symbol text not null,
  action text not null check (action in ('buy','sell','short','cover')),
  quantity numeric,
  price numeric,
  notional_value numeric,
  trade_date timestamptz not null default now(),
  source_trade_id text unique,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
alter table public.trader_trades enable row level security;
drop policy if exists "Authenticated users can read trader trades" on public.trader_trades;
create policy "Authenticated users can read trader trades" on public.trader_trades for select using (auth.role() = 'authenticated');

-- ─── User Followed Traders ────────────────────────────────────
create table if not exists public.user_followed_traders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trader_id uuid references public.traders on delete cascade not null,
  auto_copy_enabled boolean default false,
  max_allocation_pct_per_trade numeric default 5 check (max_allocation_pct_per_trade between 1 and 25),
  copy_asset_classes text[] default '{stock,crypto,forex,polymarket}',
  risk_level text default 'moderate' check (risk_level in ('conservative','moderate','aggressive')),
  max_daily_copy_usd numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, trader_id)
);
alter table public.user_followed_traders enable row level security;
drop policy if exists "Users can manage own followed traders" on public.user_followed_traders;
create policy "Users can manage own followed traders" on public.user_followed_traders for all using (auth.uid() = user_id);

-- ─── User Copied Positions ────────────────────────────────────
create table if not exists public.user_copied_positions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trader_id uuid references public.traders on delete cascade not null,
  trader_trade_id uuid references public.trader_trades on delete set null,
  symbol text not null,
  asset_class text not null,
  action text not null,
  quantity numeric,
  entry_price numeric,
  current_price numeric,
  notional_value numeric default 0,
  pnl_usd numeric default 0,
  pnl_pct numeric default 0,
  status text default 'pending' check (status in ('pending','open','closed','failed')),
  broker text,
  broker_order_id text,
  error_message text,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  created_at timestamptz default now()
);
alter table public.user_copied_positions enable row level security;
drop policy if exists "Users can manage own copied positions" on public.user_copied_positions;
create policy "Users can manage own copied positions" on public.user_copied_positions for all using (auth.uid() = user_id);

-- ─── Audit Logs ──────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete set null,
  agent_name text not null,
  trade_context jsonb,
  output jsonb,
  duration_ms integer,
  created_at timestamptz default now()
);
alter table public.audit_logs enable row level security;
drop policy if exists "Users can view own audit logs" on public.audit_logs;
create policy "Users can view own audit logs" on public.audit_logs for select using (auth.uid() = user_id);

-- ─── CIO Decisions ────────────────────────────────────────────────────────
create table if not exists public.cio_decisions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  trader_trade_id uuid references public.trader_trades on delete set null,
  decision text not null check (decision in ('execute','reduce','defer','reject')),
  reasoning text,
  investment_committee_view text,
  portfolio_impact text,
  recommended_pct numeric,
  confidence text,
  plain_english_summary text,
  agent_scores jsonb,
  mirofish_score numeric,
  final_score numeric,
  full_output jsonb,
  created_at timestamptz default now()
);
alter table public.cio_decisions enable row level security;
drop policy if exists "Users can view own CIO decisions" on public.cio_decisions;
create policy "Users can view own CIO decisions" on public.cio_decisions for select using (auth.uid() = user_id);

-- ─── Copy Trading Indexes ─────────────────────────────────────
create index if not exists traders_asset_class_idx on public.traders(asset_class);
create index if not exists traders_source_idx on public.traders(source);
create index if not exists trader_trades_trader_id_idx on public.trader_trades(trader_id, trade_date desc);
create index if not exists user_followed_traders_user_id_idx on public.user_followed_traders(user_id);
create index if not exists user_copied_positions_user_id_idx on public.user_copied_positions(user_id, opened_at desc);
