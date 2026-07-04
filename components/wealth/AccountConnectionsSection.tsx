'use client'

/**
 * Account connections (upgrade item 1) — honest provider status + accounts
 * summary. Providers without credentials say "not connected"; balances are
 * "manual" unless a real sync ever runs. Never pretends accounts are linked.
 */

import { useEffect, useState } from 'react'
import { Landmark } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAccountsSummary, getProviderStatuses, type ProviderStatus } from '@/lib/actions/connected-accounts'
import type { AccountsSummary } from '@/lib/accounts/aggregation'

const usd = (v: number) => `$${Math.round(v).toLocaleString()}`

export function AccountConnectionsSection() {
  const [summary, setSummary] = useState<AccountsSummary | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])

  useEffect(() => {
    getAccountsSummary().then(setSummary).catch(() => {})
    getProviderStatuses().then(setProviders).catch(() => {})
  }, [])

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Landmark className="h-3.5 w-3.5" /> Account connections
        </h2>
        {summary && (
          <span className="text-[10px] text-gray-600">
            {summary.accountCount} account(s) · {summary.allManual ? 'all manual — nothing is synced' : `${summary.connectedProviders.length} provider(s) syncing`}
          </span>
        )}
      </div>

      {summary && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Cash', value: usd(summary.cashUsd) },
            { label: 'Investments', value: usd(summary.investmentUsd) },
            { label: 'Retirement', value: usd(summary.retirementUsd) },
            { label: 'Debt', value: usd(summary.debtUsd) },
          ].map(c => (
            <div key={c.label} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <p className="text-sm font-semibold tabular-nums text-gray-200">{c.value}</p>
              <p className="mt-0.5 text-[10px] text-gray-600">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {summary && summary.missingCategories.length > 0 && (
        <p className="mb-3 text-[11px] text-gray-500">
          Not tracked yet: {summary.missingCategories.join(' · ')} — add them manually for a complete picture.
        </p>
      )}

      <ul className="divide-y divide-white/5">
        {providers.map(p => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
            <span className="font-medium capitalize text-gray-300">{p.id.replace('_', ' ')}</span>
            <span className={cn('min-w-0 truncate text-right',
              p.id === 'manual' ? 'text-gray-400' : p.configured ? 'text-amber-400' : 'text-gray-600')}>
              {p.status}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-gray-600">
        No aggregation provider is live. Every balance shown in the app is manually entered until a real
        Plaid/Teller/Finicity integration ships and is labeled as synced.
      </p>
    </section>
  )
}
