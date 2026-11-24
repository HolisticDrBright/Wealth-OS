'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setCommitteeAgentAction } from '@/lib/actions/committee'

export function AgentSwitch({ agent, disabled, canDisable }: { agent: string; disabled: boolean; canDisable: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const toggle = (enable: boolean) => start(async () => {
    setError(null)
    if (!enable && !window.confirm(`Turn off ${agent}? Its vote is dropped from future copy-trade decisions. You can turn it back on any time.`)) return
    const res = await setCommitteeAgentAction(agent, enable)
    if (!res.ok) setError(res.error ?? 'Could not change it')
    router.refresh()
  })
  return (
    <div className="text-xs">
      {disabled ? (
        <button className="min-h-[32px] rounded border border-line-strong px-2 text-text-0 hover:bg-white/5 disabled:opacity-40" disabled={pending} onClick={() => toggle(true)}>
          Off — turn on
        </button>
      ) : canDisable ? (
        <button className="min-h-[32px] rounded border border-orange-500/40 px-2 text-orange-200 hover:bg-orange-950/30 disabled:opacity-40" disabled={pending} onClick={() => toggle(false)}>
          Turn off
        </button>
      ) : (
        <span className="text-text-1">On</span>
      )}
      {error && <p role="alert" className="mt-1 text-red-300">{error}</p>}
    </div>
  )
}
