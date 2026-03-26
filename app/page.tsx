import Link from 'next/link'
import { DollarSign, TrendingUp, Shield, Brain, ArrowRight } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#07080c] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold">Wealth OS</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-8 pt-24 pb-16 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs text-indigo-400">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          Your Financial Command Center
        </div>
        <h1 className="max-w-3xl text-5xl font-bold leading-tight tracking-tight">
          Take Control of Your{' '}
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Financial Future
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-gray-400">
          Track your wealth, optimize your investments, manage budgets, plan for goals,
          and get AI-powered tax strategies — all in one powerful dashboard.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <Link
            href="/signup"
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Start for Free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-gray-300 hover:bg-white/5 transition-colors"
          >
            View Demo
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-8 py-16">
        <div className="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: DollarSign,
              title: 'Net Worth Tracking',
              description: 'Monitor all your assets and liabilities with real-time updates and historical trends.',
              color: 'text-indigo-400',
              bg: 'bg-indigo-500/10',
            },
            {
              icon: TrendingUp,
              title: 'Portfolio Intelligence',
              description: 'Track stocks, crypto, real estate, and more with performance analytics.',
              color: 'text-purple-400',
              bg: 'bg-purple-500/10',
            },
            {
              icon: Shield,
              title: 'Budget & Goals',
              description: 'Set spending limits, track categories, and work toward financial milestones.',
              color: 'text-emerald-400',
              bg: 'bg-emerald-500/10',
            },
            {
              icon: Brain,
              title: 'AI Tax Advisor',
              description: 'Get personalized strategies to minimize taxes and maximize after-tax returns.',
              color: 'text-amber-400',
              bg: 'bg-amber-500/10',
            },
          ].map(({ icon: Icon, title, description, color, bg }) => (
            <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${bg} mb-4`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-8 py-6 text-center text-xs text-gray-600">
        © 2026 Wealth OS. Built to help you build wealth.
      </footer>
    </div>
  )
}
