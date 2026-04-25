'use client'

import type { EdgeStrength, EntropyAction } from '@/lib/meta-poly/types'

interface Props {
  entropyBits: number
  edgeStrength?: EdgeStrength
  action?: EntropyAction
  size?: number
}

const EDGE_COLOR: Record<EdgeStrength, string> = {
  strong:   '#10b981',
  moderate: '#f59e0b',
  weak:     '#6366f1',
  none:     '#4b5563',
}

const ACTION_LABEL: Record<EntropyAction, string> = {
  BUY_YES: 'BUY YES',
  BUY_NO:  'BUY NO',
  HOLD:    'HOLD',
}

const ACTION_COLOR: Record<EntropyAction, string> = {
  BUY_YES: '#10b981',
  BUY_NO:  '#ef4444',
  HOLD:    '#6b7280',
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────
// Gauge: semicircle from left (cx-R, cy) to right (cx+R, cy) going CW through top.
// At fraction f (0–1): x = cx - R·cos(f·π), y = cy - R·sin(f·π)

function gaugePoint(cx: number, cy: number, r: number, frac: number) {
  const f = Math.min(Math.max(frac, 0), 1)
  return {
    x: cx - r * Math.cos(f * Math.PI),
    y: cy - r * Math.sin(f * Math.PI),
  }
}

export function EntropyGauge({ entropyBits, edgeStrength = 'none', action, size = 200 }: Props) {
  const MAX_BITS = 1.0
  const frac = Math.min(Math.max(entropyBits / MAX_BITS, 0), 1)

  const CX = 100
  const CY = 100
  const R  = 76
  const SW = 16        // stroke-width of track
  const NEEDLE_R = R - SW / 2 - 2

  const trackStart = { x: CX - R, y: CY }
  const trackEnd   = { x: CX + R, y: CY }
  const valueEnd   = gaugePoint(CX, CY, R, frac)
  const needleTip  = gaugePoint(CX, CY, NEEDLE_R, frac)

  const arcPath = (fx: number, fy: number, tx: number, ty: number, large: 0 | 1) =>
    `M ${fx} ${fy} A ${R} ${R} 0 ${large} 1 ${tx} ${ty}`

  // large-arc-flag: frac covers at most 180°, always 0 — but we need 1 when frac>=1
  const valueLargeArc: 0 | 1 = frac >= 1 ? 1 : 0
  const color = EDGE_COLOR[edgeStrength]

  // Colored background sectors (zones along track)
  const zones: Array<{ from: number; to: number; color: string }> = [
    { from: 0,    to: 0.25, color: '#374151' },
    { from: 0.25, to: 0.5,  color: '#312e81' },
    { from: 0.5,  to: 0.75, color: '#78350f' },
    { from: 0.75, to: 1.0,  color: '#064e3b' },
  ]

  return (
    <svg
      viewBox="0 0 200 115"
      width={size}
      height={size * 0.575}
      aria-label={`Entropy gauge: ${entropyBits.toFixed(3)} bits`}
    >
      {/* Zone tracks */}
      {zones.map(({ from, to, color: zc }, i) => {
        if (from >= 1) return null
        const s = gaugePoint(CX, CY, R, from)
        const e = gaugePoint(CX, CY, R, Math.min(to, 1))
        const span = (to - from) * 180
        const la: 0 | 1 = span > 180 ? 1 : 0
        return (
          <path
            key={i}
            d={`M ${s.x} ${s.y} A ${R} ${R} 0 ${la} 1 ${e.x} ${e.y}`}
            fill="none"
            stroke={zc}
            strokeWidth={SW}
            strokeLinecap="butt"
            opacity={0.35}
          />
        )
      })}

      {/* Track outline */}
      <path
        d={arcPath(trackStart.x, trackStart.y, trackEnd.x, trackEnd.y, 1)}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={SW + 4}
        strokeLinecap="round"
      />

      {/* Value fill */}
      {frac > 0.005 && (
        <path
          d={arcPath(trackStart.x, trackStart.y, valueEnd.x, valueEnd.y, valueLargeArc)}
          fill="none"
          stroke={color}
          strokeWidth={SW}
          strokeLinecap="round"
        />
      )}

      {/* Needle */}
      <line
        x1={CX}
        y1={CY}
        x2={needleTip.x}
        y2={needleTip.y}
        stroke="white"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r={5} fill="white" />

      {/* Value text */}
      <text
        x={CX}
        y={76}
        textAnchor="middle"
        fill="white"
        fontSize={22}
        fontWeight="bold"
        fontFamily="monospace"
      >
        {entropyBits.toFixed(3)}
      </text>
      <text x={CX} y={90} textAnchor="middle" fill="#6b7280" fontSize={10}>
        bits
      </text>

      {/* Action label */}
      {action && action !== 'HOLD' && (
        <text
          x={CX}
          y={112}
          textAnchor="middle"
          fill={ACTION_COLOR[action]}
          fontSize={11}
          fontWeight="600"
        >
          {ACTION_LABEL[action]}
        </text>
      )}
    </svg>
  )
}
