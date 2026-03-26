'use client'

import { useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import type { Asset, Transaction, Goal } from '@/lib/types'
import {
  Sparkles,
  RefreshCw,
  FileText,
  TrendingDown,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  Info,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Brain,
} from 'lucide-react'

interface Props {
  assets: Asset[]
  transactions: Transaction[]
  goals: Goal[]
}

function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let key = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key++} className="text-lg font-bold text-white mt-6 mb-2 first:mt-0">
          {line.slice(3)}
        </h2>
      )
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={key++} className="text-base font-semibold text-indigo-300 mt-4 mb-1">
          {line.slice(4)}
        </h3>
      )
    } else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      elements.push(
        <p key={key++} className="text-sm font-semibold text-white mt-3 mb-1">
          {line.slice(2, -2)}
        </p>
      )
    } else if (/^\d+\.\s/.test(line)) {
      const parts = line.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      elements.push(
        <div key={key++} className="flex gap-2 text-sm text-gray-300 my-1.5">
          <span className="text-indigo-400 font-semibold shrink-0">{line.match(/^\d+/)?.[0]}.</span>
          <span dangerouslySetInnerHTML={{ __html: parts.replace(/^\d+\.\s/, '') }} />
        </div>
      )
    } else if (line.startsWith('- ')) {
      const parts = line.slice(2).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      elements.push(
        <div key={key++} className="flex gap-2 text-sm text-gray-300 my-1">
          <span className="text-indigo-400 shrink-0 mt-0.5">•</span>
          <span dangerouslySetInnerHTML={{ __html: parts }} />
        </div>
      )
    } else if (line.trim() === '' || line === '---') {
      elements.push(<div key={key++} className="h-2" />)
    } else if (line.trim()) {
      const parts = line.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      elements.push(
        <p key={key++} className="text-sm text-gray-300 my-1 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: parts }} />
      )
    }
  }

  return <div className="space-y-0.5">{elements}</div>
}

export default function TaxClient({ assets, transactions, goals }: Props) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const totalAssetValue = assets.reduce((s, a) => s + (a.current_value ?? 0), 0)
  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0)
  const totalExpenses = transactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0)

  const assetsByCategory = assets.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + (a.current_value ?? 0)
    return acc
  }, {} as Record<string, number>)

  const runAnalysis = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setAnalysis('')
    setError(null)
    setHasRun(true)

    try {
      const res = await fetch('/api/tax-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets, transactions, goals }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setAnalysis(prev => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to generate analysis')
    } finally {
      setLoading(false)
    }
  }, [assets, transactions, goals])

  return (
    <div className="p-6 space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Portfolio Value</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">{formatCurrency(totalAssetValue)}</p>
          <p className="mt-1 text-xs text-gray-500">{assets.length} assets tracked</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Tracked Income</p>
          <p className="mt-2 text-2xl font-bold text-indigo-400">{formatCurrency(totalIncome)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {formatCurrency(totalExpenses)} in tracked expenses
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Financial Goals</p>
          <p className="mt-2 text-2xl font-bold text-white">{goals.length}</p>
          <p className="mt-1 text-xs text-gray-500">goals being tracked</p>
        </Card>
      </div>

      {/* Asset Breakdown */}
      {Object.keys(assetsByCategory).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Breakdown</CardTitle>
            <CardDescription>Assets analyzed for tax optimization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(assetsByCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, val]) => (
                  <div key={cat} className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-400 capitalize">{cat.replace('_', ' ')}</p>
                    <p className="mt-1 text-sm font-semibold text-white">{formatCurrency(val)}</p>
                    <p className="text-xs text-gray-500">
                      {((val / totalAssetValue) * 100).toFixed(1)}% of portfolio
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Analysis Section */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-indigo-400" />
                AI Tax Analysis
              </CardTitle>
              <CardDescription>
                Powered by Claude Opus — analyzes your real portfolio and goals
              </CardDescription>
            </div>
            <Button
              onClick={runAnalysis}
              disabled={loading}
              className="shrink-0"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {hasRun ? 'Regenerate Analysis' : 'Generate AI Analysis'}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!hasRun && !loading && (
            <div className="rounded-xl border border-dashed border-white/20 p-8 text-center">
              <Brain className="h-10 w-10 text-indigo-400/50 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-300">Ready to analyze your finances</p>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Claude will analyze your {assets.length} assets, {transactions.length} transactions,
                and {goals.length} financial goals to generate personalized tax strategies.
              </p>
              <Button onClick={runAnalysis} className="mt-4">
                <Sparkles className="h-4 w-4 mr-2" />
                Generate AI Analysis
              </Button>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-400">Analysis failed</p>
                <p className="text-xs text-gray-400 mt-1">{error}</p>
                {error.includes('not configured') && (
                  <p className="text-xs text-gray-500 mt-2">
                    Add <code className="bg-white/10 px-1 rounded">ANTHROPIC_API_KEY</code> to your{' '}
                    <code className="bg-white/10 px-1 rounded">.env.local</code> and Vercel environment variables.
                  </p>
                )}
              </div>
            </div>
          )}

          {(loading || analysis) && (
            <div className="space-y-2">
              {loading && !analysis && (
                <div className="flex items-center gap-2 text-sm text-indigo-400">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Claude is thinking through your tax situation...
                </div>
              )}
              {analysis && (
                <div className="rounded-xl bg-white/5 border border-white/10 p-5">
                  <MarkdownRenderer content={analysis} />
                  {loading && (
                    <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle rounded-sm" />
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deadlines Banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
        <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-400">2026 Tax Deadlines</p>
          <p className="text-xs text-gray-400 mt-1">
            Q1 estimated taxes due <strong className="text-white">April 15, 2026</strong> &bull;{' '}
            IRA contribution deadline (2025): <strong className="text-white">April 15, 2026</strong> &bull;{' '}
            HSA contribution deadline: <strong className="text-white">April 15, 2026</strong>
          </p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500 leading-relaxed">
          AI-generated tax analysis is for educational purposes only. Tax laws are complex and change frequently.
          Consult a qualified CPA or tax professional before implementing any strategy. Individual results will vary.
        </p>
      </div>
    </div>
  )
}
