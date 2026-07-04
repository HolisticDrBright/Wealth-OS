export type PaperPositionStatus = 'open' | 'closed' | 'stopped'
export type PaperExitReason = 'take_profit' | 'stop_loss' | 'timeout' | 'manual' | 'signal'
export type PaperTradeDirection = 'long' | 'short' | 'neutral'
export interface PaperPosition {
  id: string
  openedAt: string
  closedAt?: string
  userId: string
  strategyKey: string
  symbol: string
  assetClass: string
  direction: PaperTradeDirection
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
  direction: PaperTradeDirection
  side: 'open' | 'close'
  fillPrice: number
  quantity: number
  notionalUsd: number
  slippageBps: number
  opportunityId?: string
  metadata: Record<string, unknown>
}

// ── Broker fill result ────────────────────────────────────────────────────────

export type PaperFillResult =
  | { status: 'opened'; id: string }
  | { status: 'already_open'; reason: string }
  | { status: 'missing_price'; reason: string }
  | { status: 'invalid_price'; reason: string }
  | { status: 'insert_error'; reason: string }
  | { status: 'no_size'; reason: string }
  /** Modeled cost exceeded the rejection threshold — order too large for the book. */
  | { status: 'rejected_liquidity'; reason: string }

// ── Run breakdown ─────────────────────────────────────────────────────────────

export interface SkippedDetail {
  strategyKey: string
  symbol: string
  assetClass: string
  direction?: string
  outcome: string
  reason: string
  opportunityId?: string
  timestamp: string
}

export interface SkipCounts {
  alreadyOpen: number
  missingPrice: number
  expiredMarket: number
  resolvedMarket: number
  riskBlocked: number
  profileBlocked: number
  venueBlocked: number
  positionCapBlocked: number
  liquidityBlocked: number
  strategyDisabled: number
  strategyImmature: number
  noSize: number
  other: number
}

export function emptySkipCounts(): SkipCounts {
  return {
    alreadyOpen: 0, missingPrice: 0, expiredMarket: 0, resolvedMarket: 0,
    riskBlocked: 0, profileBlocked: 0, venueBlocked: 0, positionCapBlocked: 0,
    liquidityBlocked: 0, strategyDisabled: 0, strategyImmature: 0, noSize: 0, other: 0,
  }
}

export interface PaperRunResult {
  runAt: string
  strategiesRun: number
  opportunitiesFound: number
  decisionsExecute: number
  decisionsBlock: number
  positionsOpened: number
  positionsClosed: number
  skipped: SkipCounts
  skippedDetails: SkippedDetail[]
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
