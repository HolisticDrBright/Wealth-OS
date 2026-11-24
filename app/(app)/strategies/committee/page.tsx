/**
 * AI committee: cost and value (roadmap #7) — pro mode. What every model call
 * costs (real tokens × price), and whether each agent's vetoes pay for
 * themselves (vetoed trades graded on what they would have done). Agents
 * with evidence against them can be turned off; protected safety checks never.
 */

import { getCommitteeReport } from '@/lib/actions/committee'
import { getUiMode } from '@/lib/actions/ui-prefs'
import { COMMITTEE_GRADE_HORIZON_DAYS, COMMITTEE_REVIEW_LOOKBACK_DAYS, COMMITTEE_MIN_GRADED_VETOES } from '@/lib/config/product-defaults'
import { AgentSwitch } from './AgentSwitch'

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`
const VERDICT: Record<string, { label: string; tone: string }> = {
  keep: { label: 'Keep', tone: 'text-emerald-300' },
  cut: { label: 'Cut', tone: 'text-orange-300' },
  never_vetoes: { label: 'Never vetoes', tone: 'text-orange-300' },
  failing: { label: 'Mostly failing', tone: 'text-red-300' },
  not_enough_evidence: { label: 'Not enough evidence', tone: 'text-text-1' },
  protected: { label: 'Protected', tone: 'text-sky-300' },
}

export default async function CommitteePage() {
  if ((await getUiMode()) !== 'pro') {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-text-1">The AI committee report lives in Pro mode.</div>
  }
  const report = await getCommitteeReport()
  if (!report) return <div className="px-4 py-10 text-sm text-text-1">Sign in to see the AI committee report.</div>
  const t = report.totals

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-text-0">AI committee: cost and value</h1>
        <p className="mt-1 text-sm text-text-1">
          Last {COMMITTEE_REVIEW_LOOKBACK_DAYS} days. Cost is real token usage × price. A veto&apos;s value is what the vetoed trade would have
          made {COMMITTEE_GRADE_HORIZON_DAYS} days later after costs, sign-flipped: a vetoed loser is money saved.
        </p>
      </div>

      {!report.available && (
        <p className="rounded-lg border border-line-strong p-3 text-sm text-text-1">Cost logs aren&apos;t available yet (migration 20260704s not applied).</p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Committee runs', `${t.runs} (${t.gradedRuns} graded)`],
          ['Committee cost', usd(t.committeeCostUsd)],
          ['Cost per decision', t.costPerRunUsd == null ? '—' : usd(t.costPerRunUsd)],
          ['Strategy AI checks', usd(t.strategyAiCostUsd)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line-strong bg-white/[0.03] p-3">
            <p className="text-xs text-text-1">{k}</p>
            <p className="mt-1 font-mono text-lg text-text-0">{v}</p>
          </div>
        ))}
      </section>
      {t.otherAiCostUsd > 0 && <p className="text-xs text-text-1">Other AI features (screener, research ideas, prediction-market agent): {usd(t.otherAiCostUsd)}.</p>}

      <section className="overflow-x-auto rounded-xl border border-line-strong">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-text-1">
            <tr>
              <th scope="col" className="px-3 py-2">Agent</th>
              <th scope="col" className="px-3 py-2">Calls</th>
              <th scope="col" className="px-3 py-2">Cost</th>
              <th scope="col" className="px-3 py-2">Graded vetoes</th>
              <th scope="col" className="px-3 py-2">Veto value</th>
              <th scope="col" className="px-3 py-2">Net</th>
              <th scope="col" className="px-3 py-2">Verdict</th>
              <th scope="col" className="px-3 py-2">On / off</th>
            </tr>
          </thead>
          <tbody>
            {report.agents.map(a => (
              <tr key={a.agent} className="border-t border-line-strong align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-text-0">{a.agent}</div>
                  <div className="text-xs text-text-1">{a.path === 'committee' ? 'copy-trade committee' : 'strategy pipeline'}</div>
                </td>
                <td className="px-3 py-2 font-mono">{a.calls}{a.failedCalls > 0 && <span className="text-red-300"> ({a.failedCalls} failed)</span>}</td>
                <td className="px-3 py-2 font-mono">{usd(a.costUsd)}</td>
                <td className="px-3 py-2 font-mono">{a.vetoes}{a.vetoes > 0 && <span className="text-text-1"> ({a.rightVetoes} right)</span>}</td>
                <td className={`px-3 py-2 font-mono ${a.vetoValueUsd >= 0 ? 'text-emerald-300' : 'text-orange-300'}`}>{usd(a.vetoValueUsd)}</td>
                <td className={`px-3 py-2 font-mono ${a.netUsd >= 0 ? 'text-emerald-300' : 'text-orange-300'}`}>{usd(a.netUsd)}</td>
                <td className="px-3 py-2 text-xs">
                  <div className={`font-semibold ${VERDICT[a.verdict].tone}`}>{VERDICT[a.verdict].label}</div>
                  <div className="text-text-1">{a.reason}</div>
                </td>
                <td className="px-3 py-2">
                  {a.path === 'committee' && a.verdict !== 'protected'
                    ? <AgentSwitch agent={a.agent} disabled={a.disabled} canDisable={a.canDisable} />
                    : <span className="text-xs text-text-1">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-text-1">
        An agent can be turned off only once the evidence says so (at least {COMMITTEE_MIN_GRADED_VETOES} graded vetoes that didn&apos;t pay for
        their calls, a record of never saying no, or calls that mostly fail). Turning one off drops its vote from future copy-trade decisions
        and stops its calls; turning it back on is always allowed. The risk manager&apos;s veto is a safety rule and is never turned off.
      </p>
    </div>
  )
}
