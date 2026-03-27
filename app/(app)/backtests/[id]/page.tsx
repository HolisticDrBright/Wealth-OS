import { notFound } from 'next/navigation'
import { getBacktestJob, getBacktestResult } from '@/lib/actions/backtests'
import { BacktestDetailClient } from './backtest-detail-client'

interface Props { params: Promise<{ id: string }> }

export default async function BacktestDetailPage({ params }: Props) {
  const { id } = await params
  const [job, result] = await Promise.all([
    getBacktestJob(id),
    getBacktestResult(id),
  ])
  if (!job) notFound()
  return <BacktestDetailClient job={job} result={result} />
}
