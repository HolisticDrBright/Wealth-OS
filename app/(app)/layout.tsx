import { Sidebar } from '@/components/layout/sidebar'
import { RiskStrip } from '@/components/layout/risk-strip'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#07080c]">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Widgets 1+3: risk strip + Flatten & Halt on EVERY authenticated page */}
        <RiskStrip />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
