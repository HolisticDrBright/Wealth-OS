/**
 * Mobile API layer (Phases M2–M4 server side).
 *  - every /api/mobile route authenticates with the user's bearer token and
 *    rejects anonymous requests with 401,
 *  - the proxy lets bearer-carrying API requests through to handlers,
 *  - trading-state writes go through the shared cores (approval recorded,
 *    pause = same implementation as the web's Flatten & Halt),
 *  - no mobile route ever uses the service-role admin client.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))

import { updateSession } from '@/lib/supabase/middleware'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')
const MOBILE_DIR = join(process.cwd(), 'app', 'api', 'mobile')

describe('proxy lets bearer API requests reach their handlers', () => {
  it('an /api request WITH a bearer token passes through', async () => {
    const res = await updateSession(new NextRequest('http://localhost:3120/api/mobile/home', {
      headers: { authorization: 'Bearer some-user-jwt' },
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('an /api request WITHOUT any credentials still gets 401', async () => {
    const res = await updateSession(new NextRequest('http://localhost:3120/api/mobile/home'))
    expect(res.status).toBe(401)
  })
})

describe('every mobile route is bearer-authenticated and never service-role', () => {
  const routes = readdirSync(MOBILE_DIR)

  it('covers the expected surface', () => {
    expect(new Set(routes)).toEqual(new Set(['home', 'goal', 'activity', 'approve', 'explore', 'follow', 'pause', 'resume']))
  })

  it.each(readdirSync(MOBILE_DIR))('%s/route.ts uses userClientFromBearer and no admin client', (dir) => {
    const src = read(`app/api/mobile/${dir}/route.ts`)
    expect(src).toContain('userClientFromBearer')
    expect(src).toContain("{ status: 401 }")
    expect(src).not.toContain('createAdminClient')
    expect(src).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})

describe('trading-state writes keep the web rules', () => {
  it('follow requires a recorded approval; auto-copy is impossible from the phone', () => {
    const src = read('app/api/mobile/follow/route.ts')
    expect(src).toContain('approval_required')
    expect(src).toContain("kind: 'follow_trader'")
    expect(src).toContain('auto_copy_enabled: false')
    expect(src).not.toContain('auto_copy_enabled: true')
  })

  it('approve records the approval BEFORE executing, via the shared rebalance path', () => {
    const src = read('app/api/mobile/approve/route.ts')
    const post = src.slice(src.indexOf('export async function POST'))
    const appr = post.indexOf("kind: 'accept_rebalance'")
    const exec = post.indexOf('executeTrades: true')
    expect(appr).toBeGreaterThan(-1)
    expect(appr).toBeLessThan(exec)
    expect(post).toContain('runRebalanceScan')
  })

  it('pause uses the shared core and resume demands explicit confirmation', () => {
    expect(read('app/api/mobile/pause/route.ts')).toContain('pauseTradingCore')
    const resume = read('app/api/mobile/resume/route.ts')
    expect(resume).toContain('confirmation_required')
    expect(resume).toContain('resumeTradingCore')
  })

  it('the explore feed is always risk/delay-adjusted on the phone', () => {
    expect(read('app/api/mobile/explore/route.ts')).toContain("'simple'")
    const viewData = read('lib/explore/view-data.ts')
    expect(viewData).toContain('riskAdjustedSortKey')
  })
})
