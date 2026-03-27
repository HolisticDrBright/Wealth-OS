import { notFound } from 'next/navigation'
import { getSleeve, getSleeveApprovals } from '@/lib/actions/sleeves'
import { SleeveDetailClient } from './sleeve-detail-client'

interface Props { params: Promise<{ id: string }> }

export default async function SleeveDetailPage({ params }: Props) {
  const { id } = await params
  const [sleeve, approvals] = await Promise.all([
    getSleeve(id),
    getSleeveApprovals(id),
  ])
  if (!sleeve) notFound()
  return <SleeveDetailClient sleeve={sleeve} allApprovals={approvals} />
}
