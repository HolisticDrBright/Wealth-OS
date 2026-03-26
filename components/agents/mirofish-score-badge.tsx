'use client'

interface Props {
  score: number
  confidence?: 'high' | 'medium' | 'low'
  size?: 'sm' | 'md' | 'lg'
}

function getColor(score: number): string {
  if (score >= 75) return '#10b981'
  if (score >= 60) return '#6366f1'
  if (score >= 45) return '#f59e0b'
  return '#ef4444'
}

function getLabel(score: number): string {
  if (score >= 75) return 'Strong Buy'
  if (score >= 60) return 'Buy'
  if (score >= 45) return 'Neutral'
  if (score >= 30) return 'Caution'
  return 'Avoid'
}

export function MiroFishScoreBadge({ score, confidence, size = 'md' }: Props) {
  const color = getColor(score)
  const label = getLabel(score)
  const dims = { sm: 64, md: 80, lg: 100 }[size]
  const stroke = { sm: 5, md: 6, lg: 8 }[size]
  const fontSize = { sm: 14, md: 18, lg: 22 }[size]
  const labelSize = { sm: 7, md: 8, lg: 10 }[size]

  const r = (dims / 2) - stroke
  const circumference = 2 * Math.PI * r
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-1">
      <div style={{ position: 'relative', width: dims, height: dims }}>
        <svg width={dims} height={dims} viewBox={`0 0 ${dims} ${dims}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={dims / 2} cy={dims / 2} r={r}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke}
          />
          <circle
            cx={dims / 2} cy={dims / 2} r={r}
            fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize, fontWeight: 700, color, lineHeight: 1 }}>{Math.round(score)}</span>
          <span style={{ fontSize: labelSize, color: '#6b7280', lineHeight: 1.2 }}>/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p style={{ fontSize: labelSize + 2, fontWeight: 600, color }} className="leading-none">{label}</p>
        {confidence && (
          <p style={{ fontSize: labelSize }} className="text-gray-500 mt-0.5">
            {confidence} confidence
          </p>
        )}
      </div>
    </div>
  )
}
