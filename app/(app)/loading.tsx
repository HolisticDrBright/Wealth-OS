/**
 * Route-group loading state (Phase 1.5) — shown instantly while any
 * authenticated page's server components stream in.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" aria-hidden />
        Loading…
      </div>
    </div>
  )
}
