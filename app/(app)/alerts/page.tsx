import { getAlerts, getUnreadAlertCount } from '@/lib/actions/alerts'
import { AlertsClient } from './alerts-client'

export default async function AlertsPage() {
  const [alerts, unreadCount] = await Promise.all([
    getAlerts(),
    getUnreadAlertCount(),
  ])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">Trade events, risk breaches, and system notifications</p>
        </div>
        {unreadCount > 0 && (
          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
            {unreadCount} unread
          </span>
        )}
      </div>
      <AlertsClient initialAlerts={alerts} />
    </div>
  )
}
