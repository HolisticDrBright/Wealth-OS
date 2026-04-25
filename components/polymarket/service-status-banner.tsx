'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, WifiOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WsStatus } from '@/lib/meta-poly/ws'

interface Props {
  paperTrading: boolean
  schedulerRunning: boolean
  circuitOpen: boolean
  circuitFailures: number
  circuitRetriesInMs: number
  wsStatus: WsStatus
}

export function ServiceStatusBanner({
  paperTrading,
  schedulerRunning,
  circuitOpen,
  circuitFailures,
  circuitRetriesInMs,
  wsStatus,
}: Props) {
  const [retryCountdown, setRetryCountdown] = useState(
    Math.ceil(circuitRetriesInMs / 1000)
  )

  useEffect(() => {
    if (!circuitOpen) return
    const id = setInterval(() => {
      setRetryCountdown(s => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [circuitOpen])

  const wsConnected = wsStatus === 'connected'
  const wsConnecting = wsStatus === 'connecting'

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
      {/* Circuit breaker */}
      {circuitOpen ? (
        <span className="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Sidecar offline — retry in {retryCountdown}s
          {circuitFailures > 0 && (
            <span className="text-amber-400/60">({circuitFailures} failures)</span>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Sidecar reachable
        </span>
      )}

      <span className="text-white/20">·</span>

      {/* WebSocket */}
      {wsConnected ? (
        <span className="flex items-center gap-1.5 text-green-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Live
        </span>
      ) : wsConnecting ? (
        <span className="flex items-center gap-1.5 text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Connecting…
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-red-400">
          <WifiOff className="h-3.5 w-3.5" />
          Disconnected
        </span>
      )}

      <span className="text-white/20">·</span>

      {/* Trading mode */}
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium',
          paperTrading
            ? 'bg-blue-500/15 text-blue-300'
            : 'bg-amber-500/15 text-amber-300'
        )}
      >
        {paperTrading ? 'Paper' : 'Live'}
      </span>

      {/* Scheduler */}
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium',
          schedulerRunning
            ? 'bg-green-500/15 text-green-300'
            : 'bg-gray-500/15 text-gray-400'
        )}
      >
        Scheduler {schedulerRunning ? 'on' : 'off'}
      </span>
    </div>
  )
}
