/**
 * Simple line chart of total value. Always carries a screen-reader summary
 * (direction + first/last values) — never a silent decoration.
 */

import { View } from 'react-native'
import Svg, { Path, Line } from 'react-native-svg'
import { colors } from '@/src/theme'
import { formatUsd } from '@/src/ui'

export function LineChart({ points, height = 64 }: {
  points: Array<{ date: string; valueUsd: number }>
  height?: number
}) {
  if (points.length < 2) return null
  const width = 350
  const vals = points.map(p => p.valueUsd)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = Math.max(1, max - min)
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width
    const y = height - 6 - ((p.valueUsd - min) / span) * (height - 12)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const first = vals[0]
  const last = vals[vals.length - 1]
  const label = `Chart: your total value has ${last >= first ? 'risen' : 'fallen'} from ${formatUsd(first)} to ${formatUsd(last)}`

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ marginTop: 6 }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Path d={d} stroke={colors.accent} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={colors.stroke} strokeWidth={1} />
      </Svg>
    </View>
  )
}
