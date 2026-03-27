import { NextResponse } from 'next/server'

export interface ApiEnvelope<T = unknown> {
  data: T | null
  error: string | null
  meta: Record<string, unknown>
}

export function apiSuccess<T>(data: T, meta: Record<string, unknown> = {}): NextResponse {
  const body: ApiEnvelope<T> = { data, error: null, meta }
  return NextResponse.json(body)
}

export function apiError(message: string, status = 400, meta: Record<string, unknown> = {}): NextResponse {
  const body: ApiEnvelope<null> = { data: null, error: message, meta }
  return NextResponse.json(body, { status })
}

/** Extract bearer token from Authorization header */
export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}
