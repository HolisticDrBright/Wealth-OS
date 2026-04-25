'use client'

import type { SignalStrategy, Side, WalletTier } from './types'

// ─── Event payload shapes (mirror Meta_Poly_tarder broadcast payloads) ────────

export interface PriceUpdateEvent {
  market_id: string
  yes_price: number
  no_price: number
}

export interface SignalEvent {
  strategy: SignalStrategy | string
  market_id: string
  side: Side
  confidence: number
  size_usdc?: number
  price?: number
}

export interface PositionSettledEvent {
  market_id: string
  outcome: string
  pnl: number
}

export interface PositionClosedEvent {
  market_id: string
  reason?: string
  pnl: number
}

export interface JetEvent {
  target: string
  poi: string
  distance: number
  strength: number
}

export interface WhaleTradeEvent {
  wallet: string
  display_name?: string
  tier?: WalletTier
  market_id: string
  question: string
  side: Side
  size_usdc: number
  price: number
  timestamp: string
}

export interface TradeEvent {
  strategy: SignalStrategy | string
  market_id: string
  side: Side
  price: number
  size: number
  paper: boolean
}

export interface VpnDropEvent {
  status: string
}

// ─── Typed event map ──────────────────────────────────────────────────────────

export interface WsEventMap {
  vpn_drop: VpnDropEvent
  price_update: PriceUpdateEvent
  signal: SignalEvent
  position_settled: PositionSettledEvent
  position_closed: PositionClosedEvent
  jet_event: JetEvent
  whale_trade: WhaleTradeEvent
  trade: TradeEvent
  copy_executed: Record<string, unknown>
}

export type WsEvent<K extends keyof WsEventMap = keyof WsEventMap> = {
  [P in K]: { type: P; data: WsEventMap[P] }
}[K]

export type WsHandlers = {
  [K in keyof WsEventMap]?: (data: WsEventMap[K]) => void
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected'

// ─── Reconnect config ─────────────────────────────────────────────────────────

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const MAX_ATTEMPTS = 10

// ─── Public handle ────────────────────────────────────────────────────────────

export interface MetaPolyWS {
  close(): void
  isConnected(): boolean
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMetaPolyWS(
  url: string,
  handlers: WsHandlers,
  onStatusChange?: (status: WsStatus) => void,
): MetaPolyWS {
  let ws: WebSocket | null = null
  let attempts = 0
  let manualClose = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect(): void {
    onStatusChange?.('connecting')
    ws = new WebSocket(url)

    ws.onopen = () => {
      attempts = 0
      onStatusChange?.('connected')
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data: unknown }
        const handler = handlers[msg.type as keyof WsEventMap]
        if (handler) {
          ;(handler as (d: unknown) => void)(msg.data)
        }
      } catch {
        // ignore malformed frames
      }
    }

    ws.onclose = () => {
      onStatusChange?.('disconnected')
      if (!manualClose && attempts < MAX_ATTEMPTS) {
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS)
        attempts++
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      // onclose fires after onerror — reconnect happens there
    }
  }

  connect()

  return {
    close() {
      manualClose = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      ws?.close()
    },
    isConnected() {
      return ws?.readyState === WebSocket.OPEN
    },
  }
}

// ─── URL helper (client-side) ─────────────────────────────────────────────────

export function metaPolyWsUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_META_POLY_URL ?? 'http://localhost:8000'
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/live'
}
