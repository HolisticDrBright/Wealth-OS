import type { ProfileKey } from '@/lib/strategies/profile-params'

const PROFILE_DOT_COUNT: Record<ProfileKey, number> = {
  vault:        1,
  conservative: 2,
  balanced:     3,
  growth:       4,
  speculative:  5,
}

const DOT_COLORS: Record<number, string> = {
  1: 'bg-blue-400',
  2: 'bg-teal-400',
  3: 'bg-gray-300',
  4: 'bg-orange-400',
  5: 'bg-red-400',
}

interface Props {
  profile: ProfileKey
  size?: 'sm' | 'md'
}

export function RiskMeter({ profile, size = 'md' }: Props) {
  const active = PROFILE_DOT_COUNT[profile]
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'

  return (
    <div className="flex items-center gap-1" title={`Risk level: ${active}/5`} aria-label={`Risk level ${active} of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <div
          key={n}
          className={`${dotSize} rounded-full transition-colors ${
            n <= active ? DOT_COLORS[active] : 'bg-gray-700'
          }`}
        />
      ))}
    </div>
  )
}
