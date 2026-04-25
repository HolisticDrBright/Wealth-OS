/**
 * Monthly cost projection from usage logs.
 * Uses the last N days of logs to compute a daily average and projects
 * to end-of-month. Trend is determined by comparing the first half vs
 * second half of the look-back window.
 */

export interface UsageLog {
  created_at: string   // ISO-8601
  cost_usd: number
  feature_key?: string
}

export interface CostProjection {
  projectedCents: number
  dailyAvgCents: number
  trend: 'rising' | 'stable' | 'falling'
}

/**
 * Project the monthly cost from a list of usage logs.
 *
 * @param usageHistory  Array of usage logs (any date range, any feature)
 * @param asOfDate      Reference date (default: now). Determines days remaining.
 * @returns CostProjection with all values in integer cents.
 */
export function projectMonthlyCost(
  usageHistory: UsageLog[],
  asOfDate: Date = new Date()
): CostProjection {
  if (!usageHistory.length) {
    return { projectedCents: 0, dailyAvgCents: 0, trend: 'stable' }
  }

  // Sum cost by calendar day
  const byDay = new Map<string, number>()
  for (const log of usageHistory) {
    const day = log.created_at.slice(0, 10)   // 'YYYY-MM-DD'
    byDay.set(day, (byDay.get(day) ?? 0) + log.cost_usd)
  }

  const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))
  const totalCents = Math.round(days.reduce((s, [, v]) => s + v, 0) * 100)
  const numDays = days.length
  const dailyAvgCents = numDays > 0 ? Math.round(totalCents / numDays) : 0

  // Days remaining in the current month (inclusive of today)
  const year = asOfDate.getFullYear()
  const month = asOfDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dayOfMonth = asOfDate.getDate()
  const daysRemaining = daysInMonth - dayOfMonth + 1

  // Projected = already spent this month + (remaining days × daily avg)
  const spentThisMonth = Math.round(
    days
      .filter(([d]) => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
      .reduce((s, [, v]) => s + v, 0) * 100
  )
  const projectedCents = spentThisMonth + dailyAvgCents * Math.max(0, daysRemaining - 1)

  // Trend: compare first half vs second half of logs
  const mid = Math.floor(days.length / 2)
  const firstHalf = days.slice(0, mid).reduce((s, [, v]) => s + v, 0)
  const secondHalf = days.slice(mid).reduce((s, [, v]) => s + v, 0)
  const firstAvg = mid > 0 ? firstHalf / mid : 0
  const secondAvg = (days.length - mid) > 0 ? secondHalf / (days.length - mid) : 0

  const changeRatio = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0
  const trend: 'rising' | 'stable' | 'falling' =
    changeRatio > 0.10 ? 'rising' : changeRatio < -0.10 ? 'falling' : 'stable'

  return { projectedCents, dailyAvgCents, trend }
}

/**
 * Aggregate projections across multiple feature keys.
 * Returns a combined projection for the total AI spend.
 */
export function projectTotalCost(
  usageHistory: UsageLog[],
  asOfDate: Date = new Date()
): CostProjection {
  return projectMonthlyCost(usageHistory, asOfDate)
}

/**
 * Project per-feature costs. Returns a Map<featureKey, CostProjection>.
 */
export function projectPerFeatureCost(
  usageHistory: UsageLog[],
  asOfDate: Date = new Date()
): Map<string, CostProjection> {
  const byFeature = new Map<string, UsageLog[]>()
  for (const log of usageHistory) {
    const key = log.feature_key ?? 'unknown'
    if (!byFeature.has(key)) byFeature.set(key, [])
    byFeature.get(key)!.push(log)
  }
  return new Map(
    Array.from(byFeature.entries()).map(([k, logs]) => [k, projectMonthlyCost(logs, asOfDate)])
  )
}
