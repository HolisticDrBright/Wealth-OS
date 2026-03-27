'use client'

import { useState, useEffect, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { markAlertRead, markAllAlertsRead } from '@/lib/actions/alerts'
import type { Alert } from '@/lib/types'
import {
  Bell, TrendingUp, ShieldAlert, AlertCircle,
  Activity, Lightbulb, Info, CheckCheck, X,
} from 'lucide-react'

interface Props {
  initialAlerts: Alert[]
}

const TYPE_CONFIG: Record<Alert['type'], { icon: React.ElementType; color: string }> = {
  trade_executed: { icon: TrendingUp,  color: 'text-emerald-400' },
  risk_breach:    { icon: ShieldAlert, color: 'text-red-400' },
  price_alert:    { icon: Activity,    color: 'text-amber-400' },
  simulation_done:{ icon: Activity,    color: 'text-indigo-400' },
  opportunity:    { icon: Lightbulb,   color: 'text-yellow-400' },
  system:         { icon: Info,        color: 'text-gray-400' },
}

const SEVERITY_BORDER = {
  info:     'border-white/10',
  warning:  'border-amber-500/30',
  critical: 'border-red-500/30',
}

export function AlertsClient({ initialAlerts }: Props) {
  const [alerts, setAlerts] = useState(initialAlerts)
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')
  const [, startTransition] = useTransition()

  // ─── Realtime: alerts-channel ─────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('alerts-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => {
          setAlerts(prev => [payload.new as Alert, ...prev])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  function markRead(id: string) {
    startTransition(async () => {
      await markAlertRead(id)
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
    })
  }

  function markAll() {
    startTransition(async () => {
      await markAllAlertsRead()
      setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
    })
  }

  const filtered = alerts.filter(a => {
    if (filter === 'unread') return !a.is_read
    if (filter === 'critical') return a.severity === 'critical'
    return true
  })

  const unreadCount = alerts.filter(a => !a.is_read).length

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['all', 'unread', 'critical'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              {f === 'all' ? `All (${alerts.length})` : f === 'unread' ? `Unread (${unreadCount})` : 'Critical'}
            </button>
          ))}
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAll}>
            <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/20 p-12 text-center">
          <Bell className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No alerts</p>
          <p className="text-xs text-gray-600 mt-1">Trade events, risk breaches, and system messages will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(alert => {
            const cfg = TYPE_CONFIG[alert.type] ?? TYPE_CONFIG.system
            const AlertIcon = cfg.icon
            return (
              <Card
                key={alert.id}
                className={`border ${SEVERITY_BORDER[alert.severity]} ${alert.is_read ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                    <AlertIcon className={`h-4 w-4 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{alert.title}</p>
                      {alert.severity !== 'info' && (
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          alert.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {alert.severity}
                        </span>
                      )}
                      {!alert.is_read && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                    </div>
                    {alert.body && (
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{alert.body}</p>
                    )}
                    <p className="text-xs text-gray-600 mt-1">
                      {alert.type.replace('_', ' ')} · {new Date(alert.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!alert.is_read && (
                    <button
                      onClick={() => markRead(alert.id)}
                      className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
                      title="Mark as read"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
