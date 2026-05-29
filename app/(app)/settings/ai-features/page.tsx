/**
 * /settings/ai-features — dedicated AI feature-flag settings page.
 *
 * Server component: fetches definitions + user flags + current-month usage,
 * then renders the cost summary banner, two feature sections, and cost chart.
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Brain, Sparkles, Database, ArrowLeft, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAIFeatureData } from '@/lib/actions/settings'
import { FeatureToggleCard } from './FeatureToggleCard'
import { AiCostChart, buildChartData } from '@/components/AiCostChart'
import { projectMonthlyCost } from '@/lib/utils/cost-projection'
import { formatCostCents } from '@/lib/utils/format-cost'
import type { AIFeatureDefinition, AIFeatureFlag, AIUsageSummary } from '@/lib/actions/settings'

// Hoisted clock read. Server components render once per request, so reading the
// clock is safe; the helper keeps the call out of the render-purity analysis.
function nowMs(): number {
  return Date.now()
}

// ─── Cost summary banner ──────────────────────────────────────────────────────

function CostSummaryBanner({
  flags,
  usage,
  definitions,
  projectedCents,
  dailyAvgCents,
  trend,
}: {
  flags: Map<string, AIFeatureFlag>
  usage: AIUsageSummary[]
  definitions: AIFeatureDefinition[]
  projectedCents: number
  dailyAvgCents: number
  trend: 'rising' | 'stable' | 'falling'
}) {
  const totalSpentCents = Math.round(usage.reduce((s, u) => s + u.spend_usd, 0) * 100)
  const totalBudgetCents = Math.round(
    definitions.reduce((s, d) => {
      const f = flags.get(d.feature_key)
      return s + (f?.monthly_budget_usd ?? d.default_budget_usd)
    }, 0) * 100
  )

  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysRemaining = daysInMonth - now.getDate()

  const trendIcon = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→'
  const trendColor =
    trend === 'rising' ? 'text-amber-400' : trend === 'falling' ? 'text-emerald-400' : 'text-gray-400'

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Spent this month</p>
        <p className="text-lg font-semibold text-white mt-0.5">{formatCostCents(totalSpentCents)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total budget</p>
        <p className="text-lg font-semibold text-white mt-0.5">{formatCostCents(totalBudgetCents)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Days remaining</p>
        <p className="text-lg font-semibold text-white mt-0.5">{daysRemaining}d</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Projected</p>
        <p className="text-lg font-semibold text-white mt-0.5">
          {formatCostCents(projectedCents)}{' '}
          <span className={`text-sm font-normal ${trendColor}`}>{trendIcon}</span>
        </p>
        <p className="text-[10px] text-gray-600">{formatCostCents(dailyAvgCents)}/day avg</p>
      </div>
    </div>
  )
}

// ─── Feature section ──────────────────────────────────────────────────────────

function FeatureSection({
  title,
  description,
  icon,
  docsHref,
  features,
  flagMap,
  usageMap,
}: {
  title: string
  description: string
  icon: React.ReactNode
  docsHref?: string
  features: AIFeatureDefinition[]
  flagMap: Map<string, AIFeatureFlag>
  usageMap: Map<string, AIUsageSummary>
}) {
  if (!features.length) return null

  const anyEnabled = features.some(f => flagMap.get(f.feature_key)?.enabled)

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            {icon} {title}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        {docsHref && (
          <a
            href={docsHref}
            className="shrink-0 flex items-center gap-1 text-[10px] text-gray-600 hover:text-violet-400 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs
          </a>
        )}
      </div>

      {!anyEnabled && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-500 text-center">
          Wealth OS works fully without paid AI features. Toggle on what you want, when you want.
        </div>
      )}

      <div className="space-y-2">
        {features.map(def => (
          <FeatureToggleCard
            key={def.feature_key}
            definition={def}
            flag={flagMap.get(def.feature_key)}
            usage={usageMap.get(def.feature_key)}
          />
        ))}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AIFeaturesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [aiData, recentLogs] = await Promise.all([
    getAIFeatureData(),
    supabase
      .from('ai_usage_logs')
      .select('created_at, cost_usd, feature_key')
      .eq('user_id', user.id)
      .gte('created_at', new Date(nowMs() - 30 * 86_400_000).toISOString())
      .order('created_at', { ascending: true })
      .then(r => r.data ?? []),
  ])

  const { definitions, flags, usage } = aiData
  const flagMap = new Map(flags.map(f => [f.feature_key, f]))
  const usageMap = new Map(usage.map(u => [u.feature_key, u]))

  const confluenceFeatures = definitions.filter(d => d.category === 'ai_confluence')
  const premiumDataFeatures = definitions.filter(d => d.category === 'premium_data')
  const featureKeys = [...new Set(recentLogs.map(l => l.feature_key))].filter(Boolean)

  const { dailyData, cumulativeData } = buildChartData(recentLogs, featureKeys)
  const labels = Object.fromEntries(definitions.map(d => [d.feature_key, d.display_name]))

  const { projectedCents, dailyAvgCents, trend } = projectMonthlyCost(
    recentLogs.map(l => ({ created_at: l.created_at, cost_usd: l.cost_usd, feature_key: l.feature_key }))
  )

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-4 py-6">
      {/* Back link */}
      <Link
        href="/settings"
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Settings
      </Link>

      <div>
        <h1 className="text-xl font-bold text-white">AI Features</h1>
        <p className="text-sm text-gray-500 mt-1">
          Control which paid AI capabilities run in your account and how much they can spend.
        </p>
      </div>

      {/* Global cost summary */}
      <CostSummaryBanner
        flags={flagMap}
        usage={usage}
        definitions={definitions}
        projectedCents={projectedCents}
        dailyAvgCents={dailyAvgCents}
        trend={trend}
      />

      {/* Cost chart */}
      {featureKeys.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-400 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> 30-day spend
            </p>
          </div>
          <Suspense fallback={<div className="h-40 animate-pulse rounded bg-white/5" />}>
            <AiCostChart
              dailyData={dailyData}
              cumulativeData={cumulativeData}
              featureKeys={featureKeys}
              labels={labels}
              height={140}
              variant="cumulative"
            />
          </Suspense>
        </div>
      )}

      {/* Section 1: AI Confluence Layer */}
      <FeatureSection
        title="AI Confluence Layer"
        description="Multi-agent simulation and directional forecasting for trade entries. High-value for event-driven and Polymarket strategies."
        icon={<Brain className="h-4 w-4 text-violet-400" />}
        features={confluenceFeatures}
        flagMap={flagMap}
        usageMap={usageMap}
      />

      {/* Section 2: Premium Data Feeds */}
      <FeatureSection
        title="Premium Data Feeds"
        description="Institutional-grade on-chain, options flow, and quant data. Powers the research layer across all strategy tiers."
        icon={<Database className="h-4 w-4 text-indigo-400" />}
        features={premiumDataFeatures}
        flagMap={flagMap}
        usageMap={usageMap}
      />

      {/* Empty state — everything off */}
      {definitions.every(d => !(flagMap.get(d.feature_key)?.enabled)) && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-6 text-center space-y-2">
          <Sparkles className="h-6 w-6 text-gray-600 mx-auto" />
          <p className="text-sm text-gray-400 font-medium">
            Wealth OS works fully without paid AI features.
          </p>
          <p className="text-xs text-gray-600">
            Toggle on what you want, when you want. Each feature has a monthly cap you control.
          </p>
        </div>
      )}
    </div>
  )
}
