/**
 * Phase 1.1 — scheduler auth.
 *
 * The proxy (lib/supabase/middleware.ts) used to redirect EVERY request
 * without a session cookie to /login, including /api/cron and
 * /api/internal/scan-all, which authenticate with bearer keys. These tests
 * prove:
 *  - bearer-auth routes pass through the proxy untouched,
 *  - other unauthenticated /api/* requests get 401 JSON, not a redirect,
 *  - unauthenticated page requests still redirect to /login,
 *  - the cron handler accepts the right bearer token and rejects a wrong one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The proxy creates a Supabase client to read the session cookie; in these
// tests there is never a session, which is exactly the scheduler's situation.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))

import { updateSession, isBearerAuthRoute } from '@/lib/supabase/middleware'

function req(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3120${path}`, { headers })
}

describe('proxy: bearer-auth routes are exempt from session auth', () => {
  it.each([
    '/api/cron',
    '/api/cron?task=daily',
    '/api/internal/scan-all',
    '/api/execute-copy-trades',
  ])('passes %s through without redirect or 401', async (path) => {
    const res = await updateSession(req(path))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('matches exact paths and subpaths, not lookalike prefixes', () => {
    expect(isBearerAuthRoute('/api/cron')).toBe(true)
    expect(isBearerAuthRoute('/api/internal/scan-all')).toBe(true)
    expect(isBearerAuthRoute('/api/execute-copy-trades')).toBe(true)
    // A lookalike route must NOT inherit the exemption.
    expect(isBearerAuthRoute('/api/cronx')).toBe(false)
    expect(isBearerAuthRoute('/api/internals')).toBe(false)
  })

  it('returns 401 JSON (not a redirect) for other unauthenticated /api/* routes', async () => {
    const res = await updateSession(req('/api/opportunities'))
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('still redirects unauthenticated PAGE requests to /login', async () => {
    const res = await updateSession(req('/dashboard'))
    expect([302, 307, 308]).toContain(res.status)
    expect(res.headers.get('location')).toContain('/login')
  })
})

describe('cron route: bearer token auth', () => {
  const SECRET = 'test-cron-secret'
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.CRON_SECRET
    process.env.CRON_SECRET = SECRET
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })

  it('a correct bearer token reaches the handler', async () => {
    const { GET } = await import('@/app/api/cron/route')
    // An unknown task proves we passed auth and hit handler logic (400, not 401).
    const res = await GET(req('/api/cron?task=__no_such_task__', {
      authorization: `Bearer ${SECRET}`,
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unknown task')
  })

  it('a wrong bearer token gets 401', async () => {
    const { GET } = await import('@/app/api/cron/route')
    const res = await GET(req('/api/cron?task=daily', {
      authorization: 'Bearer wrong-token',
    }))
    expect(res.status).toBe(401)
  })

  it('fails closed when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/cron/route')
    const res = await GET(req('/api/cron?task=daily', {
      authorization: 'Bearer anything',
    }))
    expect(res.status).toBe(401)
  })
})
