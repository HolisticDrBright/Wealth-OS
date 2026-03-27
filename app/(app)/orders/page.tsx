import { OrdersClient } from './orders-client'
import { getOrders } from '@/lib/actions/orders'

export default async function OrdersPage() {
  const orders = await getOrders()
  return <OrdersClient initialOrders={orders} />
}
