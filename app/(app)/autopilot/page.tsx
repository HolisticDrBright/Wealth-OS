import { Topbar } from '@/components/layout/topbar'
import { AutopilotClient } from './autopilot-client'
import { getFollowedTraders, getCopiedPositions } from '@/lib/actions/traders'

export default async function AutopilotPage() {
  const [followedTraders, positions] = await Promise.all([
    getFollowedTraders(),
    getCopiedPositions(),
  ])

  return (
    <div>
      <Topbar title="Autopilot" subtitle="Copy trading — set it and let it run" />
      <AutopilotClient followedTraders={followedTraders} positions={positions} />
    </div>
  )
}
