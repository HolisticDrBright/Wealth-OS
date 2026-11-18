/**
 * Bearer-scoped Supabase client for the mobile API routes (Phase M2+).
 *
 * The phone app sends the user's Supabase access token as
 * `Authorization: Bearer <jwt>`. This verifies the token and returns a client
 * that runs EVERY query as that user under RLS — the same rules the web's
 * cookie session gets. No service-role shortcuts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

export interface BearerContext {
  supabase: SupabaseClient
  userId: string
}

export async function userClientFromBearer(req: NextRequest): Promise<BearerContext | null> {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return { supabase, userId: user.id }
}
