'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, TrendingUp, Settings, LogOut, ChevronRight, ChevronDown,
  DollarSign, Users, Zap, Activity, Lightbulb, ShieldAlert, Bell, RefreshCw,
  PiggyBank, ShoppingCart, BarChart2, Bitcoin, Globe, Scale, ListChecks, Leaf,
  Store, FlaskConical, Home, Briefcase, Layers, Sigma, Brain, Wallet, Target,
  FileText, CandlestickChart, Crosshair, Ghost, Menu, X, Sparkles, NotebookPen,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UiMode } from '@/lib/actions/ui-prefs'

// ─── Navigation model ───────────────────────────────────────────────────────
// Phase 2.4: the old Portfolio group is split into "Portfolio" (holdings and
// trading) and "Planning" (budget, planning, retirement, tax, household), the
// orphaned /paper-trading and /settings/ai-features pages are linked, and the
// whole rail collapses to a drawer below the md breakpoint.

interface NavLeaf { href: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; icon: LucideIcon; href?: string; children: NavLeaf[] }
type NavNode = NavLeaf | NavGroup

function isGroup(n: NavNode): n is NavGroup {
  return (n as NavGroup).children !== undefined
}

const NAV: NavNode[] = [
  { href: '/dashboard', label: 'Command Center', icon: LayoutDashboard },
  {
    label: 'Portfolio', icon: TrendingUp, href: '/portfolio',
    children: [
      { href: '/rebalance', label: 'Rebalance', icon: RefreshCw },
      { href: '/sleeves', label: 'Sleeves', icon: Layers },
      { href: '/paper-trading', label: 'Paper Trading', icon: NotebookPen },
      { href: '/advisor', label: 'Advisor', icon: Briefcase },
    ],
  },
  {
    label: 'Planning', icon: Target, href: '/planning',
    children: [
      { href: '/budget', label: 'Budget', icon: Wallet },
      { href: '/retirement', label: 'Retirement', icon: PiggyBank },
      { href: '/tax', label: 'Tax Advisor', icon: FileText },
      { href: '/tax/harvest', label: 'Tax Harvest', icon: Leaf },
      { href: '/household', label: 'Family Office', icon: Home },
    ],
  },
  {
    label: 'Opportunities', icon: Lightbulb, href: '/opportunities',
    children: [
      { href: '/orders', label: 'Orders', icon: ShoppingCart },
      { href: '/traders', label: 'Top Traders', icon: Users },
      { href: '/marketplace', label: 'Marketplace', icon: Store },
      { href: '/feed', label: 'Live Feed', icon: Activity },
    ],
  },
  {
    label: 'Strategies', icon: BarChart2, href: '/strategies',
    children: [
      { href: '/strategies/readiness', label: 'Readiness', icon: ListChecks },
      { href: '/strategies/committee', label: 'AI committee', icon: Brain },
      { href: '/backtests', label: 'Backtests', icon: FlaskConical },
      { href: '/shadow-portfolio', label: 'Shadow Portfolio', icon: Ghost },
      { href: '/autopilot', label: 'Autopilot', icon: Zap },
      { href: '/autopilot/rules', label: 'Rules', icon: ListChecks },
    ],
  },
  {
    label: 'Markets', icon: CandlestickChart,
    children: [
      { href: '/stocks', label: 'Stocks', icon: TrendingUp },
      { href: '/options', label: 'Options', icon: Sigma },
      { href: '/crypto', label: 'Crypto', icon: Bitcoin },
      { href: '/forex', label: 'Forex', icon: Globe },
      { href: '/polymarket', label: 'Polymarket', icon: Scale },
    ],
  },
  { href: '/risk', label: 'Risk Room', icon: ShieldAlert },
  {
    label: 'Learning', icon: Brain, href: '/learning',
    children: [
      { href: '/calibration', label: 'Calibration', icon: Crosshair },
    ],
  },
  { href: '/alerts', label: 'Alerts', icon: Bell },
]

// Phase 3.3: simple mode shows ONLY these six destinations. Everything else
// stays reachable in pro mode.
const SIMPLE_NAV: NavNode[] = [
  { href: '/dashboard',     label: 'Home',      icon: Home },
  { href: '/advisor',       label: 'Goals',     icon: Target },
  { href: '/portfolio',     label: 'Portfolio', icon: TrendingUp },
  { href: '/paper-trading', label: 'Activity',  icon: Activity },
  { href: '/traders',       label: 'Explore',   icon: Users },
]

const ACTIVE_STYLE = {
  background: 'color-mix(in oklch, var(--color-accent-cyan) 8%, transparent)',
  boxShadow: 'inset 3px 0 0 var(--color-accent-cyan), 0 0 12px color-mix(in oklch, var(--color-accent-cyan) 20%, transparent)',
} as const

function pathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

/** Desktop rail: hidden below md (the drawer takes over there). */
export function Sidebar({ uiMode = 'pro' }: { uiMode?: UiMode }) {
  return (
    <aside className="hidden h-screen w-64 flex-col border-r border-line-strong bg-bg-0 md:flex">
      <SidebarContent uiMode={uiMode} />
    </aside>
  )
}

/**
 * Mobile navigation (below md): a slim top bar with a menu button that opens
 * the same navigation as a slide-over drawer.
 */
export function MobileNav({ uiMode = 'pro' }: { uiMode?: UiMode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="md:hidden">
      <div className="flex items-center gap-3 border-b border-line-strong bg-bg-0 px-4 py-2.5">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong text-gray-300 hover:bg-white/5"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-cyan">
          <DollarSign className="h-4 w-4 text-bg-0" />
        </div>
        <span className="text-sm font-bold text-white">Wealth OS</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <aside className="flex h-full w-72 max-w-[85vw] flex-col border-r border-line-strong bg-bg-0">
            <SidebarContent uiMode={uiMode} onNavigate={() => setOpen(false)} />
          </aside>
          <button
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="flex-1 bg-black/60"
          />
          <button
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg bg-fill text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  )
}

function SidebarContent({ uiMode = 'pro', onNavigate }: { uiMode?: UiMode; onNavigate?: () => void }) {
  const pathname = usePathname()
  const nav = uiMode === 'simple' ? SIMPLE_NAV : NAV

  // A group starts expanded when it contains (or is) the active route.
  const groupContainsActive = (g: NavGroup) =>
    (g.href ? pathActive(pathname, g.href) : false) ||
    g.children.some(c => pathActive(pathname, c.href))

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const n of nav) if (isGroup(n)) init[n.label] = groupContainsActive(n)
    return init
  })

  const toggle = (label: string) => setOpen(o => ({ ...o, [label]: !o[label] }))

  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-line-strong">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-cyan">
          <DollarSign className="h-5 w-5 text-bg-0" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">Wealth OS</p>
          <p className="truncate text-xs text-gray-500">Capital Command Center</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {nav.map(node => {
          if (!isGroup(node)) {
            const active = pathActive(pathname, node.href)
            return <TopLink key={node.href} href={node.href} label={node.label} icon={node.icon} active={active} onNavigate={onNavigate} />
          }

          const expanded = open[node.label] ?? false
          const selfActive = node.href ? pathActive(pathname, node.href) : false
          const Icon = node.icon

          return (
            <div key={node.label}>
              {/* Group header: navigates if it has an href; chevron toggles children. */}
              <div
                className={cn(
                  'group flex items-center rounded-lg text-sm font-medium transition-all',
                  selfActive ? 'text-accent-cyan' : 'text-text-1 hover:bg-white/5 hover:text-white',
                )}
                style={selfActive ? ACTIVE_STYLE : undefined}
              >
                {node.href ? (
                  <Link href={node.href} onClick={onNavigate} className="flex flex-1 items-center gap-3 px-3 py-2.5">
                    <Icon className={cn('h-4 w-4 shrink-0', selfActive ? 'text-accent-cyan' : 'text-gray-500 group-hover:text-white')} />
                    <span className="truncate">{node.label}</span>
                  </Link>
                ) : (
                  <button onClick={() => toggle(node.label)} className="flex flex-1 items-center gap-3 px-3 py-2.5 text-left">
                    <Icon className="h-4 w-4 shrink-0 text-gray-500 group-hover:text-white" />
                    <span className="truncate">{node.label}</span>
                  </button>
                )}
                <button
                  onClick={() => toggle(node.label)}
                  aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
                  className="px-2 py-2.5 text-gray-600 hover:text-white"
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              </div>

              {/* Children */}
              {expanded && (
                <div className="mt-0.5 ml-4 space-y-0.5 border-l border-line-strong pl-2">
                  {node.children.map(child => {
                    const active = pathActive(pathname, child.href)
                    const ChildIcon = child.icon
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                          active ? 'text-accent-cyan' : 'text-gray-500 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <ChildIcon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-accent-cyan' : 'text-gray-600')} />
                        <span className="truncate">{child.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="space-y-0.5 border-t border-line-strong px-3 py-4">
        <FooterLink href="/settings" label="Settings" icon={Settings} onNavigate={onNavigate} />
        {uiMode !== 'simple' && (
          <>
            <FooterLink href="/settings/ai-features" label="AI Features" icon={Sparkles} onNavigate={onNavigate} />
            <FooterLink href="/settings/integrations" label="Integrations" icon={Settings} dim onNavigate={onNavigate} />
          </>
        )}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-1 transition-all hover:bg-white/5 hover:text-red-400"
          >
            <LogOut className="h-4 w-4 text-gray-500" />
            Sign Out
          </button>
        </form>
      </div>
    </>
  )
}

function TopLink({ href, label, icon: Icon, active, onNavigate }: {
  href: string; label: string; icon: LucideIcon; active: boolean; onNavigate?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
        active ? 'text-accent-cyan' : 'text-text-1 hover:bg-white/5 hover:text-white',
      )}
      style={active ? ACTIVE_STYLE : undefined}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent-cyan' : 'text-gray-500 group-hover:text-white')} />
      <span className="truncate">{label}</span>
      {active && <ChevronRight className="ml-auto h-3 w-3 text-accent-cyan" />}
    </Link>
  )
}

function FooterLink({ href, label, icon: Icon, dim, onNavigate }: {
  href: string; label: string; icon: LucideIcon; dim?: boolean; onNavigate?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-1 transition-all hover:bg-white/5 hover:text-white"
    >
      <Icon className={cn('h-4 w-4 text-gray-500', dim && 'opacity-50')} />
      {label}
    </Link>
  )
}
