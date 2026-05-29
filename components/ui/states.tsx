/**
 * Polished, reusable panel states: loading skeleton, empty, error, and
 * missing-integration. Language is non-technical and always points to a next
 * action. Use these instead of ad-hoc "No data" text so every panel feels
 * intentional rather than broken.
 */
import { cn } from '@/lib/utils'
import { Inbox, AlertTriangle, PlugZap, RefreshCw, type LucideIcon } from 'lucide-react'

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-white/15 px-6 py-10 text-center', className)}>
      {children}
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox, title, hint, action, className,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Shell className={className}>
      <Icon className="mb-3 h-8 w-8 text-gray-600" />
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-gray-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Shell>
  )
}

export function ErrorState({
  title = 'Something went wrong', message, onRetry, className,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <Shell className={cn('border-red-500/20', className)}>
      <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
      <p className="text-sm font-medium text-red-300">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs text-gray-500">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </Shell>
  )
}

export function MissingIntegrationState({
  title = 'Connect an integration', message, action, className,
}: {
  title?: string
  message?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Shell className={cn('border-sky-500/20', className)}>
      <PlugZap className="mb-3 h-8 w-8 text-sky-400" />
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs text-gray-500">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Shell>
  )
}

export function LoadingSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  )
}

/** Small inline "insufficient data" note for metric cells/panels. */
export function InsufficientData({ label = 'Insufficient data', className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-gray-600', className)}>
      <span className="h-1 w-1 rounded-full bg-gray-600" /> {label}
    </span>
  )
}
