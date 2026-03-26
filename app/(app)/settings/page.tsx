'use client'

import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DollarSign, Bell, Shield, User } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div>
      <Topbar title="Settings" subtitle="Manage your account and preferences" />
      <div className="p-6 space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10">
                <User className="h-4 w-4 text-indigo-400" />
              </div>
              <CardTitle>Profile</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400">Full Name</label>
                <input
                  type="text"
                  defaultValue="Wealth User"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400">Email</label>
                <input
                  type="email"
                  defaultValue="user@example.com"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <Button size="sm">Save Changes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                <DollarSign className="h-4 w-4 text-emerald-400" />
              </div>
              <CardTitle>Currency & Region</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">Default Currency</label>
              <select className="w-full rounded-lg border border-white/10 bg-[#0f1117] px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500">
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="CAD">CAD — Canadian Dollar</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
                <Bell className="h-4 w-4 text-amber-400" />
              </div>
              <CardTitle>Notifications</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              'Monthly net worth summary',
              'Budget alerts when 80% spent',
              'Goal milestone achieved',
              'Tax deadline reminders',
            ].map(label => (
              <label key={label} className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{label}</span>
                <div className="relative inline-flex h-5 w-9 items-center rounded-full bg-indigo-600 cursor-pointer">
                  <span className="inline-block h-3.5 w-3.5 translate-x-4 rounded-full bg-white shadow-sm transition" />
                </div>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card className="border-red-500/20">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
                <Shield className="h-4 w-4 text-red-400" />
              </div>
              <CardTitle>Danger Zone</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-400 mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <Button variant="danger" size="sm">Delete Account</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
