import type { SimulationReport, ConfidenceLevel, TradeContext } from './types'
import Anthropic from '@anthropic-ai/sdk'

const MIROFISH_BASE_URL = process.env.MIROFISH_BASE_URL
const client = new Anthropic()

// ─── Real MiroFish API client ──────────────────────────────────────────────

export class MiroFishClient {
  async startSimulation(params: {
    seedContent: string
    predictionQuery: string
    seedDocumentUrl?: string
  }): Promise<{ jobId: string }> {
    if (!MIROFISH_BASE_URL) throw new Error('MIROFISH_BASE_URL not configured')

    const res = await fetch(`${MIROFISH_BASE_URL}/api/start-simulation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok) throw new Error(`MiroFish start failed: ${res.status}`)
    return res.json()
  }

  async getStatus(jobId: string): Promise<{
    status: 'building_graph' | 'running' | 'generating_report' | 'complete' | 'failed'
    reportId?: string
  }> {
    if (!MIROFISH_BASE_URL) throw new Error('MIROFISH_BASE_URL not configured')
    const res = await fetch(`${MIROFISH_BASE_URL}/api/status/${jobId}`)
    if (!res.ok) throw new Error(`MiroFish status failed: ${res.status}`)
    return res.json()
  }

  async getReport(reportId: string): Promise<SimulationReport> {
    if (!MIROFISH_BASE_URL) throw new Error('MIROFISH_BASE_URL not configured')
    const res = await fetch(`${MIROFISH_BASE_URL}/api/report/${reportId}`)
    if (!res.ok) throw new Error(`MiroFish report failed: ${res.status}`)
    return res.json()
  }

  async chatWithReport(sessionId: string, message: string): Promise<{ reply: string }> {
    if (!MIROFISH_BASE_URL) throw new Error('MIROFISH_BASE_URL not configured')
    const res = await fetch(`${MIROFISH_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    })
    if (!res.ok) throw new Error(`MiroFish chat failed: ${res.status}`)
    return res.json()
  }

  // Poll until complete (max 5 minutes)
  async pollUntilComplete(jobId: string, intervalMs = 10000): Promise<SimulationReport> {
    const maxAttempts = 30
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.getStatus(jobId)
      if (status.status === 'complete' && status.reportId) {
        return this.getReport(status.reportId)
      }
      if (status.status === 'failed') throw new Error('MiroFish simulation failed')
      await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new Error('MiroFish simulation timed out')
  }

  // Score formula: Consensus(40%) + BullProb(30%) + TailRiskDiscount(20%) + Confidence(10%)
  // Capped at 60 if confidence === 'low'
  computeSimulationScore(report: SimulationReport): number {
    const consensusScore = report.agentConsensus * 100 * 0.40
    const bullScore = report.bullProbability * 100 * 0.30
    const tailDiscount = (1 - report.tailRiskScore / 100) * 100 * 0.20
    const confidenceMap: Record<ConfidenceLevel, number> = { high: 100, medium: 60, low: 20 }
    const confidenceScore = confidenceMap[report.confidenceLevel] * 0.10
    const raw = consensusScore + bullScore + tailDiscount + confidenceScore
    return report.confidenceLevel === 'low' ? Math.min(60, raw) : Math.min(100, raw)
  }
}

// ─── Claude-based simulation fallback (used when MiroFish isn't deployed) ──

export async function simulateWithClaude(context: TradeContext): Promise<SimulationReport> {
  const { trade, user } = context
  const portfolioSummary = user.portfolio
    .slice(0, 10)
    .map(a => `${a.name} (${a.category}): $${a.current_value.toLocaleString()}`)
    .join(', ')

  const prompt = `You are a swarm intelligence simulation engine analyzing a copy trade decision.

PROPOSED TRADE:
- Symbol: ${trade.symbol}
- Action: ${trade.action.toUpperCase()}
- Asset Class: ${trade.asset_class}
- Size: $${trade.notional_value.toLocaleString()}
- Trader: ${trade.trader_name} (${trade.trader_return_pct}% 30d return, ${trade.trader_win_rate}% win rate)

USER PORTFOLIO:
- Net Worth: $${user.total_net_worth.toLocaleString()}
- Holdings: ${portfolioSummary}
- Risk Profile: ${user.risk_profile ?? 'moderate'}

Simulate 1000 autonomous agents analyzing this trade. Return a JSON object:
{
  "bullProbability": <0-1>,
  "bearProbability": <0-1>,
  "consensusDirection": "bullish"|"bearish"|"neutral",
  "tailRiskScore": <0-100>,
  "confidenceLevel": "high"|"medium"|"low",
  "agentConsensus": <0-1>,
  "keyFindings": [<3-5 key findings>],
  "scenarioSummary": "<2-3 sentence summary>"
}`

  const msg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch?.[0] ?? '{}')

  return {
    jobId: `claude_${Date.now()}`,
    reportId: `claude_report_${Date.now()}`,
    bullProbability: parsed.bullProbability ?? 0.5,
    bearProbability: parsed.bearProbability ?? 0.5,
    consensusDirection: parsed.consensusDirection ?? 'neutral',
    tailRiskScore: parsed.tailRiskScore ?? 50,
    confidenceLevel: parsed.confidenceLevel ?? 'medium',
    agentConsensus: parsed.agentConsensus ?? 0.5,
    keyFindings: parsed.keyFindings ?? [],
    scenarioSummary: parsed.scenarioSummary ?? '',
  }
}

export const miroFishClient = new MiroFishClient()
