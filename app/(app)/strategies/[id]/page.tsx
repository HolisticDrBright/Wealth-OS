import { notFound } from 'next/navigation'
import { getStrategies, getStrategyPositions, computeStrategyMetrics } from '@/lib/actions/strategies'
import { StrategyDetailClient } from './strategy-detail-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function StrategyDetailPage({ params }: Props) {
  const { id } = await params
  const [strategies, positions, metrics] = await Promise.all([
    getStrategies(),
    getStrategyPositions(id),
    computeStrategyMetrics(id),
  ])

  const strategy = strategies.find(s => s.id === id)
  if (!strategy) notFound()

  return <StrategyDetailClient strategy={strategy} positions={positions} metrics={metrics} />
}
