'use client'

import { Panel } from './Panel'
import { MissingIntegrationState } from '@/components/ui/states'
import { Cpu } from 'lucide-react'
import Link from 'next/link'
import type { AiUsageView } from '@/lib/actions/command-center'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-600">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-100">{value}</p>
    </div>
  )
}

export function AiUsagePanel({ usage }: { usage: AiUsageView }) {
  return (
    <Panel icon={Cpu} title="AI / Cost Usage">
      {!usage.available ? (
        <MissingIntegrationState
          title="AI usage tracking"
          message="Usage logging isn't available for your account yet. Once AI features run, today's spend and call count will appear here."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Spend today" value={`$${usage.spendUsdToday.toFixed(2)}`} />
            <Metric label="Calls today" value={String(usage.callsToday)} />
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            Full breakdown in{' '}
            <Link href="/settings" className="text-indigo-400 hover:underline">Settings → AI</Link>.
          </p>
        </>
      )}
    </Panel>
  )
}
