import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { Leaf, Scale, ArrowRightCircle } from 'lucide-react'
import type { TaxLossSummary } from '@/lib/actions/tax-ledger'

/**
 * Tax-loss carryforward summary: current-year harvested losses, the amount
 * usable this year (gains offset + $3k ordinary income cap), and the
 * carryforward into next year with ST/LT character preserved.
 */
export function TaxLossSummaryCard({ summary }: { summary: TaxLossSummary }) {
  return (
    <div className="px-6 pt-6">
      <Card>
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Tax-Loss Harvesting — {summary.taxYear}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
                <Leaf className="h-3.5 w-3.5 text-emerald-400" />
                Harvested This Year
              </div>
              <p className="mt-2 text-2xl font-bold text-emerald-400">
                {formatCurrency(summary.currentYearHarvestedUsd)}
              </p>
              <p className="mt-1 text-xs text-gray-500">realized losses banked</p>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
                <Scale className="h-3.5 w-3.5 text-indigo-400" />
                Usable This Year
              </div>
              <p className="mt-2 text-2xl font-bold text-white">
                {formatCurrency(summary.usableThisYearUsd)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {formatCurrency(summary.usedAgainstGainsUsd)} vs gains · {formatCurrency(summary.usedAgainstIncomeUsd)} vs income (max $3,000)
              </p>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
                <ArrowRightCircle className="h-3.5 w-3.5 text-amber-400" />
                Carryforward
              </div>
              <p className="mt-2 text-2xl font-bold text-amber-400">
                {formatCurrency(summary.carryforwardUsd)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {formatCurrency(summary.carryforwardShortTermUsd)} short-term · {formatCurrency(summary.carryforwardLongTermUsd)} long-term
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
