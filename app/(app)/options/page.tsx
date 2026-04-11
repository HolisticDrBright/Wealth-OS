import { createClient } from '@/lib/supabase/server'
import { computeOptionPnL } from '@/lib/options'
import { OptionsClient } from './options-client'

export default async function OptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('option_positions')
    .select('*')
    .eq('user_id', user.id)
    .is('closed_at', null)
    .order('expiration', { ascending: true })

  const positions = (data ?? []).map(pos => ({
    ...pos,
    pnl: computeOptionPnL(pos),
  }))

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Options</h1>
        <p className="text-sm text-gray-500 mt-1">Track positions and compute Black-Scholes pricing</p>
      </div>
      <OptionsClient initialPositions={positions} />
    </div>
  )
}
