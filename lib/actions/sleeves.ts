'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PortfolioSleeve, SleeveApprovalRequest, SleevePosition } from '@/lib/types'

// ─── Sleeves ──────────────────────────────────────────────

export async function getSleeves(): Promise<PortfolioSleeve[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('portfolio_sleeves')
    .select('*, positions:sleeve_positions(*), pending_approvals:sleeve_approval_requests(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (data ?? []) as PortfolioSleeve[]
}

export async function getSleeve(id: string): Promise<PortfolioSleeve | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('portfolio_sleeves')
    .select('*, positions:sleeve_positions(*), pending_approvals:sleeve_approval_requests(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  return data
}

export async function createSleeve(payload: {
  name: string
  description?: string
  sleeve_type?: PortfolioSleeve['sleeve_type']
  target_allocation_pct?: number
  approval_required?: boolean
  approval_threshold_usd?: number
  approved_asset_classes?: string[]
  max_position_pct?: number
  max_drawdown_pct?: number
  benchmark_symbol?: string
  household_id?: string
}): Promise<PortfolioSleeve | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('portfolio_sleeves')
    .insert({
      user_id: user.id,
      sleeve_type: 'autonomous',
      current_value_usd: 0,
      is_active: true,
      approval_required: true,
      approval_threshold_usd: 1000,
      approved_strategies: [],
      approved_asset_classes: ['stock'],
      max_position_pct: 10,
      max_drawdown_pct: 20,
      halt_on_breach: true,
      halted: false,
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/sleeves')
  return data
}

export async function updateSleeve(
  id: string,
  payload: Partial<Pick<PortfolioSleeve,
    'name' | 'description' | 'is_active' | 'approval_required' | 'approval_threshold_usd' |
    'approved_asset_classes' | 'max_position_pct' | 'max_drawdown_pct' | 'target_allocation_pct'
  >>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('portfolio_sleeves')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/sleeves')
}

export async function haltSleeve(id: string, reason: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('portfolio_sleeves')
    .update({ halted: true, halted_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/sleeves')
}

export async function resumeSleeve(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('portfolio_sleeves')
    .update({ halted: false, halted_reason: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/sleeves')
}

// ─── Approval Requests ────────────────────────────────────

export async function getPendingApprovals(): Promise<SleeveApprovalRequest[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('sleeve_approval_requests')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getSleeveApprovals(sleeveId: string): Promise<SleeveApprovalRequest[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('sleeve_approval_requests')
    .select('*')
    .eq('sleeve_id', sleeveId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return data ?? []
}

export async function createApprovalRequest(
  sleeveId: string,
  payload: {
    request_type: SleeveApprovalRequest['request_type']
    symbol?: string
    action?: string
    notional_usd?: number
    order_type?: string
    reason?: string
  }
): Promise<SleeveApprovalRequest | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('sleeve_approval_requests')
    .insert({
      sleeve_id: sleeveId,
      user_id: user.id,
      status: 'pending',
      expires_at: expiresAt,
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/sleeves')
  return data
}

export async function approveRequest(id: string, notes?: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('sleeve_approval_requests')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/sleeves')
}

export async function rejectRequest(id: string, notes?: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('sleeve_approval_requests')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/sleeves')
}

// ─── Positions ────────────────────────────────────────────

export async function getSleevePositions(sleeveId: string): Promise<SleevePosition[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('sleeve_positions')
    .select('*')
    .eq('sleeve_id', sleeveId)
    .eq('user_id', user.id)
    .order('market_value_usd', { ascending: false })

  return data ?? []
}
