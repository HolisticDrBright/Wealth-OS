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

-- ─── Risk Controls ────────────────────────────────────────────────────────
create table if not exists public.risk_controls (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade unique not null,
  max_portfolio_risk_pct numeric default 20,
  max_single_position_pct numeric default 10,
  max_drawdown_pct numeric default 15,
  stop_loss_enabled boolean default false,
  daily_loss_limit_usd numeric,
  volatility_threshold text default 'medium' check (volatility_threshold in ('low','medium','high')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.risk_controls enable row level security;
drop policy if exists "Users can manage own risk controls" on public.risk_controls;
create policy "Users can manage own risk controls" on public.risk_controls for all using (auth.uid() = user_id);

-- ─── Simulation Jobs ──────────────────────────────────────────────────────
create table if not exists public.simulation_jobs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  title text not null,
  description text,
  asset_class text,
  symbols text[],
  scenario text not null check (scenario in ('bull','bear','base','stress','montecarlo')),
  horizon_days integer default 30,
  num_simulations integer default 1000,
  status text default 'pending' check (status in ('pending','running','completed','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);
alter table public.simulation_jobs enable row level security;
drop policy if exists "Users can manage own simulation jobs" on public.simulation_jobs;
create policy "Users can manage own simulation jobs" on public.simulation_jobs for all using (auth.uid() = user_id);

-- ─── Simulation Reports ───────────────────────────────────────────────────
create table if not exists public.simulation_reports (
  id uuid default gen_random_uuid() primary key,
  job_id uuid references public.simulation_jobs on delete cascade,
  user_id uuid references auth.users on delete cascade,
  bull_probability numeric,
  bear_probability numeric,
  consensus_direction text check (consensus_direction in ('bullish','bearish','neutral')),
  tail_risk_score numeric,
  confidence_level text check (confidence_level in ('high','medium','low')),
  agent_consensus numeric,
  key_findings text[],
  scenario_summary text,
  raw_output jsonb,
  created_at timestamptz default now()
);
alter table public.simulation_reports enable row level security;
drop policy if exists "Users can view own simulation reports" on public.simulation_reports;
create policy "Users can view own simulation reports" on public.simulation_reports for all using (auth.uid() = user_id);

-- ─── Opportunities ────────────────────────────────────────────────────────
create table if not exists public.opportunities (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  source text not null check (source in ('cio','screener','trader_signal','manual')),
  symbol text,
  asset_class text,
  title text not null,
  description text,
  action text check (action in ('buy','sell','watch')),
  confidence text check (confidence in ('high','medium','low')),
  score numeric,
  expires_at timestamptz,
  is_read boolean default false,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
alter table public.opportunities enable row level security;
drop policy if exists "Users can view own opportunities" on public.opportunities;
drop policy if exists "Users can update own opportunities" on public.opportunities;
create policy "Users can view own opportunities" on public.opportunities for select using (auth.uid() = user_id or user_id is null);
create policy "Users can update own opportunities" on public.opportunities for update using (auth.uid() = user_id);

-- ─── Alerts ───────────────────────────────────────────────────────────────
create table if not exists public.alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  type text not null check (type in ('trade_executed','risk_breach','price_alert','simulation_done','opportunity','system')),
  title text not null,
  body text,
  severity text default 'info' check (severity in ('info','warning','critical')),
  is_read boolean default false,
  action_url text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
alter table public.alerts enable row level security;
drop policy if exists "Users can manage own alerts" on public.alerts;
create policy "Users can manage own alerts" on public.alerts for all using (auth.uid() = user_id);

-- ─── Linked Accounts ──────────────────────────────────────────────────────
create table if not exists public.linked_accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  provider text not null check (provider in ('alpaca','kraken','oanda','polymarket','plaid','manual')),
  account_name text,
  account_id_external text,
  status text default 'active' check (status in ('active','disconnected','error')),
  balance_usd numeric,
  currency text default 'USD',
  is_paper_trading boolean default false,
  metadata jsonb default '{}',
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.linked_accounts enable row level security;
drop policy if exists "Users can manage own linked accounts" on public.linked_accounts;
create policy "Users can manage own linked accounts" on public.linked_accounts for all using (auth.uid() = user_id);

-- ─── Indexes for new tables ───────────────────────────────────────────────
create index if not exists alerts_user_id_created_at_idx on public.alerts(user_id, created_at desc);
create index if not exists alerts_user_id_is_read_idx on public.alerts(user_id, is_read);
create index if not exists opportunities_user_id_score_idx on public.opportunities(user_id, score desc);
create index if not exists simulation_jobs_user_id_status_idx on public.simulation_jobs(user_id, status);
create index if not exists linked_accounts_user_id_idx on public.linked_accounts(user_id);

-- ─── Realtime publications ────────────────────────────────────────────────
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.simulation_jobs;
alter publication supabase_realtime add table public.trader_trades;
alter publication supabase_realtime add table public.user_copied_positions;

-- ─── User Settings ────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade unique not null,
  full_name text,
  email text,
  autopilot_enabled boolean default false,
  copy_budget_usd numeric default 1000,
  risk_profile text default 'moderate' check (risk_profile in ('conservative','moderate','aggressive')),
  notify_trades boolean default true,
  notify_weekly_summary boolean default true,
  notify_risk_alerts boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "Users can view own settings" on public.user_settings;
drop policy if exists "Users can update own settings" on public.user_settings;
drop policy if exists "Users can insert own settings" on public.user_settings;
create policy "Users can view own settings" on public.user_settings for select using (auth.uid() = user_id);
create policy "Users can update own settings" on public.user_settings for update using (auth.uid() = user_id);
create policy "Users can insert own settings" on public.user_settings for insert with check (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Orders (Full Execution Engine) ──────────────────────────────────────
create table if not exists public.orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  symbol text not null,
  asset_class text not null,
  side text not null check (side in ('buy','sell')),
  order_type text not null check (order_type in ('market','limit','stop','stop_limit','trailing_stop')),
  status text default 'pending' check (status in ('pending','submitted','open','partially_filled','filled','cancelled','rejected','expired')),
  quantity numeric,
  notional_usd numeric,
  limit_price numeric,
  stop_price numeric,
  trail_amount numeric,
  trail_percent numeric,
  time_in_force text default 'day' check (time_in_force in ('day','gtc','ioc','fok')),
  broker text,
  broker_order_id text,
  filled_qty numeric default 0,
  filled_avg_price numeric,
  source text check (source in ('manual','copy_trade','rebalance','harvest','rule')),
  source_ref_id uuid,
  error_message text,
  submitted_at timestamptz,
  filled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.orders enable row level security;
drop policy if exists "Users can manage own orders" on public.orders;
create policy "Users can manage own orders" on public.orders for all using (auth.uid() = user_id);
create index if not exists orders_user_id_status_idx on public.orders(user_id, status, created_at desc);
create index if not exists orders_broker_order_id_idx on public.orders(broker_order_id) where broker_order_id is not null;
alter publication supabase_realtime add table public.orders;

-- ─── Portfolio Targets (Rebalancing Engine) ───────────────────────────────
create table if not exists public.portfolio_targets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  asset_class text not null,
  target_pct numeric not null check (target_pct between 0 and 100),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, asset_class)
);
alter table public.portfolio_targets enable row level security;
drop policy if exists "Users can manage own targets" on public.portfolio_targets;
create policy "Users can manage own targets" on public.portfolio_targets for all using (auth.uid() = user_id);

-- ─── Rebalance Suggestions ────────────────────────────────────────────────
create table if not exists public.rebalance_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  symbol text,
  asset_class text not null,
  action text not null check (action in ('buy','sell')),
  current_pct numeric,
  target_pct numeric,
  drift_pct numeric,
  suggested_notional numeric,
  status text default 'pending' check (status in ('pending','approved','executed','dismissed')),
  executed_at timestamptz,
  created_at timestamptz default now()
);
alter table public.rebalance_suggestions enable row level security;
drop policy if exists "Users can manage own rebalance suggestions" on public.rebalance_suggestions;
create policy "Users can manage own rebalance suggestions" on public.rebalance_suggestions for all using (auth.uid() = user_id);
create index if not exists rebalance_suggestions_user_id_idx on public.rebalance_suggestions(user_id, created_at desc);

-- ─── Harvest Candidates (Tax-Loss Harvesting) ─────────────────────────────
create table if not exists public.harvest_candidates (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  symbol text not null,
  asset_class text not null,
  position_id uuid references public.user_copied_positions on delete set null,
  unrealized_loss_usd numeric not null,
  unrealized_loss_pct numeric not null,
  purchase_date date,
  wash_sale_risk boolean default false,
  replacement_symbol text,
  status text default 'pending' check (status in ('pending','harvested','dismissed','expired')),
  expires_at timestamptz,
  harvested_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
alter table public.harvest_candidates enable row level security;
drop policy if exists "Users can manage own harvest candidates" on public.harvest_candidates;
create policy "Users can manage own harvest candidates" on public.harvest_candidates for all using (auth.uid() = user_id);
create index if not exists harvest_candidates_user_id_idx on public.harvest_candidates(user_id, created_at desc);

-- ─── Strategies ───────────────────────────────────────────────────────────
create table if not exists public.strategies (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  description text,
  asset_class text,
  type text check (type in ('momentum','value','copy_trade','manual','rebalance','harvest')),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.strategies enable row level security;
drop policy if exists "Users can manage own strategies" on public.strategies;
create policy "Users can manage own strategies" on public.strategies for all using (auth.uid() = user_id);

create table if not exists public.strategy_positions (
  id uuid default gen_random_uuid() primary key,
  strategy_id uuid references public.strategies on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  copied_position_id uuid references public.user_copied_positions on delete set null,
  symbol text not null,
  action text not null,
  entry_price numeric,
  exit_price numeric,
  quantity numeric,
  notional_value numeric,
  pnl_usd numeric default 0,
  pnl_pct numeric default 0,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  status text default 'open' check (status in ('open','closed'))
);
alter table public.strategy_positions enable row level security;
drop policy if exists "Users can manage own strategy positions" on public.strategy_positions;
create policy "Users can manage own strategy positions" on public.strategy_positions for all using (auth.uid() = user_id);
create index if not exists strategy_positions_strategy_id_idx on public.strategy_positions(strategy_id, opened_at desc);
create index if not exists strategy_positions_user_id_idx on public.strategy_positions(user_id);

-- ─── Autopilot Rules Engine ───────────────────────────────────────────────
create table if not exists public.autopilot_rules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  is_active boolean default true,
  priority integer default 0,
  condition_symbols text[],
  condition_asset_classes text[],
  condition_actions text[],
  condition_min_notional numeric,
  condition_max_notional numeric,
  condition_trader_ids uuid[],
  condition_min_trader_return_pct numeric,
  condition_min_cio_score numeric,
  condition_time_window_start time,
  condition_time_window_end time,
  action_type text not null check (action_type in ('copy','skip','reduce','alert_only')),
  action_sizing_pct numeric,
  action_sizing_mode text check (action_sizing_mode in ('fixed_pct','fixed_usd','proportional')),
  action_fixed_usd numeric,
  action_max_daily_usd numeric,
  action_broker_override text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.autopilot_rules enable row level security;
drop policy if exists "Users can manage own autopilot rules" on public.autopilot_rules;
create policy "Users can manage own autopilot rules" on public.autopilot_rules for all using (auth.uid() = user_id);
create index if not exists autopilot_rules_user_id_active_idx on public.autopilot_rules(user_id, is_active, priority);

-- ─── Retirement Plans ─────────────────────────────────────────────────────
create table if not exists public.retirement_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade unique not null,
  current_age integer,
  target_retirement_age integer default 65,
  current_savings_usd numeric default 0,
  annual_contribution_usd numeric default 0,
  expected_return_pct numeric default 7.0,
  inflation_rate_pct numeric default 2.5,
  target_monthly_income_usd numeric,
  social_security_monthly_usd numeric default 0,
  pension_monthly_usd numeric default 0,
  ira_balance_usd numeric default 0,
  roth_ira_balance_usd numeric default 0,
  k401_balance_usd numeric default 0,
  taxable_balance_usd numeric default 0,
  projected_retirement_balance_usd numeric,
  income_gap_monthly_usd numeric,
  on_track boolean,
  last_computed_at timestamptz,
  claude_advice text,
  claude_advice_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.retirement_plans enable row level security;
drop policy if exists "Users can manage own retirement plan" on public.retirement_plans;
create policy "Users can manage own retirement plan" on public.retirement_plans for all using (auth.uid() = user_id);

-- ─── Crypto Prices & Portfolio ────────────────────────────────────────────
create table if not exists public.crypto_prices (
  id uuid default gen_random_uuid() primary key,
  symbol text not null,
  pair text not null,
  price_usd numeric not null,
  bid numeric,
  ask numeric,
  volume_24h numeric,
  change_pct_24h numeric,
  high_24h numeric,
  low_24h numeric,
  source text default 'kraken',
  fetched_at timestamptz default now(),
  unique(symbol, source)
);

create table if not exists public.crypto_portfolio (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  symbol text not null,
  balance numeric not null default 0,
  balance_usd numeric not null default 0,
  avg_cost_usd numeric,
  unrealized_pnl_usd numeric default 0,
  linked_account_id uuid references public.linked_accounts on delete set null,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, symbol)
);
alter table public.crypto_portfolio enable row level security;
drop policy if exists "Users can manage own crypto portfolio" on public.crypto_portfolio;
create policy "Users can manage own crypto portfolio" on public.crypto_portfolio for all using (auth.uid() = user_id);

-- ─── Forex Rates & Positions ──────────────────────────────────────────────
create table if not exists public.forex_rates (
  id uuid default gen_random_uuid() primary key,
  instrument text not null,
  bid numeric not null,
  ask numeric not null,
  spread_pips numeric,
  source text default 'oanda',
  fetched_at timestamptz default now(),
  unique(instrument, source)
);

create table if not exists public.forex_positions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  instrument text not null,
  side text not null check (side in ('long','short')),
  units numeric not null,
  avg_price numeric,
  current_price numeric,
  unrealized_pnl numeric default 0,
  unrealized_pnl_usd numeric default 0,
  linked_account_id uuid references public.linked_accounts on delete set null,
  oanda_trade_id text,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.forex_positions enable row level security;
drop policy if exists "Users can manage own forex positions" on public.forex_positions;
create policy "Users can manage own forex positions" on public.forex_positions for all using (auth.uid() = user_id);

-- ─── Alter existing tables for Phase 2 ───────────────────────────────────
alter table public.trader_trades
  add column if not exists cio_scored boolean default false,
  add column if not exists cio_decision_id uuid references public.cio_decisions on delete set null;
create index if not exists trader_trades_unscored_idx
  on public.trader_trades(cio_scored, trade_date desc) where cio_scored = false;

alter table public.user_copied_positions
  add column if not exists order_id uuid references public.orders on delete set null,
  add column if not exists strategy_id uuid references public.strategies on delete set null;

alter table public.user_settings
  add column if not exists rebalance_threshold_pct numeric default 5,
  add column if not exists harvest_threshold_usd numeric default 250,
  add column if not exists harvest_threshold_pct numeric default 3;

-- ============================================================
-- Phase 3: Marketplace, Backtesting, Household, Sleeves
-- ============================================================

-- ─── Marketplace Listings ─────────────────────────────────
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  publisher_user_id uuid references auth.users on delete cascade not null,
  trader_id uuid references public.traders(id) on delete cascade,
  title text not null,
  description text,
  strategy_type text default 'copy_trade',
  asset_classes text[] default '{}'::text[],
  price_monthly_usd numeric(12,2) default 0,
  is_free boolean generated always as (price_monthly_usd = 0) stored,
  is_published boolean default false,
  is_verified boolean default false,
  subscriber_count int default 0,
  avg_rating numeric(3,2),
  review_count int default 0,
  total_return_pct numeric(10,4),
  ytd_return_pct numeric(10,4),
  sharpe_ratio numeric(8,4),
  max_drawdown_pct numeric(8,4),
  win_rate_pct numeric(8,4),
  trade_count int default 0,
  inception_date date,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.marketplace_listings enable row level security;
drop policy if exists "Listings are publicly readable" on public.marketplace_listings;
drop policy if exists "Publishers manage own listings" on public.marketplace_listings;
create policy "Listings are publicly readable" on public.marketplace_listings for select using (is_published = true or publisher_user_id = auth.uid());
create policy "Publishers manage own listings" on public.marketplace_listings for all using (publisher_user_id = auth.uid());

-- ─── Marketplace Subscriptions ────────────────────────────
create table if not exists public.marketplace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  listing_id uuid references public.marketplace_listings(id) on delete cascade not null,
  status text default 'active' check (status in ('active','paused','cancelled')),
  auto_copy_enabled boolean default true,
  max_allocation_pct numeric(5,2) default 5,
  risk_level text default 'moderate' check (risk_level in ('conservative','moderate','aggressive')),
  subscribed_at timestamptz default now(),
  cancelled_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  unique (user_id, listing_id)
);
alter table public.marketplace_subscriptions enable row level security;
drop policy if exists "Users manage own subscriptions" on public.marketplace_subscriptions;
create policy "Users manage own subscriptions" on public.marketplace_subscriptions for all using (user_id = auth.uid());

-- ─── Marketplace Reviews ──────────────────────────────────
create table if not exists public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.marketplace_listings(id) on delete cascade not null,
  reviewer_user_id uuid references auth.users on delete cascade not null,
  rating int check (rating between 1 and 5) not null,
  title text,
  body text,
  is_verified_subscriber boolean default false,
  helpful_votes int default 0,
  created_at timestamptz default now(),
  unique (listing_id, reviewer_user_id)
);
alter table public.marketplace_reviews enable row level security;
drop policy if exists "Reviews are publicly readable" on public.marketplace_reviews;
drop policy if exists "Users manage own reviews" on public.marketplace_reviews;
create policy "Reviews are publicly readable" on public.marketplace_reviews for select using (true);
create policy "Users manage own reviews" on public.marketplace_reviews for all using (reviewer_user_id = auth.uid());

-- ─── Backtest Jobs ────────────────────────────────────────
create table if not exists public.backtest_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  strategy_id uuid references public.strategies(id) on delete set null,
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  name text not null,
  description text,
  symbols text[] not null default '{}'::text[],
  asset_class text default 'stock',
  start_date date not null,
  end_date date not null,
  initial_capital_usd numeric(15,2) default 100000,
  rebalance_frequency text default 'none' check (rebalance_frequency in ('none','daily','weekly','monthly')),
  benchmark_symbol text default 'SPY',
  status text default 'pending' check (status in ('pending','running','completed','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.backtest_jobs enable row level security;
drop policy if exists "Users manage own backtests" on public.backtest_jobs;
create policy "Users manage own backtests" on public.backtest_jobs for all using (user_id = auth.uid());

-- ─── Backtest Results ─────────────────────────────────────
create table if not exists public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.backtest_jobs(id) on delete cascade not null unique,
  user_id uuid references auth.users on delete cascade not null,
  total_return_pct numeric(12,4),
  annualized_return_pct numeric(12,4),
  benchmark_return_pct numeric(12,4),
  alpha numeric(10,4),
  beta numeric(10,4),
  sharpe_ratio numeric(10,4),
  sortino_ratio numeric(10,4),
  max_drawdown_pct numeric(10,4),
  max_drawdown_duration_days int,
  win_rate_pct numeric(10,4),
  profit_factor numeric(10,4),
  total_trades int default 0,
  winning_trades int default 0,
  losing_trades int default 0,
  avg_win_usd numeric(12,2),
  avg_loss_usd numeric(12,2),
  final_portfolio_value_usd numeric(15,2),
  equity_curve jsonb default '[]'::jsonb,
  monthly_returns jsonb default '{}'::jsonb,
  trade_log jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);
alter table public.backtest_results enable row level security;
drop policy if exists "Users view own backtest results" on public.backtest_results;
create policy "Users view own backtest results" on public.backtest_results for all using (user_id = auth.uid());

-- ─── Households ───────────────────────────────────────────
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users on delete cascade not null,
  household_type text default 'family' check (household_type in ('family','couple','individual','trust','foundation','advisory')),
  total_net_worth_usd numeric(15,2) default 0,
  advisor_user_id uuid references auth.users on delete set null,
  estate_plan_notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.households enable row level security;
drop policy if exists "Household members can view" on public.households;
drop policy if exists "Household owner manages" on public.households;
create policy "Household owner manages" on public.households for all using (owner_user_id = auth.uid());
create policy "Household advisor can view" on public.households for select using (advisor_user_id = auth.uid());

-- ─── Household Members ────────────────────────────────────
create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade not null,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  role text default 'member' check (role in ('owner','spouse','dependent','trustee','beneficiary','advisor')),
  email text,
  birth_year int,
  net_worth_usd numeric(15,2) default 0,
  income_usd numeric(15,2) default 0,
  is_invited boolean default false,
  invited_at timestamptz,
  joined_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.household_members enable row level security;
drop policy if exists "Household owner manages members" on public.household_members;
create policy "Household owner manages members" on public.household_members for all using (
  household_id in (select id from public.households where owner_user_id = auth.uid())
);

-- ─── Advisor Clients ──────────────────────────────────────
create table if not exists public.advisor_clients (
  id uuid primary key default gen_random_uuid(),
  advisor_user_id uuid references auth.users on delete cascade not null,
  client_user_id uuid references auth.users on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  client_name text not null,
  client_email text,
  aum_usd numeric(15,2) default 0,
  fee_type text default 'percentage' check (fee_type in ('percentage','flat','hybrid')),
  fee_pct numeric(6,4),
  fee_flat_annual_usd numeric(12,2),
  status text default 'active' check (status in ('active','prospect','inactive')),
  notes text,
  onboarded_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.advisor_clients enable row level security;
drop policy if exists "Advisors manage own clients" on public.advisor_clients;
create policy "Advisors manage own clients" on public.advisor_clients for all using (advisor_user_id = auth.uid());

-- ─── Portfolio Sleeves ────────────────────────────────────
create table if not exists public.portfolio_sleeves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  household_id uuid references public.households(id) on delete set null,
  name text not null,
  description text,
  sleeve_type text default 'autonomous' check (sleeve_type in ('autonomous','manual','advisor_managed','trust')),
  target_allocation_pct numeric(6,3),
  current_value_usd numeric(15,2) default 0,
  inception_date date,
  benchmark_symbol text,
  is_active boolean default true,
  approval_required boolean default true,
  approval_threshold_usd numeric(12,2) default 1000,
  approved_strategies text[] default '{}'::text[],
  approved_asset_classes text[] default '{}'::text[],
  max_position_pct numeric(6,3) default 10,
  max_drawdown_pct numeric(6,3) default 20,
  halt_on_breach boolean default true,
  halted boolean default false,
  halted_reason text,
  performance_ytd_pct numeric(10,4),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.portfolio_sleeves enable row level security;
drop policy if exists "Users manage own sleeves" on public.portfolio_sleeves;
create policy "Users manage own sleeves" on public.portfolio_sleeves for all using (user_id = auth.uid());

-- ─── Sleeve Approval Requests ─────────────────────────────
create table if not exists public.sleeve_approval_requests (
  id uuid primary key default gen_random_uuid(),
  sleeve_id uuid references public.portfolio_sleeves(id) on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  request_type text default 'trade' check (request_type in ('trade','rebalance','parameter_change','halt','resume')),
  symbol text,
  action text,
  notional_usd numeric(12,2),
  order_type text default 'market',
  reason text,
  status text default 'pending' check (status in ('pending','approved','rejected','expired')),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  expires_at timestamptz default (now() + interval '24 hours'),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.sleeve_approval_requests enable row level security;
drop policy if exists "Users manage own approval requests" on public.sleeve_approval_requests;
create policy "Users manage own approval requests" on public.sleeve_approval_requests for all using (user_id = auth.uid());

-- ─── Sleeve Positions ─────────────────────────────────────
create table if not exists public.sleeve_positions (
  id uuid primary key default gen_random_uuid(),
  sleeve_id uuid references public.portfolio_sleeves(id) on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  symbol text not null,
  asset_class text not null,
  quantity numeric(20,8) default 0,
  avg_cost_usd numeric(12,4),
  current_price_usd numeric(12,4),
  market_value_usd numeric(15,2) default 0,
  unrealized_pnl_usd numeric(15,2) default 0,
  unrealized_pnl_pct numeric(10,4) default 0,
  weight_pct numeric(8,4),
  last_updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.sleeve_positions enable row level security;
drop policy if exists "Users manage own sleeve positions" on public.sleeve_positions;
create policy "Users manage own sleeve positions" on public.sleeve_positions for all using (user_id = auth.uid());

-- ─── Household Goals ──────────────────────────────────────
create table if not exists public.household_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade not null,
  name text not null,
  goal_type text default 'general' check (goal_type in ('retirement','education','home','estate','trust','charitable','emergency','other','general')),
  target_amount_usd numeric(15,2) not null,
  current_amount_usd numeric(15,2) default 0,
  target_date date,
  assigned_sleeve_id uuid references public.portfolio_sleeves(id) on delete set null,
  status text default 'active' check (status in ('active','achieved','paused','cancelled')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.household_goals enable row level security;
drop policy if exists "Household owner manages goals" on public.household_goals;
create policy "Household owner manages goals" on public.household_goals for all using (
  household_id in (select id from public.households where owner_user_id = auth.uid())
);

-- ─── Realtime ─────────────────────────────────────────────
alter publication supabase_realtime add table public.sleeve_approval_requests;
alter publication supabase_realtime add table public.marketplace_listings;

-- ─── Phase 4 additions ─────────────────────────────────────────────────────

-- Audit log (append-only, no UPDATE/DELETE allowed via RLS)
CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now() NOT NULL,
  user_id      uuid REFERENCES auth.users(id),
  action       text NOT NULL,
  resource     text NOT NULL,
  resource_id  text,
  metadata     jsonb DEFAULT '{}',
  ip_address   text,
  user_agent   text
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own audit" ON audit_log FOR SELECT USING (auth.uid() = user_id);

-- Tax lots
CREATE TABLE IF NOT EXISTS tax_lots (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    timestamptz DEFAULT now(),
  user_id       uuid REFERENCES auth.users(id) NOT NULL,
  symbol        text NOT NULL,
  quantity      numeric NOT NULL,
  cost_basis    numeric NOT NULL,   -- per-unit
  acquired_date date NOT NULL,
  is_long_term  boolean GENERATED ALWAYS AS (acquired_date <= CURRENT_DATE - INTERVAL '1 year') STORED,
  order_id      uuid REFERENCES orders(id),
  closed_at     timestamptz,
  remaining_qty numeric
);
ALTER TABLE tax_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own lots" ON tax_lots FOR ALL USING (auth.uid() = user_id);

-- Options positions
CREATE TABLE IF NOT EXISTS option_positions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  user_id           uuid REFERENCES auth.users(id) NOT NULL,
  symbol            text NOT NULL,
  option_type       text CHECK (option_type IN ('call','put')) NOT NULL,
  strategy          text NOT NULL,
  strike            numeric NOT NULL,
  expiration        date NOT NULL,
  contracts         integer NOT NULL DEFAULT 1,
  premium_paid      numeric NOT NULL,
  current_price     numeric,
  underlying_price  numeric,
  is_short          boolean DEFAULT false,
  opened_at         timestamptz DEFAULT now(),
  closed_at         timestamptz,
  broker_order_id   text
);
ALTER TABLE option_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own options" ON option_positions FOR ALL USING (auth.uid() = user_id);

-- Price alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  user_id      uuid REFERENCES auth.users(id) NOT NULL,
  symbol       text NOT NULL,
  condition    text CHECK (condition IN ('above','below','pct_change')) NOT NULL,
  target_price numeric NOT NULL,
  triggered_at timestamptz,
  is_active    boolean DEFAULT true,
  notify_email boolean DEFAULT true
);
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own alerts" ON price_alerts FOR ALL USING (auth.uid() = user_id);

-- ─── Learning Loop ────────────────────────────────────────────────────────────

-- Every prediction/signal logged at decision time
CREATE TABLE IF NOT EXISTS decision_log (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at          timestamptz DEFAULT now(),
  user_id             uuid REFERENCES auth.users(id) NOT NULL,
  strategy            text NOT NULL,
  symbol              text NOT NULL,
  confidence          numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  predicted_direction smallint NOT NULL CHECK (predicted_direction IN (0, 1)),
  predicted_return    numeric,
  signal_weights      jsonb,
  horizon_days        integer NOT NULL DEFAULT 7,
  resolution_due_at   timestamptz NOT NULL,
  outcome_graded      boolean NOT NULL DEFAULT false,
  metadata            jsonb
);
ALTER TABLE decision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own decisions" ON decision_log FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS decision_log_user_ungraded_idx ON decision_log(user_id, outcome_graded, resolution_due_at);

-- Graded outcome linked to a decision
CREATE TABLE IF NOT EXISTS outcome_log (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  resolved_at         timestamptz DEFAULT now(),
  decision_id         uuid REFERENCES decision_log(id) ON DELETE CASCADE NOT NULL,
  user_id             uuid REFERENCES auth.users(id) NOT NULL,
  actual_direction    smallint NOT NULL CHECK (actual_direction IN (0, 1)),
  actual_return       numeric NOT NULL,
  alpha_vs_benchmark  numeric NOT NULL,
  brier_score         numeric NOT NULL,
  metadata            jsonb
);
ALTER TABLE outcome_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own outcomes" ON outcome_log FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS outcome_log_user_idx ON outcome_log(user_id, resolved_at DESC);

-- Active strategy weights (one row per user — upserted by the learning loop)
CREATE TABLE IF NOT EXISTS strategy_weights (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) NOT NULL UNIQUE,
  weights    jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE strategy_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own weights" ON strategy_weights FOR ALL USING (auth.uid() = user_id);

-- ─── Kronos Forecasts Cache ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kronos_forecasts (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       timestamptz DEFAULT now(),
  symbol           text NOT NULL,
  horizon          integer NOT NULL DEFAULT 5,
  predicted_closes numeric[] NOT NULL DEFAULT '{}',
  expected_return  numeric NOT NULL,
  direction        smallint NOT NULL CHECK (direction IN (-1, 0, 1)),
  confidence       numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source           text NOT NULL DEFAULT 'kronos-api',
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '1 day'
);
CREATE INDEX IF NOT EXISTS kronos_forecasts_symbol_idx ON kronos_forecasts(symbol, created_at DESC);
-- No RLS — this is a public forecast cache, no user data

-- ─── AI Feature Flags & Cost Tracking ─────────────────────────────────────────

-- Global catalog of available AI/premium features (admin-managed, read-only for users)
CREATE TABLE IF NOT EXISTS ai_feature_definitions (
  feature_key         text PRIMARY KEY,
  display_name        text NOT NULL,
  description         text NOT NULL,
  category            text NOT NULL CHECK (category IN ('ai_confluence', 'premium_data')),
  cost_per_use_usd    numeric(10,6) NOT NULL DEFAULT 0,
  cost_unit           text NOT NULL DEFAULT 'call',  -- 'call' | 'token' | 'day'
  default_budget_usd  numeric(10,2) NOT NULL DEFAULT 20.00,
  is_available        boolean NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now()
);
-- Public read so client can render feature catalog
CREATE POLICY "anyone can read feature definitions" ON ai_feature_definitions FOR SELECT USING (true);
ALTER TABLE ai_feature_definitions ENABLE ROW LEVEL SECURITY;

-- Per-user opt-in toggles and monthly budget caps
CREATE TABLE IF NOT EXISTS ai_feature_flags (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feature_key         text REFERENCES ai_feature_definitions(feature_key) ON DELETE CASCADE NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  monthly_budget_usd  numeric(10,2) NOT NULL DEFAULT 20.00,
  alert_threshold_pct numeric(5,2) NOT NULL DEFAULT 80.00,  -- alert at this % of budget
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, feature_key)
);
ALTER TABLE ai_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own feature flags" ON ai_feature_flags FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ai_feature_flags_user_idx ON ai_feature_flags(user_id, feature_key);

-- Per-call cost log for audit trail and spend calculations
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feature_key     text REFERENCES ai_feature_definitions(feature_key) NOT NULL,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  tokens_used     integer,
  strategy        text,
  symbol          text,
  metadata        jsonb
);
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own usage logs" ON ai_usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "service role insert usage logs" ON ai_usage_logs FOR INSERT WITH CHECK (true);
CREATE INDEX IF NOT EXISTS ai_usage_logs_user_month_idx ON ai_usage_logs(user_id, feature_key, created_at DESC);

-- Monthly spend rollup per user + feature (used by canSpend checks)
CREATE OR REPLACE FUNCTION get_monthly_spend(p_user_id uuid, p_feature_key text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)
  FROM ai_usage_logs
  WHERE user_id    = p_user_id
    AND feature_key = p_feature_key
    AND created_at >= date_trunc('month', now());
$$;

-- Convenience view: current month spend per feature for the calling user
CREATE OR REPLACE VIEW ai_monthly_spend AS
SELECT
  user_id,
  feature_key,
  date_trunc('month', created_at) AS month,
  SUM(cost_usd)                   AS total_usd,
  COUNT(*)                        AS call_count
FROM ai_usage_logs
GROUP BY user_id, feature_key, date_trunc('month', created_at);

-- RLS on view not supported directly; rely on underlying table policies

-- ─── AI Feature Seed Data ─────────────────────────────────────────────────────

INSERT INTO ai_feature_definitions (feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd) VALUES
  ('mirofish',        'MiroFish AI',              'Claude-powered trade simulation and edge scoring for each strategy signal', 'ai_confluence',  0.012000, 'call', 20.00),
  ('kronos',          'Kronos Forecaster',         'Self-hosted time-series ML model on Hetzner for directional forecasts',   'ai_confluence',  0.001000, 'call', 10.00),
  ('premium_prompt',  'Premium Prompt Model',      'Upgrades CIO decision calls from Claude Haiku to Claude Opus for higher-stakes trades', 'ai_confluence', 0.015000, 'call', 30.00),
  ('glassnode',       'Glassnode On-Chain',        'Bitcoin and Ethereum on-chain metrics: NUPL, SOPR, exchange flows',       'premium_data',   0.033300, 'day',  10.00),
  ('nansen',          'Nansen Smart Money',        'Tracks wallet clusters labeled as smart money for inflow/outflow signals', 'premium_data',  0.066600, 'day',  20.00),
  ('unusual_whales',  'Unusual Whales Flow',       'Real-time options dark pool and congressional trade flow data',            'premium_data',   0.033300, 'day',  10.00),
  ('quiver',          'Quiver Quant',              'Congressional trades, government contracts, and lobbying signal feeds',    'premium_data',   0.016600, 'day',  5.00),
  ('polygon',         'Polygon.io Premium',        'Sub-second tick data, full options chain, and Level 2 order book',        'premium_data',   0.083300, 'day',  25.00)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  description        = EXCLUDED.description,
  category           = EXCLUDED.category,
  cost_per_use_usd   = EXCLUDED.cost_per_use_usd,
  cost_unit          = EXCLUDED.cost_unit,
  default_budget_usd = EXCLUDED.default_budget_usd;

-- ─── Strategy Paper Trades (Tier gate tracking) ───────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_paper_trades (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now(),
  strategy_id     text NOT NULL,
  symbol          text NOT NULL,
  side            text NOT NULL CHECK (side IN ('buy', 'sell')),
  entry_price     numeric NOT NULL,
  exit_price      numeric,
  size_usd        numeric NOT NULL DEFAULT 1000,
  entry_time      timestamptz NOT NULL DEFAULT now(),
  exit_time       timestamptz,
  pnl_usd         numeric,
  pnl_pct         numeric,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  signal_strength numeric NOT NULL DEFAULT 0,
  signal_score    numeric,
  metadata        jsonb
);
CREATE INDEX IF NOT EXISTS spt_strategy_status_idx ON strategy_paper_trades(strategy_id, status, exit_time DESC);
CREATE INDEX IF NOT EXISTS spt_entry_time_idx ON strategy_paper_trades(strategy_id, entry_time DESC);
-- No RLS — paper trades are system-level, not per-user
