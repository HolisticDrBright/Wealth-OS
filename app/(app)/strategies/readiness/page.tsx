/**
 * Promotion readiness (Phase 6) — pro mode, READ-ONLY. Every registered
 * strategy: maturity, closed paper trades vs the promotion minimum, net
 * result after costs, drawdown, gates passed, and scan gaps in its paper
 * record. There is deliberately no control here that changes a strategy:
 * promotion stays a manual registry edit.
 */

import Link from 'next/link'
import { getTrackRecord } from '@/lib/actions/track-record'
import { getUiMode } from '@/lib/actions/ui-prefs'
import { SCAN_STALE_HOURS, SCAN_GAP_LOOKBACK_DAYS, RETIRE_FAIL_WEEKS } from '@/lib/config/product-defaults'

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)
const day = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

export default async function ReadinessPage() {
  const uiMode = await getUiMode()
  if (uiMode !== 'pro') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-text-1">
        The strategy track record lives in Pro mode. Switch to Pro in settings to see it.
      </div>
    )
  }
  const view = await getTrackRecord()
  if (!view) return <div className="px-4 py-10 text-sm text-text-1">Sign in to see the track record.</div>
  const { rows, scan, vsCoreTotal } = view

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-text-0">Promotion readiness</h1>
        <p className="mt-1 text-sm text-text-1">
          Every strategy&apos;s paper track record against the promotion gates. Read-only — promotion is a manual registry
          edit and nothing on this page changes a strategy.
        </p>
      </div>

      {/* Scan health */}
      <section aria-labelledby="scan-heading" className="rounded-xl border border-line-strong bg-white/[0.03] p-4">
        <h2 id="scan-heading" className="text-sm font-semibold text-text-0">Scan health</h2>
        {!scan.available ? (
          <p className="mt-2 text-sm text-text-1">Scan heartbeats aren&apos;t available yet (migration 20260704n not applied).</p>
        ) : (
          <>
            <p className={`mt-2 text-sm ${scan.stale ? 'text-orange-300' : 'text-text-1'}`}>
              Last successful scheduled scan: {scan.lastOkAt ? `${day(scan.lastOkAt)} ET` : 'never'}
              {scan.hoursSince != null && ` (${scan.hoursSince.toFixed(1)}h ago)`}.
              {scan.stale ? ` Stale: more than ${SCAN_STALE_HOURS}h during market hours.` : ' Healthy.'}
            </p>
            <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-1">
              Gaps in the last {SCAN_GAP_LOOKBACK_DAYS} days ({scan.gaps.length})
            </h3>
            {scan.gaps.length === 0 ? (
              <p className="mt-1 text-sm text-text-1">No stretch without scans longer than {SCAN_STALE_HOURS}h during market hours.</p>
            ) : (
              <ul className="mt-1 space-y-0.5 font-mono text-xs text-orange-200">
                {scan.gaps.map(g => (
                  <li key={g.from}>{day(g.from)} → {g.open ? 'now' : day(g.to)} ET · {g.hours}h without a successful scan</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Roadmap #3: Explore vs the same dollars in Core */}
      <section aria-labelledby="vs-core-heading" className="rounded-xl border border-line-strong bg-white/[0.03] p-4">
        <h2 id="vs-core-heading" className="text-sm font-semibold text-text-0">Explore vs Core (last 12 months, after costs)</h2>
        {vsCoreTotal == null ? (
          <p className="mt-2 text-sm text-text-1">Core fund prices are unavailable right now — no comparison.</p>
        ) : vsCoreTotal.trades === 0 ? (
          <p className="mt-2 text-sm text-text-1">No closed Explore trades to compare yet.</p>
        ) : (
          <p className="mt-2 text-sm text-text-1">
            {vsCoreTotal.trades} trades over {vsCoreTotal.daysCovered} days: strategies {usd(vsCoreTotal.netUsd)} vs the same dollars in
            Core {usd(vsCoreTotal.coreUsd)} —{' '}
            <span className={vsCoreTotal.excessUsd >= 0 ? 'text-emerald-300' : 'text-orange-300'}>
              {vsCoreTotal.excessUsd >= 0 ? `${usd(vsCoreTotal.excessUsd)} ahead` : `${usd(-vsCoreTotal.excessUsd)} behind`}
            </span>.
          </p>
        )}
      </section>

      {/* Every strategy */}
      <section aria-labelledby="strategies-heading" className="overflow-x-auto rounded-xl border border-line-strong">
        <h2 id="strategies-heading" className="sr-only">Strategies</h2>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-text-1">
            <tr>
              <th scope="col" className="px-3 py-2">Strategy</th>
              <th scope="col" className="px-3 py-2">Maturity</th>
              <th scope="col" className="px-3 py-2">Closed trades</th>
              <th scope="col" className="px-3 py-2">Net after costs</th>
              <th scope="col" className="px-3 py-2">Max drawdown</th>
              <th scope="col" className="px-3 py-2">vs Core</th>
              <th scope="col" className="px-3 py-2">Gates passed</th>
              <th scope="col" className="px-3 py-2">Scan gaps</th>
              <th scope="col" className="px-3 py-2">Retirement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.strategyKey} className="border-t border-line-strong align-top">
                <td className="px-3 py-2">
                  <Link href={`/strategies/${r.strategyKey}`} className="font-medium text-text-0 hover:underline">{r.displayName}</Link>
                  <div className="text-xs text-text-1">{r.book} · {r.assetClass}</div>
                </td>
                <td className="px-3 py-2 text-text-1">{r.maturity.replace('_', ' ')}</td>
                <td className="px-3 py-2 font-mono">
                  <span className={r.closedTrades >= r.minTrades ? 'text-emerald-300' : 'text-text-0'}>{r.closedTrades}</span>
                  <span className="text-text-1"> / {r.minTrades}</span>
                </td>
                <td className={`px-3 py-2 font-mono ${r.netAfterCostsUsd >= 0 ? 'text-emerald-300' : 'text-orange-300'}`}>
                  {r.closedTrades ? usd(r.netAfterCostsUsd) : '—'}
                  {r.closedTrades > 0 && <div className="text-xs text-text-1">gross {usd(r.grossPnlUsd)} − costs {usd(r.costsUsd)}</div>}
                </td>
                <td className="px-3 py-2 font-mono text-text-0">{pct(r.maxDrawdownPct)}</td>
                <td className={`px-3 py-2 font-mono ${r.vsCoreExcessUsd == null ? 'text-text-1' : r.vsCoreExcessUsd >= 0 ? 'text-emerald-300' : 'text-orange-300'}`}>
                  {r.vsCoreExcessUsd == null ? '—' : usd(r.vsCoreExcessUsd)}
                </td>
                <td className="px-3 py-2">
                  <span className="font-mono text-text-0">{r.gatesPassed} / {r.gatesTotal}</span>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {r.criteria.map(c => (
                      <li key={c.name} className={!c.evaluable ? 'text-text-1' : c.pass ? 'text-emerald-300' : 'text-orange-300'}>
                        {!c.evaluable ? '○' : c.pass ? '✓' : '✗'} {c.name}: {c.actual}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.closedTrades === 0 ? <span className="text-text-1">—</span>
                    : r.gaps.length === 0 ? <span className="text-emerald-300">none</span>
                    : <span className="text-orange-300">{r.gaps.length} gap{r.gaps.length === 1 ? '' : 's'} ({r.gaps.reduce((h, g) => h + g.hours, 0).toFixed(0)}h) since first trade</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.retired && (
                    <span className="text-orange-300" title={r.retired.reason}>
                      Switched off {new Date(r.retired.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {r.retired.rule ? ` (${r.retired.rule.replace(/_/g, ' ')})` : ''}
                    </span>
                  )}
                  {r.failingWeeks > 0
                    ? <div className="text-orange-300">Failing gates {r.failingWeeks} of {RETIRE_FAIL_WEEKS} weeks</div>
                    : !r.retired && <span className="text-text-1">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-text-1">
        Net after costs = realized paper P&amp;L (fills already include modeled slippage) minus the venue round-trip cost on
        each trade — the same cost model the promotion gate uses. Strategies are switched off automatically (paper only;
        promotion stays manual) after two quarters behind their benchmark after fees, {RETIRE_FAIL_WEEKS} straight weeks failing
        their gates, or a year without enough trades to judge. A gap is a stretch longer than {SCAN_STALE_HOURS}h
        during market hours with no successful scheduled scan: trades the strategy would have taken then are missing from
        its record.
      </p>
    </div>
  )
}
