import { BacktestsClient } from './backtests-client'
import { getBacktestJobs } from '@/lib/actions/backtests'

export default async function BacktestsPage() {
  const jobs = await getBacktestJobs()
  return <BacktestsClient initialJobs={jobs} />
}
