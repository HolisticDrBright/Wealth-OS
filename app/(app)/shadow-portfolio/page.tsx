import { Suspense } from 'react'
import { getShadowPortfolio } from '@/lib/actions/shadow-portfolio'
import { ShadowPortfolioClient } from './shadow-portfolio-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Shadow Portfolio · Wealth OS' }

export default async function ShadowPortfolioPage() {
  const data = await getShadowPortfolio(100)
  return (
    <Suspense>
      <ShadowPortfolioClient data={data} />
    </Suspense>
  )
}
