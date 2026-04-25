import { Topbar } from '@/components/layout/topbar'
import { SettingsClient } from './settings-client'
import { getUserSettings, getBrokerStatus, getAIFeatureData } from '@/lib/actions/settings'

export default async function SettingsPage() {
  const [settings, brokerStatus, aiData] = await Promise.all([
    getUserSettings(),
    getBrokerStatus(),
    getAIFeatureData(),
  ])

  return (
    <div>
      <Topbar title="Settings" subtitle="Brokers, risk profile, and preferences" />
      <SettingsClient settings={settings} brokerStatus={brokerStatus} aiData={aiData} />
    </div>
  )
}
