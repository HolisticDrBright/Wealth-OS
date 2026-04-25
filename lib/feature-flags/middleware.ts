/**
 * Next.js equivalent of the Fastify feature-flags plugin.
 *
 * In Fastify you'd decorate `request.featureFlags`. In Next.js App Router
 * there is no mutable request object, so we use a factory function that
 * resolves the authenticated user and returns a scoped FeatureFlagService.
 *
 * Usage in a route handler:
 *
 *   export async function POST(req: NextRequest) {
 *     const { svc, userId, error } = await resolveFeatureFlags(req)
 *     if (error) return error
 *
 *     const gate = await svc.canSpend(userId, 'mirofish', 120)
 *     if (!gate.allowed) return NextResponse.json({ skipped: true, reason: gate.reason })
 *     // ... do the paid call ...
 *   }
 *
 * Or with the withFeatureFlag HOF for one-liners:
 *
 *   const { svc, userId, error } = await resolveFeatureFlags(req)
 *   if (error) return error
 *   const { result, skipped } = await withFeatureFlag(supabase, userId, 'mirofish', ...)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FeatureFlagService } from './FeatureFlagService'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedFeatureFlags {
  svc: FeatureFlagService
  supabase: SupabaseClient
  userId: string
  error: null
}

export interface FeatureFlagsError {
  svc: null
  supabase: null
  userId: null
  error: NextResponse
}

/**
 * Resolves the authenticated user and returns a scoped FeatureFlagService.
 * Returns an `error` NextResponse (401) when the user is not authenticated.
 */
export async function resolveFeatureFlags(
  _req: NextRequest
): Promise<ResolvedFeatureFlags | FeatureFlagsError> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      svc: null,
      supabase: null,
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return {
    svc: new FeatureFlagService(supabase),
    supabase,
    userId: user.id,
    error: null,
  }
}
