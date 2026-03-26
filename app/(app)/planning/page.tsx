import { Topbar } from '@/components/layout/topbar'
import { PlanningClient } from './planning-client'
import { getGoals } from '@/lib/actions/goals'
import { mockGoals } from '@/lib/mock-data'

export default async function PlanningPage() {
  const goalsData = await getGoals()
  const goals = goalsData.length > 0 ? goalsData : mockGoals
  const isDemo = goalsData.length === 0

  return (
    <div>
      <Topbar title="Wealth Planning" subtitle="Goals, projections, and milestones" />
      <PlanningClient goals={goals} isDemo={isDemo} />
    </div>
  )
}
