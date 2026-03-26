'use client'

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts'
import type { CIODecision } from '@/lib/agents/types'

const AGENT_SHORT_LABELS: Record<string, string> = {
  OrchestratorAgent: 'Orchestrator',
  ClientProfileAgent: 'Profile',
  PortfolioDiagnosticAgent: 'Portfolio',
  FundamentalEquityAgent: 'Fundamentals',
  TechnicalMarketAgent: 'Technical',
  QuantScreeningAgent: 'Quant',
  MacroRegimeAgent: 'Macro',
  CryptoIntelligenceAgent: 'Crypto',
  ForexStrategyAgent: 'Forex',
  RiskManagementAgent: 'Risk',
  TaxOptimizationAgent: 'Tax',
  RetirementExecutionAgent: 'Retirement',
  MiroFishSimulationAgent: 'MiroFish',
}

interface Props {
  decision: CIODecision
  size?: number
}

export function OpportunityScoreRadar({ decision, size = 260 }: Props) {
  const data = Object.entries(decision.agentScores)
    .filter(([k]) => k !== 'OrchestratorAgent') // skip orchestrator from radar
    .map(([agent, score]) => ({
      subject: AGENT_SHORT_LABELS[agent] ?? agent,
      score,
      fullMark: 100,
    }))

  return (
    <div style={{ height: size, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.08)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: '#9ca3af', fontSize: 10 }}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={{ fill: '#6b7280', fontSize: 9 }}
            tickCount={4}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f1117',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#9ca3af' }}
            itemStyle={{ color: '#fff' }}
          />
          <Radar
            dataKey="score"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.2}
            strokeWidth={1.5}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
