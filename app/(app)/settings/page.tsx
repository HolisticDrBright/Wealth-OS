import { Topbar } from '@/components/layout/topbar'
import { SettingsClient } from './settings-client'
import { getUserSettings, getBrokerStatus } from '@/lib/actions/settings'

export default async function SettingsPage() {
  const [settings, brokerStatus] = await Promise.all([
    getUserSettings(),
    getBrokerStatus(),
  ])

  return (
    <div>
      <Topbar title="Settings" subtitle="Brokers, risk profile, and preferences" />
      <SettingsClient settings={settings} brokerStatus={brokerStatus} />
    </div>
  )
}
