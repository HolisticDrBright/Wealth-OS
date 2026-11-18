/**
 * App-wide 404 (Phase 1.5).
 */
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07080c] p-6">
      <div className="text-center">
        <p className="text-5xl font-bold text-white/20">404</p>
        <h1 className="mt-3 text-sm font-semibold text-gray-200">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-xs text-gray-500">
          The link may be old, or the page may have moved.
        </p>
        <div className="mt-5 flex justify-center gap-3 text-xs">
          <Link href="/dashboard" className="rounded bg-white/10 px-4 py-1.5 font-semibold text-white hover:bg-white/20">
            Go to dashboard
          </Link>
          <Link href="/" className="rounded border border-white/10 px-4 py-1.5 text-gray-300 hover:bg-white/5">
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
