import { getRiskControls, getRiskSummary } from '@/lib/actions/risk'
import { getSimulationJobs } from '@/lib/actions/simulations'
import { RiskClient } from './risk-client'

export default async function RiskPage() {
  const [controls, summary, jobs] = await Promise.all([
    getRiskControls(),
    getRiskSummary(),
    getSimulationJobs(),
  ])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Risk Management</h1>
        <p className="text-sm text-gray-500 mt-1">Live exposure, controls, and scenario simulations</p>
      </div>
      <RiskClient
        initialControls={controls}
        summary={summary}
        initialJobs={jobs}
      />
    </div>
  )
}
