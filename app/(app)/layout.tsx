import { Sidebar, MobileNav } from '@/components/layout/sidebar'
import { RiskStrip } from '@/components/layout/risk-strip'
import { ScanHealthBanner } from '@/components/layout/scan-health-banner'
import { DensityProvider } from '@/components/layout/density-provider'
import { getUiDensity, getUiMode } from '@/lib/actions/ui-prefs'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [density, uiMode] = await Promise.all([getUiDensity(), getUiMode()])
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar uiMode={uiMode} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <DensityProvider initialDensity={density}>
          {/* Below md the sidebar collapses to this drawer trigger */}
          <MobileNav uiMode={uiMode} />
          {/* Widgets 1+3: risk strip + Flatten & Halt on EVERY authenticated page */}
          <RiskStrip uiMode={uiMode} />
          {/* Phase 6: stale-scan banner (market hours only) */}
          <ScanHealthBanner uiMode={uiMode} />
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </DensityProvider>
      </main>
    </div>
  )
}
