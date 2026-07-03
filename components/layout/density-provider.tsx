'use client'

/**
 * Density context — "one data layer, two skins". Advisor mode is the default
 * card look; Terminal mode applies a dense mono Bloomberg-style treatment via
 * a data attribute + utility classes on the content wrapper. Same components,
 * no route changes. The choice persists per user (user_ui_prefs).
 */

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { setUiDensity, type UiDensity } from '@/lib/actions/ui-prefs'

const DensityContext = createContext<{ density: UiDensity; toggle: () => void }>({
  density: 'advisor',
  toggle: () => {},
})

export function useDensity() {
  return useContext(DensityContext)
}

export function DensityProvider({
  initialDensity,
  children,
}: {
  initialDensity: UiDensity
  children: ReactNode
}) {
  const [density, setDensity] = useState<UiDensity>(initialDensity)
  const [, startTransition] = useTransition()

  const toggle = () => {
    const next: UiDensity = density === 'advisor' ? 'terminal' : 'advisor'
    setDensity(next)
    startTransition(async () => { await setUiDensity(next) })
  }

  return (
    <DensityContext.Provider value={{ density, toggle }}>
      <div
        data-density={density}
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          density === 'terminal' && 'font-mono text-[13px] tracking-tight',
        )}
      >
        {children}
      </div>
    </DensityContext.Provider>
  )
}

/** Compact toggle for the risk strip / headers. */
export function DensityToggle() {
  const { density, toggle } = useDensity()
  return (
    <button
      onClick={toggle}
      title="Switch between Advisor (cards) and Terminal (dense) layouts"
      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:bg-white/5 hover:text-gray-200"
    >
      {density === 'advisor' ? 'Advisor' : 'Terminal'}
    </button>
  )
}
