import { Sidebar } from '@/components/layout/sidebar'
import { RiskStrip } from '@/components/layout/risk-strip'
import { DensityProvider } from '@/components/layout/density-provider'
import { getUiDensity } from '@/lib/actions/ui-prefs'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const density = await getUiDensity()
  return (
    <div className="flex h-screen overflow-hidden bg-[#07080c]">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <DensityProvider initialDensity={density}>
          {/* Widgets 1+3: risk strip + Flatten & Halt on EVERY authenticated page */}
          <RiskStrip />
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </DensityProvider>
      </main>
    </div>
  )
}
