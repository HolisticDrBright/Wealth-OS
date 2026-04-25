// TODO(Phase 2f): this modal is currently triggered on first strategy enable as a placeholder.
// It should instead trigger on the paper→live mode switch once the trading-mode framework
// lands in Phase 2f. Strategy on/off in paper mode is not a real-money event.
'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface Props {
  onConfirm: () => void
  onCancel: () => void
}

export function JurisdictionModal({ onConfirm, onCancel }: Props) {
  const [checked, setChecked] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1117] p-6 shadow-2xl">
        {/* Close */}
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Icon */}
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
        </div>

        {/* Title */}
        <h2 className="text-lg font-bold text-white">Jurisdiction acknowledgement</h2>

        {/* Body */}
        <div className="mt-3 space-y-3 text-sm text-gray-400">
          <p>
            Live trading on Polymarket is{' '}
            <span className="font-semibold text-amber-400">
              not available to US persons
            </span>{' '}
            per Polymarket&apos;s Terms of Service.
          </p>
          <p>
            Strategy toggles affect the sidecar scheduler in real time. When the
            system is in live mode (<code className="rounded bg-white/5 px-1 text-gray-300">PAPER_TRADING=false</code>),
            enabling a strategy may result in real orders being placed on the
            Polymarket CLOB.
          </p>
          <p>
            Users are solely responsible for determining whether live trading on
            prediction markets is legal in their jurisdiction.
          </p>
        </div>

        {/* Checkbox */}
        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-white/20 bg-white/5 accent-indigo-500"
          />
          <span className="text-sm text-gray-300">
            I confirm I am not a US person and that live trading on prediction
            markets is lawful in my jurisdiction.
          </span>
        </label>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!checked}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Acknowledge &amp; continue
          </button>
        </div>
      </div>
    </div>
  )
}
