'use client'

import { useState, useTransition } from 'react'
import { createRule, updateRule, deleteRule, reorderRules } from '@/lib/actions/autopilot-rules'
import type { AutopilotRule } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Zap, Plus, Trash2, ToggleLeft, ToggleRight, GripVertical, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  initialRules: AutopilotRule[]
}

const ACTION_COLORS: Record<string, string> = {
  copy:       'text-green-400 bg-green-400/10',
  skip:       'text-red-400 bg-red-400/10',
  reduce:     'text-yellow-400 bg-yellow-400/10',
  alert_only: 'text-blue-400 bg-blue-400/10',
}

const ACTION_LABELS: Record<string, string> = {
  copy:       'Copy trade',
  skip:       'Skip',
  reduce:     'Reduce size',
  alert_only: 'Alert only',
}

export function RulesClient({ initialRules }: Props) {
  const [rules, setRules] = useState(initialRules)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Form state
  const [name, setName] = useState('')
  const [actionType, setActionType] = useState<AutopilotRule['action_type']>('copy')
  const [symbols, setSymbols] = useState('')
  const [assetClasses, setAssetClasses] = useState('')
  const [minReturn, setMinReturn] = useState('')
  const [minCioScore, setMinCioScore] = useState('')
  const [sizingPct, setSizingPct] = useState('')

  function resetForm() {
    setName('')
    setActionType('copy')
    setSymbols('')
    setAssetClasses('')
    setMinReturn('')
    setMinCioScore('')
    setSizingPct('')
    setShowForm(false)
  }

  function handleCreate() {
    if (!name.trim()) return
    startTransition(async () => {
      const created = await createRule({
        name: name.trim(),
        is_active: true,
        priority: rules.length,
        action_type: actionType,
        condition_symbols: symbols ? symbols.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        condition_asset_classes: assetClasses ? assetClasses.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        condition_min_trader_return_pct: minReturn ? Number(minReturn) : undefined,
        condition_min_cio_score: minCioScore ? Number(minCioScore) : undefined,
        action_sizing_pct: sizingPct ? Number(sizingPct) : undefined,
      })
      if (created) {
        setRules(prev => [...prev, created])
        resetForm()
      }
    })
  }

  function handleToggle(id: string, isActive: boolean) {
    startTransition(async () => {
      await updateRule(id, { is_active: !isActive })
      setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !isActive } : r))
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteRule(id)
      setRules(prev => prev.filter(r => r.id !== id))
    })
  }

  function handleMoveUp(index: number) {
    if (index === 0) return
    const newRules = [...rules]
    ;[newRules[index - 1], newRules[index]] = [newRules[index], newRules[index - 1]]
    setRules(newRules)
    startTransition(async () => {
      await reorderRules(newRules.map(r => r.id))
    })
  }

  function handleMoveDown(index: number) {
    if (index === rules.length - 1) return
    const newRules = [...rules]
    ;[newRules[index], newRules[index + 1]] = [newRules[index + 1], newRules[index]]
    setRules(newRules)
    startTransition(async () => {
      await reorderRules(newRules.map(r => r.id))
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Autopilot Rules</h1>
          <p className="text-sm text-gray-400 mt-1">
            Rules are evaluated in priority order — first match wins
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Rule
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 flex flex-col gap-4">
          <p className="font-semibold text-white">New Rule</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Rule name (e.g. Skip small-cap stocks)"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Action</label>
              <select
                value={actionType}
                onChange={e => setActionType(e.target.value as AutopilotRule['action_type'])}
                className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="copy">Copy trade</option>
                <option value="skip">Skip</option>
                <option value="reduce">Reduce size</option>
                <option value="alert_only">Alert only</option>
              </select>
            </div>
            {(actionType === 'copy' || actionType === 'reduce') && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Sizing % (optional)</label>
                <input
                  type="number"
                  value={sizingPct}
                  onChange={e => setSizingPct(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Symbols (comma-separated)</label>
              <input
                value={symbols}
                onChange={e => setSymbols(e.target.value)}
                placeholder="e.g. AAPL, TSLA"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Asset classes</label>
              <input
                value={assetClasses}
                onChange={e => setAssetClasses(e.target.value)}
                placeholder="e.g. stock, crypto"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Min trader return (%)</label>
              <input
                type="number"
                value={minReturn}
                onChange={e => setMinReturn(e.target.value)}
                placeholder="e.g. 20"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Min CIO score (0–100)</label>
              <input
                type="number"
                value={minCioScore}
                onChange={e => setMinCioScore(e.target.value)}
                placeholder="e.g. 65"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={pending || !name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              Create Rule
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 rounded-lg bg-white/5 text-sm font-medium text-gray-300 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Zap className="h-10 w-10 mb-3 opacity-30" />
          <p>No autopilot rules</p>
          <p className="text-sm mt-1">Rules control how copy trades are evaluated and sized</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              className={cn(
                'rounded-xl border p-4',
                rule.is_active ? 'border-white/10 bg-white/5' : 'border-white/5 bg-white/2 opacity-60'
              )}
            >
              <div className="flex items-center gap-3">
                {/* Priority controls */}
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={pending || index === 0}
                    className="text-gray-600 hover:text-gray-400 disabled:opacity-20 transition-colors"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={pending || index === rules.length - 1}
                    className="text-gray-600 hover:text-gray-400 disabled:opacity-20 transition-colors"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>

                <span className="text-xs text-gray-600 font-mono w-5 shrink-0">#{index + 1}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-white truncate">{rule.name}</p>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', ACTION_COLORS[rule.action_type])}>
                      {ACTION_LABELS[rule.action_type]}
                    </span>
                    {rule.action_sizing_pct && (
                      <span className="text-xs text-gray-400 shrink-0">{rule.action_sizing_pct}%</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {rule.condition_symbols?.length ? (
                      <span className="text-xs text-gray-500">Symbols: {rule.condition_symbols.join(', ')}</span>
                    ) : null}
                    {rule.condition_asset_classes?.length ? (
                      <span className="text-xs text-gray-500">Classes: {rule.condition_asset_classes.join(', ')}</span>
                    ) : null}
                    {rule.condition_min_trader_return_pct != null ? (
                      <span className="text-xs text-gray-500">Min return: {rule.condition_min_trader_return_pct}%</span>
                    ) : null}
                    {rule.condition_min_cio_score != null ? (
                      <span className="text-xs text-gray-500">Min CIO score: {rule.condition_min_cio_score}</span>
                    ) : null}
                    {!rule.condition_symbols?.length && !rule.condition_asset_classes?.length &&
                     rule.condition_min_trader_return_pct == null && rule.condition_min_cio_score == null && (
                      <span className="text-xs text-gray-600 italic">Matches all trades</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleToggle(rule.id, rule.is_active)}
                  disabled={pending}
                  className={cn('shrink-0 transition-colors', rule.is_active ? 'text-indigo-400' : 'text-gray-600')}
                >
                  {rule.is_active ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                </button>

                <button
                  onClick={() => handleDelete(rule.id)}
                  disabled={pending}
                  className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
