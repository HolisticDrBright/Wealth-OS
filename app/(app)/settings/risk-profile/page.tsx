import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { getallProfiles } from '@/lib/actions/risk-profile'
import { createClient } from '@/lib/supabase/server'
import { RiskProfileClient } from './risk-profile-client'

async function getStrategyDefinitions() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('strategy_definitions')
    .select('strategy_key, layman_name, plain_english_description, enabled_in_profiles, asset_class, requires_advanced_warning')
    .order('asset_class')
  return data ?? []
}

export default async function RiskProfileSettingsPage() {
  const [profileData, strategyDefs] = await Promise.all([
    getallProfiles(),
    getStrategyDefinitions(),
  ])

  return (
    <div>
      <Topbar title="Risk Profile" subtitle="Global override view — or set your profile from any asset page" />
      <div className="px-6 mb-4 space-y-3">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Settings
        </Link>
        <div className="rounded-xl border border-indigo-800/50 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-300">
          You can also set your risk profile directly from any asset page:{' '}
          <Link href="/stocks" className="underline hover:text-white">Stocks</Link>{' / '}
          <Link href="/crypto" className="underline hover:text-white">Crypto</Link>{' / '}
          <Link href="/forex" className="underline hover:text-white">Forex</Link>{' / '}
          <Link href="/polymarket" className="underline hover:text-white">Polymarket</Link>
        </div>
      </div>
      <RiskProfileClient
        profiles={profileData.profiles}
        userProfile={profileData.userProfile}
        strategyDefs={strategyDefs}
      />
    </div>
  )
}
