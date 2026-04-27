export type PaperPositionStatus = 'open' | 'closed' | 'stopped'
export type PaperExitReason = 'take_profit' | 'stop_loss' | 'timeout' | 'manual' | 'signal'

export interface PaperPosition {
  id: string
  openedAt: string
  closedAt?: string
  userId: string
  strategyKey: string
  symbol: string
  assetClass: string
  direction: 'long' | 'short'
  entryPrice: number
  currentPrice?: number
  exitPrice?: number
  quantity: number
  notionalUsd: number
  unrealizedPnlUsd?: number
  unrealizedPnlPct?: number
  realizedPnlUsd?: number
  realizedPnlPct?: number
  status: PaperPositionStatus
  stopLossPct: number
  takeProfitPct: number
  maxHoldHours: number
  exitReason?: PaperExitReason
  metadata: Record<string, unknown>
}

export interface PaperTrade {
  id: string
  createdAt: string
  userId: string
  positionId?: string
  strategyKey: string
  symbol: string
  assetClass: string
  direction: 'long' | 'short'
  side: 'open' | 'close'
  fillPrice: number
  quantity: number
  notionalUsd: number
  slippageBps: number
  opportunityId?: string
  metadata: Record<string, unknown>
}

export interface PaperRunResult {
  runAt: string
  strategiesRun: number
  opportunitiesFound: number
  decisionsExecute: number
  decisionsBlock: number
  positionsOpened: number
  positionsClosed: number
  errors: string[]
}

export interface PaperSummary {
  totalRealizedPnlUsd: number
  totalUnrealizedPnlUsd: number
  totalPnlUsd: number
  closedTrades: number
  openPositions: number
  winRate: number | null
  avgWinUsd: number | null
  avgLossUsd: number | null
  byStrategy: Record<string, { pnlUsd: number; trades: number; winRate: number | null }>
}
