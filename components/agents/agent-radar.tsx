'use client'

import type { CIODecision } from '@/lib/agents/types'

interface Agent {
  id: string
  name: string
  score: number
  rec: 'approve' | 'reduce' | 'defer' | 'reject'
}

interface Props {
  agents: Agent[]
  cyan?: string
  muted?: string
  size?: number
}

export function AgentRadar({
  agents,
  cyan = 'oklch(0.78 0.14 210)',
  muted = 'oklch(0.60 0.01 260)',
  size = 280,
}: Props) {
  const pad = 56
  const r = size / 2

  return (
    <svg
      width={size + pad * 2}
      height={size + pad * 2}
      viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
      style={{ display: 'block', margin: '0 auto', overflow: 'visible', maxWidth: '100%' }}
    >
      <g transform={`translate(${size / 2},${size / 2})`} style={{ overflow: 'visible' }}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <circle key={f} r={r * f} fill="none" stroke="rgba(255,255,255,0.07)" strokeDasharray="2 3" />
        ))}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          return <line key={i} x1="0" y1="0" x2={Math.cos(a) * r} y2={Math.sin(a) * r} stroke="rgba(255,255,255,0.04)" />
        })}
        {agents.map((ag, i) => {
          const a = (i / agents.length) * Math.PI * 2 - Math.PI / 2
          const dist = r * (ag.score / 100)
          const x = Math.cos(a) * dist
          const y = Math.sin(a) * dist
          const color =
            ag.rec === 'approve' ? 'oklch(0.80 0.18 150)' :
            ag.rec === 'reduce'  ? 'oklch(0.82 0.16 75)'  :
            ag.rec === 'defer'   ? cyan                   :
                                   'oklch(0.70 0.23 25)'
          const lx = Math.cos(a) * (r + 6)
          const ly = Math.sin(a) * (r + 6)
          return (
            <g key={ag.id}>
              <line x1="0" y1="0" x2={x} y2={y} stroke={color} strokeOpacity="0.25" strokeWidth={1} />
              <circle cx={x} cy={y} r={4} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
              <text
                x={lx}
                y={ly + 3}
                textAnchor={lx > 0 ? 'start' : 'end'}
                style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fill: muted, letterSpacing: 0.6 }}
              >
                {ag.name.toUpperCase()}
              </text>
            </g>
          )
        })}
        <circle r={3} fill={cyan} style={{ filter: `drop-shadow(0 0 8px ${cyan})` }} />
      </g>
    </svg>
  )
}

export function agentsFromDecision(decision: CIODecision): Agent[] {
  return Object.entries(decision.agentScores)
    .filter(([k]) => k !== 'OrchestratorAgent')
    .map(([name, score], i) => {
      const out = decision.agentOutputs?.find(o => o.agent === name)
      return {
        id: `${i}-${name}`,
        name: name.replace(/Agent$/, '').replace(/([A-Z])/g, ' $1').trim(),
        score: Math.round(score),
        rec: out?.recommendation ?? 'defer',
      }
    })
}
