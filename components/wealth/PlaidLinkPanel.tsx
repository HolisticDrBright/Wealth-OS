'use client'

/**
 * "Linked accounts" (roadmap #2) — read-only Plaid linking. Loads Plaid
 * Link's script only when the person clicks Link, gets a short-lived link
 * token from the server, and hands the resulting public token back to the
 * server. The access token never touches the browser. Wealth OS can see
 * balances and interest rates; it can never move money.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, RefreshCw } from 'lucide-react'
import {
  createLinkTokenAction, createUpdateLinkTokenAction, exchangePublicTokenAction,
  syncPlaidItemAction, removePlaidItemAction, type PlaidPanelView,
} from '@/lib/actions/plaid'

const PLAID_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

interface PlaidHandler { open: () => void; destroy?: () => void }
declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string
        onSuccess: (publicToken: string, metadata: unknown) => void
        onExit?: (err: { display_message?: string | null } | null) => void
      }) => PlaidHandler
    }
  }
}

function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = PLAID_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load Plaid'))
    document.head.appendChild(s)
  })
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const btn = 'min-h-[40px] rounded-lg px-4 text-sm font-semibold disabled:opacity-40'

export function PlaidLinkPanel({ view }: { view: PlaidPanelView }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openLink = (getToken: () => Promise<{ ok: true; linkToken: string } | { ok: false; error: string }>, onPublicToken: (t: string) => Promise<void>) =>
    start(async () => {
      setError(null); setNotice(null)
      const tok = await getToken()
      if (!tok.ok) { setError(tok.error); return }
      try { await loadPlaid() } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Plaid'); return }
      const handler = window.Plaid!.create({
        token: tok.linkToken,
        onSuccess: (publicToken) => { start(async () => { await onPublicToken(publicToken); router.refresh() }) },
        onExit: (err) => { if (err?.display_message) setError(err.display_message) },
      })
      handler.open()
    })

  const link = (kind: 'bank' | 'investments') => openLink(
    () => createLinkTokenAction(kind),
    async (publicToken) => {
      const res = await exchangePublicTokenAction(publicToken, kind)
      if (res.ok) setNotice(`Linked — ${res.accounts} account${res.accounts === 1 ? '' : 's'} synced.`)
      else setError(res.error)
    },
  )

  const relogin = (itemId: string) => openLink(
    () => createUpdateLinkTokenAction(itemId),
    async () => {
      const res = await syncPlaidItemAction(itemId)
      if (res.ok) setNotice('Reconnected and synced.')
      else setError(res.error)
    },
  )

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => start(async () => {
    setError(null); setNotice(null)
    const res = await fn()
    if (res.ok) setNotice(okText)
    else setError(res.error ?? 'Something went wrong')
    router.refresh()
  })

  return (
    <section aria-labelledby="linked-heading" className="rounded-2xl border border-line-strong bg-white/[0.03] p-5">
      <h2 id="linked-heading" className="flex items-center gap-2 text-base font-semibold text-text-0">
        <Landmark className="h-4 w-4 text-accent-cyan" aria-hidden /> Linked accounts
      </h2>
      <p className="mt-1 text-xs text-text-1">
        Read-only through Plaid: Wealth OS sees balances and interest rates so the advice uses real numbers. It can never move money.
        {view.env === 'sandbox' && ' Test mode — Plaid sandbox (fake banks; sign in with user_good / pass_good).'}
      </p>

      {!view.configured ? (
        <p className="mt-3 text-sm text-text-1">Account linking isn&apos;t set up on this server yet — accounts are entered by hand for now.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`${btn} bg-accent-cyan text-bg-0 hover:brightness-110`} disabled={pending} onClick={() => link('bank')}>
            Link a bank or credit card
          </button>
          <button className={`${btn} border border-line-strong text-text-0 hover:bg-white/5`} disabled={pending} onClick={() => link('investments')}>
            Link an investment or retirement account
          </button>
        </div>
      )}

      {view.items.length > 0 && (
        <ul className="mt-4 space-y-3">
          {view.items.map(item => (
            <li key={item.itemId} className="rounded-xl border border-line-strong p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text-0">{item.institutionName}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${item.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-orange-500/15 text-orange-300'}`}>
                  {item.status === 'active' ? 'Synced' : item.status === 'login_required' ? 'Needs you to sign in again' : 'Sync problem'}
                </span>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-text-1">
                {item.accounts.map(a => (
                  <li key={a.name} className="flex justify-between gap-3">
                    <span>{a.name}</span>
                    <span className="font-mono text-text-0">
                      {a.balanceUsd == null ? '—' : usd(a.balanceUsd)}{a.aprPct != null ? ` · ${a.aprPct.toFixed(1)}% APR` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {item.lastError && <p className="mt-1 text-xs text-orange-300">{item.lastError}</p>}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {item.status === 'login_required' ? (
                  <button className="font-semibold text-accent-cyan underline" disabled={pending} onClick={() => relogin(item.itemId)}>Sign in again</button>
                ) : (
                  <button className="flex items-center gap-1 text-text-1 underline" disabled={pending}
                    onClick={() => act(() => syncPlaidItemAction(item.itemId), 'Refreshed.')}>
                    <RefreshCw className="h-3 w-3" aria-hidden /> Refresh
                  </button>
                )}
                <button className="text-text-1 underline" disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Disconnect ${item.institutionName}? Its balances will be removed from Wealth OS.`)) {
                      act(() => removePlaidItemAction(item.itemId), 'Disconnected.')
                    }
                  }}>Disconnect</button>
              </div>
              {item.lastSyncedAt && <p className="mt-1 text-xs text-text-1">Last synced {new Date(item.lastSyncedAt).toLocaleString()}</p>}
            </li>
          ))}
        </ul>
      )}

      {view.items.length > 0 && (view.manualAssets > 0 || view.manualDebts > 0) && (
        <p className="mt-3 text-xs text-orange-200">
          You also have {view.manualAssets + view.manualDebts} hand-entered balance{view.manualAssets + view.manualDebts === 1 ? '' : 's'}.
          If any are the same accounts you just linked, delete the hand-entered ones so nothing is counted twice.
        </p>
      )}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  )
}
