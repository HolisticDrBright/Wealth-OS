'use client'

/**
 * Command Center client — renders the assembled, fully-serializable
 * CommandCenterData into a dense, institutional dashboard that answers
 * "what should I do with capital today, and why?".
 *
 * Pure presentation: every section is a compact panel with an honest empty
 * state. No data fetching happens here — the server page calls
 * getCommandCenterData() once and passes the result down.
 */

import type { CommandCenterData } from '@/lib/actions/command-center'
import { RegimeBanner } from './command-center/RegimeBanner'
import { RiskStatusPanel } from './command-center/RiskStatusPanel'
import { OpportunitiesPanel } from './command-center/OpportunitiesPanel'
import { NoTradePanel } from './command-center/NoTradePanel'
import { PaperTradesPanel } from './command-center/PaperTradesPanel'
import { PaperRunPanel } from './command-center/PaperRunPanel'
import { AllocationPanel } from './command-center/AllocationPanel'
import { TrustPanel } from './command-center/TrustPanel'
import { DecisionsPanel } from './command-center/DecisionsPanel'
import { AiUsagePanel } from './command-center/AiUsagePanel'
import { ShadowPortfolioPanel } from './command-center/ShadowPortfolioPanel'
import { EquityCurvePanel } from './command-center/EquityCurvePanel'
import { RunHistoryStrip } from './command-center/RunHistoryStrip'
import { TradeTapePanel } from './command-center/TradeTapePanel'
import { AgentReasoningPanel } from './command-center/AgentReasoningPanel'

export function DashboardClient({ data }: { data: CommandCenterData }) {
  return (
    <div className="min-h-full space-y-4 bg-bg-1 p-6">
      {/* 1 — Market regime, full-width strip */}
      <RegimeBanner regime={data.regime} />

      {/* 2 — Portfolio risk status (full width, high priority) */}
      <RiskStatusPanel risk={data.risk} controls={data.riskControls} />

      {/* 2.5 — Equity curve: cumulative P&L, real vs shadow */}
      <EquityCurvePanel data={data.equityCurve} />

      {/* 3 — Today's best opportunities (full width) */}
      <OpportunitiesPanel opportunities={data.opportunities} />

      {/* 4 + 5 — Blocked calls + active paper trades */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NoTradePanel entries={data.noTrade} />
        <PaperTradesPanel paper={data.paper} />
      </div>

      {/* 4.5 — Last paper run breakdown + run history trend */}
      <PaperRunPanel lastRun={data.paper.lastRun} />
      <RunHistoryStrip runs={data.paper.runHistory} />

      {/* 4.7 — Trade tape + agent reasoning: provenance for every fill */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TradeTapePanel fills={data.tape} />
        <AgentReasoningPanel decisions={data.reasoning} />
      </div>

      {/* 5 — Shadow portfolio: "were your gates right?" */}
      <ShadowPortfolioPanel data={data.shadow} />

      {/* 6 + 8 — Capital allocation + required decisions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AllocationPanel profile={data.allocationProfile} risk={data.risk} />
        <DecisionsPanel decisions={data.decisions} />
      </div>

      {/* 7 + 9 — Trust trends + AI usage */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrustPanel trust={data.trust} />
        </div>
        <AiUsagePanel usage={data.aiUsage} />
      </div>
    </div>
  )
}
