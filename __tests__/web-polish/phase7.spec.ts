/**
 * Phase 7 — web polish.
 *  1. cyan accent (not indigo) on the logo, landing, login and signup, with
 *     dark text wherever text sits on cyan,
 *  2. hardcoded colour classes replaced by globals.css tokens,
 *  3. topbar search removed, bell wired to /alerts with a real unread badge,
 *     avatar shows the real user's initials,
 *  4. no text below 12px,
 *  5. ▲/▼ next to every gain and loss figure.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrendArrow } from '@/components/ui/trend-arrow'
import { initialsOf } from '@/lib/ui/initials'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, ...p.split('/')), 'utf8')

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel))
    else if (name.endsWith('.tsx')) out.push(rel)
  }
  return out
}
const UI_FILES = [...tsxFiles('app'), ...tsxFiles('components')]

// ─── 1. Cyan accent ──────────────────────────────────────────────────────────

describe('cyan accent on logo, landing, login, signup', () => {
  const FILES = ['app/page.tsx', 'app/login/page.tsx', 'app/signup/page.tsx', 'components/layout/sidebar.tsx', 'components/layout/topbar.tsx']

  it.each(FILES)('%s has no indigo accents left', (f) => {
    expect(read(f)).not.toMatch(/indigo-/)
  })

  it.each(FILES)('%s never puts white text on cyan (contrast)', (f) => {
    for (const m of read(f).matchAll(/className="([^"]*\bbg-accent-cyan\b[^"]*)"/g)) {
      expect(m[1]).not.toMatch(/\btext-white\b/)
    }
  })
})

// ─── 2. Tokens ───────────────────────────────────────────────────────────────

describe('hardcoded colour classes replaced by globals.css tokens', () => {
  it('globals.css defines the fill token (raw + theme)', () => {
    const css = read('app/globals.css')
    expect(css.match(/--color-fill:/g)?.length).toBe(2)
  })

  it('no bg-[#07080c], white/10 or gray-400 classes remain in app/ or components/', () => {
    const offenders = UI_FILES.filter(f => /bg-\[#07080c\]|\bwhite\/10\b|\bgray-400\b/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

// ─── 3. Topbar ───────────────────────────────────────────────────────────────

describe('topbar', () => {
  const src = read('components/layout/topbar.tsx')

  it('the dead search button is gone', () => {
    expect(src).not.toMatch(/\bSearch\b/)
  })

  it('the bell links to /alerts and only badges when there are unread alerts', () => {
    expect(src).toContain('href="/alerts"')
    expect(src).toContain('unread > 0 &&')
    expect(src).toMatch(/aria-label=\{bellLabel\}/)
  })

  it('the avatar shows real initials and links to settings (no hardcoded "W")', () => {
    expect(src).not.toMatch(/>\s*W\s*</)
    expect(src).toContain('{info.initials}')
    expect(src).toContain('href="/settings"')
  })

  it('initialsOf handles names, single words, and emails', () => {
    expect(initialsOf('Jane Smith')).toBe('JS')
    expect(initialsOf('Jane Q Smith')).toBe('JS')
    expect(initialsOf('madonna')).toBe('MA')
    expect(initialsOf('jane.smith@example.com')).toBe('JS')
    expect(initialsOf('   ')).toBe('?')
  })
})

// ─── 4. Minimum text size ────────────────────────────────────────────────────

describe('no text below 12px', () => {
  it('no 9/10/11px Tailwind sizes and no inline font sizes under 12', () => {
    const offenders = UI_FILES.filter(f =>
      /text-\[(9|10|11)px\]/.test(read(f)) || /fontSize: ?(9|10|11)\b/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

// ─── 5. Gain/loss arrows ─────────────────────────────────────────────────────

describe('TrendArrow', () => {
  const html = (value: number | null | undefined) => renderToStaticMarkup(createElement(TrendArrow, { value }))

  it('▲ for gains, ▼ for losses, with a spoken word for screen readers', () => {
    expect(html(12.5)).toContain('▲')
    expect(html(12.5)).toContain('up ')
    expect(html(-3)).toContain('▼')
    expect(html(-3)).toContain('down ')
  })

  it('the glyph itself is hidden from screen readers', () => {
    expect(html(1)).toMatch(/aria-hidden="true"[^>]*>▲/)
  })

  it('renders nothing for zero, null, undefined or non-finite values', () => {
    for (const v of [0, null, undefined, NaN, Infinity]) expect(html(v)).toBe('')
  })
})

describe('every gain/loss figure carries an arrow', () => {
  const SITES = [
    'components/layout/risk-strip.tsx',
    'app/(app)/options/options-client.tsx',
    'app/(app)/marketplace/marketplace-client.tsx',
    'app/(app)/marketplace/[id]/marketplace-listing-client.tsx',
    'app/(app)/sleeves/sleeves-client.tsx',
    'app/(app)/sleeves/[id]/sleeve-detail-client.tsx',
    'app/(app)/risk/risk-client.tsx',
    'app/(app)/paper-trading/paper-validation-client.tsx',
    'app/(app)/strategies/[id]/strategy-detail-client.tsx',
    'app/(app)/strategies/health-board-client.tsx',
    'app/(app)/crypto/crypto-client.tsx',
    'app/(app)/portfolio/portfolio-client.tsx',
    'app/(app)/settings/integrations/page.tsx',
    'app/(app)/learning/learning-client.tsx',
    'app/(app)/shadow-portfolio/shadow-portfolio-client.tsx',
    'app/(app)/autopilot/autopilot-client.tsx',
    'app/(app)/dashboard/command-center/EquityCurvePanel.tsx',
    'app/(app)/dashboard/command-center/PaperTradesPanel.tsx',
    'app/(app)/dashboard/command-center/ShadowPortfolioPanel.tsx',
    'app/(app)/dashboard/command-center/TradeTapePanel.tsx',
    'app/(app)/dashboard/command-center/RiskStatusPanel.tsx',
    'components/trading/AssetStrategyPanel.tsx',
    'components/polymarket/positions-tab.tsx',
  ]

  it.each(SITES)('%s renders TrendArrow', (f) => {
    expect(read(f)).toMatch(/<TrendArrow value=/)
  })
})
