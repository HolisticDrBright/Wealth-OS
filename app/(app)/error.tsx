'use client' // Error boundaries must be Client Components

/**
 * Route-group error boundary (Phase 1.5) — a thrown render/data error on an
 * authenticated page shows this instead of a blank screen. The money-safety
 * note matters for a trading app: a UI crash never changes positions.
 */

import { useEffect } from 'react'
import { AlertOctagon } from 'lucide-react'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[app error boundary]', error)
  }, [error])

  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center">
        <AlertOctagon className="mx-auto h-8 w-8 text-red-400" />
        <h2 className="mt-3 text-sm font-bold text-red-300">Something went wrong on this page</h2>
        <p className="mt-2 text-xs text-gray-400">
          This is a display error only — your positions, limits and the kill switch are unaffected.
        </p>
        {error.digest && (
          <p className="mt-1 text-[10px] text-gray-600">Error reference: {error.digest}</p>
        )}
        <button
          onClick={() => unstable_retry()}
          className="mt-4 rounded bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
