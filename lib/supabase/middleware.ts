import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Routes that authenticate themselves with bearer keys (CRON_SECRET /
 * WEALTH_OS_API_KEY). Schedulers have no session cookie, so the proxy must
 * pass these straight through — each handler fails closed on a bad token.
 */
const BEARER_AUTH_EXEMPT = ['/api/cron', '/api/internal', '/api/execute-copy-trades']

export function isBearerAuthRoute(pathname: string): boolean {
  return BEARER_AUTH_EXEMPT.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Bearer-auth routes do their own auth; never redirect or touch cookies.
  if (isBearerAuthRoute(pathname)) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // API callers can't follow a redirect to an HTML login page — answer 401.
  if (!user && pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isAuthPage = pathname.startsWith('/login') ||
    pathname.startsWith('/signup')

  if (!user && !isAuthPage && pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
