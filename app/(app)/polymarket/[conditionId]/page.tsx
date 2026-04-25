export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getMarket } from '@/lib/meta-poly/client'
import { MarketDetailClient } from './market-detail-client'
import { Topbar } from '@/components/layout/topbar'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

interface Props {
  params: Promise<{ conditionId: string }>
}

export default async function MarketDetailPage({ params }: Props) {
  const { conditionId } = await params
  const marketRes = await getMarket(decodeURIComponent(conditionId))

  if (!marketRes.ok) {
    if (marketRes.error.code === 'HTTP_404') notFound()
    return (
      <div className="flex flex-col">
        <Topbar title="Market" subtitle="Polymarket" />
        <div className="p-6">
          <Link
            href="/polymarket"
            className="mb-4 flex w-fit items-center gap-1.5 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Back to markets
          </Link>
          <p className="text-sm text-red-400">{marketRes.error.message}</p>
        </div>
      </div>
    )
  }

  return <MarketDetailClient market={marketRes.value} />
}
