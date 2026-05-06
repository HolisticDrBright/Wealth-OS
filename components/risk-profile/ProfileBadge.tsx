import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { RiskMeter } from './RiskMeter'
import type { ProfileKey } from '@/lib/strategies/profile-params'

const PROFILE_LABELS: Record<ProfileKey, string> = {
  vault:        'Vault',
  conservative: 'Conservative',
  balanced:     'Balanced',
  growth:       'Growth',
  speculative:  'Speculative',
}

interface Props {
  profile: ProfileKey
}

export function ProfileBadge({ profile }: Props) {
  return (
    <Link
      href="/settings/risk-profile"
      className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-1.5 hover:border-gray-500 transition-colors"
    >
      <RiskMeter profile={profile} size="sm" />
      <span className="text-xs text-gray-300 font-medium">{PROFILE_LABELS[profile]}</span>
      <Pencil className="w-3 h-3 text-gray-500" />
    </Link>
  )
}
