'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DollarSign, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkEmail, setCheckEmail] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) {
      setError(error.message)
    } else if (!data.session) {
      // Email confirmation is on: no session yet — tell them to check their inbox.
      setCheckEmail(true)
    } else {
      // Signed in immediately: first-time users go to onboarding, not the dashboard.
      router.push('/onboarding/risk-profile')
    }
    setLoading(false)
  }

  if (checkEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center">
          <div className="mb-4 flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-emerald-500/20">
            <span className="text-3xl">✉️</span>
          </div>
          <h2 className="text-xl font-bold text-white">Check your email</h2>
          <p className="mt-2 text-sm text-text-1">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Open it to activate your account, then sign in — we&apos;ll set up your first goal from there.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm text-accent-cyan hover:underline">
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-cyan mb-4">
            <DollarSign className="h-6 w-6 text-bg-0" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-text-1">Start your journey to financial freedom</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-1">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-line-strong bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-lg border border-line-strong bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min. 8 characters"
                className="w-full rounded-lg border border-line-strong bg-white/5 px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent-cyan py-2.5 text-sm font-semibold text-bg-0 hover:brightness-110 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-accent-cyan hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
