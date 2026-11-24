/**
 * Minimal Plaid API client (roadmap #2) — server only.
 *
 * Credentials are sent as the PLAID-CLIENT-ID / PLAID-SECRET headers (Plaid
 * accepts either headers or body fields; headers keep secrets out of request
 * bodies and logs). Environment: PLAID_ENV = 'sandbox' (default) or
 * 'production'. Nothing here can move money — only read-only endpoints are
 * wrapped by lib/plaid/service.ts.
 */

export type PlaidEnv = 'sandbox' | 'production'

const BASE: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
}

/** Plaid API version this client is written against. */
export const PLAID_API_VERSION = '2020-09-14'

export function plaidEnv(): PlaidEnv {
  return process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox'
}

/** Linking is possible only with client id, secret AND the token-encryption key. */
export function isPlaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_TOKEN_KEY)
}

export class PlaidError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Plaid's user-safe message, when it provides one. */
    readonly displayMessage: string | null = null,
    readonly status = 0,
  ) {
    super(message)
  }
}

export async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const clientId = process.env.PLAID_CLIENT_ID
  const secret = process.env.PLAID_SECRET
  if (!clientId || !secret) throw new PlaidError('NOT_CONFIGURED', 'Plaid credentials are not configured')
  let res: Response
  try {
    res = await fetch(`${BASE[plaidEnv()]}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
        'Plaid-Version': PLAID_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new PlaidError('NETWORK', err instanceof Error ? err.message : 'network error')
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    throw new PlaidError(
      String(json.error_code ?? `HTTP_${res.status}`),
      String(json.error_message ?? `Plaid request failed (${res.status})`),
      (json.display_message as string | null) ?? null,
      res.status,
    )
  }
  return json as T
}
