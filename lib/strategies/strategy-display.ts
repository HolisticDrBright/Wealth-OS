/**
 * Presentation helpers for strategies — pure, dependency-free, and safe to use
 * from both server and client components. Centralizes maturity labels, edge-type
 * labels, asset-class labels, and the "is this tradable?" semantics so every
 * surface (Command Center, Strategy Health Board, Opportunity cards) renders the
 * same language and color story.
 */

import type {
  StrategyKey,
  StrategyMaturityStatus,
  EdgeType,
  AssetClass,
} from './strategy-registry'

// ─── Visual tone vocabulary ─────────────────────────────────────────────────
// Restrained, meaningful colors (see design rules):
//   positive=green, danger=red, caution=amber, info=blue, accent=indigo(violet),
//   neutral=slate. Tone -> tailwind class fragments.

export type Tone = 'positive' | 'danger' | 'caution' | 'info' | 'accent' | 'neutral'

export const TONE_CLASSES: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  positive: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  danger:   { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',     dot: 'bg-red-400' },
  caution:  { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   dot: 'bg-amber-400' },
  info:     { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20',     dot: 'bg-sky-400' },
  accent:   { text: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/20',  dot: 'bg-indigo-400' },
  neutral:  { text: 'text-gray-400',    bg: 'bg-white/5',        border: 'border-white/10',       dot: 'bg-gray-500' },
}

// ─── Maturity ───────────────────────────────────────────────────────────────

export interface MaturityMeta {
  /** User-facing label (spec uses "Planned" for the `stub` engine status). */
  label: string
  tone: Tone
  /** Short, non-technical explanation of what this status means. */
  description: string
  /** True only when the strategy may produce *paper* trades. */
  paperTradable: boolean
  /** True only when the strategy is eligible for *live* (real-money) execution. */
  liveEligible: boolean
  /** Ordering for sorting a health board from least-to-most mature. */
  rank: number
}

export const MATURITY_META: Record<StrategyMaturityStatus, MaturityMeta> = {
  stub: {
    label: 'Planned',
    tone: 'neutral',
    description: 'No signal logic yet. Cannot trade — design/placeholder only.',
    paperTradable: false,
    liveEligible: false,
    rank: 0,
  },
  backtest_ready: {
    label: 'Backtest Ready',
    tone: 'info',
    description: 'Backtested but not yet paper-traded. Not tradable until promoted.',
    paperTradable: false,
    liveEligible: false,
    rank: 1,
  },
  paper_trading: {
    label: 'Paper Trading',
    tone: 'accent',
    description: 'Actively paper-traded to build a track record. No real money.',
    paperTradable: true,
    liveEligible: false,
    rank: 2,
  },
  live_candidate: {
    label: 'Live Candidate',
    tone: 'caution',
    description: 'Meets the live bar (track record, Sharpe, drawdown) — pending review.',
    paperTradable: true,
    liveEligible: true,
    rank: 3,
  },
  live_disabled: {
    label: 'Live Disabled',
    tone: 'neutral',
    description: 'Approved for live but intentionally paused. Will not trade real money.',
    paperTradable: true,
    liveEligible: false,
    rank: 4,
  },
  retired: {
    label: 'Retired',
    tone: 'danger',
    description: 'Decommissioned. Must never execute unless explicitly re-enabled.',
    paperTradable: false,
    liveEligible: false,
    rank: 5,
  },
}

export function getMaturityMeta(status: StrategyMaturityStatus | string | null | undefined): MaturityMeta {
  if (status && status in MATURITY_META) return MATURITY_META[status as StrategyMaturityStatus]
  return MATURITY_META.stub
}

/** A maturity status that must never trade in any mode. */
export function isInert(status: StrategyMaturityStatus): boolean {
  return status === 'stub' || status === 'retired'
}

// ─── Edge type ──────────────────────────────────────────────────────────────

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  rules:       'Rules',
  information: 'Information',
  structural:  'Structural',
  sentiment:   'Sentiment',
  liquidity:   'Liquidity',
  flow:        'Flow',
  event:       'Event',
  meta:        'Meta',
  fundamental: 'Fundamental',
  technical:   'Technical',
  macro:       'Macro',
  onchain:     'On-chain',
}

export function edgeTypeLabel(edge: EdgeType | string): string {
  return (EDGE_TYPE_LABELS as Record<string, string>)[edge] ?? titleize(edge)
}

// ─── Asset class ────────────────────────────────────────────────────────────

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stocks:        'Stocks',
  options:       'Options',
  crypto:        'Crypto',
  forex:         'Forex',
  polymarket:    'Polymarket',
  'multi-asset': 'Multi-Asset',
}

export function assetClassLabel(ac: AssetClass | string): string {
  return (ASSET_CLASS_LABELS as Record<string, string>)[ac] ?? titleize(ac)
}

// ─── Display name ───────────────────────────────────────────────────────────

/** Humanize a snake_case strategy key into a Title Case label. */
export function toDisplayName(key: StrategyKey | string): string {
  return titleize(key)
}

function titleize(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
