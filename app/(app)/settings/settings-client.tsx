'use client'

import { useState, useTransition, useOptimistic } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { updateUserSettings, updateAIFeatureFlag } from '@/lib/actions/settings'
import type { AIFeatureDefinition, AIFeatureFlag, AIUsageSummary } from '@/lib/actions/settings'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  CheckCircle2, XCircle, User, Zap, Brain,
  TrendingUp, Bell, ExternalLink, AlertCircle, Sparkles, Database,
} from 'lucide-react'

interface BrokerStatus {
  alpaca: boolean
  kraken: boolean
  oanda: boolean
  polymarket: boolean
  anthropic: boolean
  unusualWhales: boolean
  quiverQuant: boolean
  nansen: boolean
  mirofish: boolean
  coinStats: boolean
}

interface Settings {
  id: string
  risk_profile: string
  copy_trading_budget_usd: number
  autopilot_enabled: boolean
  notifications_enabled: boolean
  display_name: string
}

interface AIData {
  definitions: AIFeatureDefinition[]
  flags: AIFeatureFlag[]
  usage: AIUsageSummary[]
}

interface Props {
  settings: Settings | null
  brokerStatus: BrokerStatus
  aiData: AIData
}

// ─── AI Features Section ──────────────────────────────────────────────────────

interface AIFeaturesSectionProps {
  title: string
  description: string
  icon: React.ReactNode
  category: 'ai_confluence' | 'premium_data'
  definitions: AIFeatureDefinition[]
  flags: Map<string, AIFeatureFlag>
  usage: AIUsageSummary[]
  onToggle: (key: string, current: boolean) => void
  onBudgetChange: (key: string, budget: number) => void
}

function AIFeaturesSection({ title, description, icon, category, definitions, flags, usage, onToggle, onBudgetChange }: AIFeaturesSectionProps) {
  const features = definitions.filter(d => d.category === category)
  const usageMap = new Map(usage.map(u => [u.feature_key, u]))
  const totalSpend = features.reduce((sum, f) => sum + (usageMap.get(f.feature_key)?.spend_usd ?? 0), 0)
  const anyEnabled = features.some(f => flags.get(f.feature_key)?.enabled)

  const chartData = features
    .map(f => ({
      name: f.display_name.split(' ')[0],
      spend: Number((usageMap.get(f.feature_key)?.spend_usd ?? 0).toFixed(2)),
      budget: flags.get(f.feature_key)?.monthly_budget_usd ?? f.default_budget_usd,
    }))
    .filter(d => d.spend > 0 || d.budget > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!anyEnabled && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400">
            Wealth OS works fully without paid AI features.
          </div>
        )}

        {features.map(def => {
          const flag = flags.get(def.feature_key)
          const enabled = flag?.enabled ?? false
          const monthlyBudget = flag?.monthly_budget_usd ?? def.default_budget_usd
          const spent = usageMap.get(def.feature_key)?.spend_usd ?? 0
          const pct = monthlyBudget > 0 ? Math.min(100, (spent / monthlyBudget) * 100) : 0

          return (
            <div
              key={def.feature_key}
              className={`rounded-xl border p-4 transition-colors ${
                enabled ? 'border-violet-500/20 bg-violet-500/5' : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{def.display_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{def.description}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    ~${def.cost_per_use_usd.toFixed(4)} / {def.cost_unit}
                  </p>

                  {enabled && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>This month: ${spent.toFixed(2)}</span>
                        <span>Budget: ${monthlyBudget.toFixed(0)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/10">
                        <div
                          className={`h-1.5 rounded-full transition-all ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-violet-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={200}
                        step={1}
                        value={monthlyBudget}
                        onChange={e => onBudgetChange(def.feature_key, Number(e.target.value))}
                        className="w-full accent-violet-500"
                        aria-label={`Monthly budget for ${def.display_name}`}
                      />
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onToggle(def.feature_key, enabled)}
                  className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    enabled ? 'bg-violet-600' : 'bg-white/10'
                  }`}
                  aria-pressed={enabled}
                  aria-label={`Toggle ${def.display_name}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          )
        })}

        {anyEnabled && chartData.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">
              Monthly spend — total ${totalSpend.toFixed(2)}
            </p>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#1a1b23', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value, name) => [`$${Number(value).toFixed(2)}`, name === 'spend' ? 'Spent' : 'Budget']}
                />
                <Bar dataKey="budget" fill="rgba(139,92,246,0.15)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spend" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.spend / entry.budget >= 0.9 ? '#ef4444' : entry.spend / entry.budget >= 0.7 ? '#f59e0b' : '#8b5cf6'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-medium text-gray-500">
      <XCircle className="h-3.5 w-3.5" /> Not configured
    </span>
  )
}

const BROKER_DOCS: Record<string, { name: string; envVars: string[]; url: string; icon: React.ComponentType<{ className?: string }>; description: string }> = {
  alpaca: {
    name: 'Alpaca (Stocks)',
    envVars: ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY'],
    url: 'https://alpaca.markets',
    icon: TrendingUp,
    description: 'US stock & ETF trading. Paper trading enabled by default.',
  },
  kraken: {
    name: 'Kraken (Crypto)',
    envVars: ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET'],
    url: 'https://kraken.com',
    icon: TrendingUp,
    description: 'Crypto trading via Kraken Pro API with HMAC authentication.',
  },
  oanda: {
    name: 'OANDA (Forex)',
    envVars: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    url: 'https://oanda.com',
    icon: TrendingUp,
    description: 'Forex pair trading via OANDA fxTrade REST API.',
  },
  polymarket: {
    name: 'Polymarket',
    envVars: ['POLYMARKET_PRIVATE_KEY'],
    url: 'https://polymarket.com',
    icon: TrendingUp,
    description: 'Prediction market trading via Polymarket CLOB.',
  },
}

const DATA_DOCS: Record<string, { name: string; envVars: string[]; url: string; description: string }> = {
  anthropic: {
    name: 'Anthropic Claude (AI)',
    envVars: ['ANTHROPIC_API_KEY'],
    url: 'https://console.anthropic.com',
    description: 'Powers all 13 agents, AI Tax Advisor, and MiroFish fallback.',
  },
  unusualWhales: {
    name: 'Unusual Whales',
    envVars: ['UNUSUAL_WHALES_API_KEY'],
    url: 'https://unusualwhales.com',
    description: 'Congressional trades and options flow (~$50/mo).',
  },
  quiverQuant: {
    name: 'Quiver Quant',
    envVars: ['QUIVER_QUANT_API_KEY'],
    url: 'https://quiverquant.com',
    description: 'Congressional trades and government contracts (~$25/mo).',
  },
  nansen: {
    name: 'Nansen (Crypto Smart Money)',
    envVars: ['NANSEN_API_KEY'],
    url: 'https://nansen.ai',
    description: 'On-chain wallet intelligence for crypto traders (~$150/mo).',
  },
  coinStats: {
    name: 'CoinStats',
    envVars: ['COINSTATS_API_KEY'],
    url: 'https://coinstats.app',
    description: 'Real-time crypto prices and portfolio tracking.',
  },
  mirofish: {
    name: 'MiroFish (Simulation)',
    envVars: ['MIROFISH_BASE_URL'],
    url: 'https://github.com/666ghj/MiroFish',
    description: 'Swarm intelligence simulation engine for Agent 13.',
  },
}

export function SettingsClient({ settings, brokerStatus, aiData }: Props) {
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const [displayName, setDisplayName] = useState(settings?.display_name ?? '')
  const [riskProfile, setRiskProfile] = useState(settings?.risk_profile ?? 'moderate')
  const [budget, setBudget] = useState(String(settings?.copy_trading_budget_usd ?? 1000))
  const [autopilot, setAutopilot] = useState(settings?.autopilot_enabled ?? false)
  const [notifications, setNotifications] = useState(settings?.notifications_enabled ?? true)

  // AI flags — optimistic so toggles feel instant
  const flagMap = new Map(aiData.flags.map(f => [f.feature_key, f]))
  const [optimisticFlags, setOptimisticFlag] = useOptimistic(
    flagMap,
    (state, { key, value }: { key: string; value: Partial<AIFeatureFlag> }) => {
      const next = new Map(state)
      const existing = next.get(key)
      next.set(key, { feature_key: key, enabled: false, monthly_budget_usd: 20, alert_threshold_pct: 80, ...existing, ...value })
      return next
    }
  )

  function toggleFeature(featureKey: string, currentEnabled: boolean) {
    startTransition(async () => {
      setOptimisticFlag({ key: featureKey, value: { enabled: !currentEnabled } })
      await updateAIFeatureFlag(featureKey, { enabled: !currentEnabled })
    })
  }

  function updateBudget(featureKey: string, budgetUsd: number) {
    startTransition(async () => {
      setOptimisticFlag({ key: featureKey, value: { monthly_budget_usd: budgetUsd } })
      await updateAIFeatureFlag(featureKey, { monthly_budget_usd: budgetUsd })
    })
  }

  function handleSave() {
    startTransition(async () => {
      await updateUserSettings({
        display_name: displayName,
        risk_profile: riskProfile,
        copy_trading_budget_usd: Number(budget),
        autopilot_enabled: autopilot,
        notifications_enabled: notifications,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  const brokerEntries = Object.entries(BROKER_DOCS)
  const dataEntries = Object.entries(DATA_DOCS)
  const connectedBrokers = brokerEntries.filter(([k]) => brokerStatus[k as keyof BrokerStatus]).length
  const connectedData = dataEntries.filter(([k]) => brokerStatus[k as keyof BrokerStatus]).length

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-indigo-400" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            label="Display name"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
        </CardContent>
      </Card>

      {/* Copy Trading Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" /> Autopilot Settings
          </CardTitle>
          <CardDescription>Controls how copy trading executes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
            <div>
              <p className="text-sm font-medium text-white">Autopilot Master Switch</p>
              <p className="text-xs text-gray-500 mt-0.5">Globally enable or disable all auto-copy execution</p>
            </div>
            <button
              onClick={() => setAutopilot(a => !a)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autopilot ? 'bg-amber-500' : 'bg-white/10'
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                autopilot ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Total copy trading budget ($)"
              type="number"
              min="100"
              step="100"
              value={budget}
              onChange={e => setBudget(e.target.value)}
            />
            <Select
              label="Default risk profile"
              value={riskProfile}
              onChange={e => setRiskProfile(e.target.value)}
              options={[
                { value: 'conservative', label: 'Conservative — smaller positions, vetoes more' },
                { value: 'moderate', label: 'Moderate — balanced approach' },
                { value: 'aggressive', label: 'Aggressive — larger positions, fewer vetoes' },
              ]}
            />
          </div>

          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
            <p className="text-xs text-gray-400">
              <strong className="text-indigo-400">How the budget works:</strong> When you follow a trader and set
              "5% max per trade", that percentage is applied to your total budget (${Number(budget).toLocaleString()}).
              So each copied trade will be max ${(Number(budget) * 0.05).toLocaleString()} — proportional to the
              trader's original position size.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Broker Connections */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" /> Broker Connections
          </CardTitle>
          <CardDescription>
            {connectedBrokers}/{brokerEntries.length} connected — add API keys to .env.local and Vercel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {brokerEntries.map(([key, doc]) => {
              const connected = brokerStatus[key as keyof BrokerStatus]
              const Icon = doc.icon
              return (
                <div key={key} className={`rounded-xl border p-4 transition-colors ${
                  connected ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/10 bg-white/5'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{doc.name}</p>
                        <ConnectionBadge connected={connected} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{doc.description}</p>
                      {!connected && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {doc.envVars.map(v => (
                            <code key={v} className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-gray-300">{v}</code>
                          ))}
                        </div>
                      )}
                    </div>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                    >
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" /> AI & Data Sources
          </CardTitle>
          <CardDescription>
            {connectedData}/{dataEntries.length} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {dataEntries.map(([key, doc]) => {
              const connected = brokerStatus[key as keyof BrokerStatus]
              return (
                <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white">{doc.name}</p>
                      <ConnectionBadge connected={connected} />
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">{doc.description}</p>
                  </div>
                  {!connected && (
                    <code className="shrink-0 ml-3 text-xs text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                      {doc.envVars[0]}
                    </code>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* AI Confluence Layer */}
      <AIFeaturesSection
        title="AI Confluence Layer"
        description="Optional AI layers that add signal quality. All off by default — Wealth OS works fully without them."
        icon={<Sparkles className="h-4 w-4 text-violet-400" />}
        category="ai_confluence"
        definitions={aiData.definitions}
        flags={optimisticFlags}
        usage={aiData.usage}
        onToggle={toggleFeature}
        onBudgetChange={updateBudget}
      />

      {/* Premium Data Feeds */}
      <AIFeaturesSection
        title="Premium Data Feeds"
        description="Paid data subscriptions. Enable only what matches your strategy. Wealth OS works fully without paid AI features."
        icon={<Database className="h-4 w-4 text-amber-400" />}
        category="premium_data"
        definitions={aiData.definitions}
        flags={optimisticFlags}
        usage={aiData.usage}
        onToggle={toggleFeature}
        onBudgetChange={updateBudget}
      />

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-indigo-400" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
            <div>
              <p className="text-sm font-medium text-white">Copy trade alerts</p>
              <p className="text-xs text-gray-500 mt-0.5">Get notified when a copy trade executes or is vetoed</p>
            </div>
            <button
              onClick={() => setNotifications(n => !n)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                notifications ? 'bg-indigo-600' : 'bg-white/10'
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                notifications ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving...' : saved ? '✓ Saved' : 'Save Settings'}
        </Button>
        {saved && <span className="text-xs text-emerald-400">All settings saved</span>}
      </div>

      {/* Danger Zone */}
      <Card className="border-red-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-400">
            <AlertCircle className="h-4 w-4" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400 mb-4">Permanently delete your account and all data. Cannot be undone.</p>
          <Button variant="danger" size="sm">Delete Account</Button>
        </CardContent>
      </Card>
    </div>
  )
}
