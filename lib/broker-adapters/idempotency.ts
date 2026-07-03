/**
 * Idempotent order submission primitives.
 *
 * The old pattern `client_order_id: wos-${Date.now()}` meant a retry or a
 * concurrent worker got a NEW id every time — brokers happily accepted the
 * duplicate. Deterministic ids make resubmission safe: same opportunity,
 * same id, broker-side dedupe.
 */

import { createHash } from 'crypto'

export type OrderLeg = 'entry' | 'stop' | 'take_profit'

/** Deterministic client order id: wos-<sha256(opportunityId:leg)[0:20]>. */
export function clientOrderId(opportunityId: string, leg: OrderLeg = 'entry'): string {
  const h = createHash('sha256').update(`${opportunityId}:${leg}`).digest('hex')
  return `wos-${h.slice(0, 20)}`
}

/** Broker messages that mean "this client_order_id was already accepted". */
export function isDuplicateOrderError(message: string | undefined | null): boolean {
  if (!message) return false
  return /duplicate|already exists|already been used|idempoten|DUPLICATE_CLIENT_ORDER_ID|client_order_id.*(taken|used)/i
    .test(message)
}

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  attempts?: number
  /** Backoff before retry n (ms). Default [2000, 4000]. */
  backoffMs?: number[]
  /** Injectable sleeper for tests. */
  sleep?: (ms: number) => Promise<void>
}

export interface RetryOutcome<T> {
  result: T
  attempts: number
  /** True when a duplicate-id error was treated as success. */
  dedupedAsSuccess: boolean
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Submit with bounded retry, reusing the SAME client_order_id each attempt.
 *
 * @param submit       Performs one submission attempt.
 * @param isRetryable  True when the result is a transient failure worth retrying.
 * @param errorOf      Extracts the error message (for duplicate detection).
 * @param onDuplicate  Converts a duplicate-id failure into the success result.
 */
export async function submitWithRetry<T>(
  submit: () => Promise<T>,
  isRetryable: (r: T) => boolean,
  errorOf: (r: T) => string | undefined,
  onDuplicate: (r: T) => T,
  opts: RetryOptions = {}
): Promise<RetryOutcome<T>> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const backoff = opts.backoffMs ?? [2000, 4000]
  const sleep = opts.sleep ?? defaultSleep

  let last: T
  for (let attempt = 1; ; attempt++) {
    try {
      last = await submit()
    } catch (err) {
      last = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      } as unknown as T
    }

    // Duplicate-id rejection = the earlier attempt actually landed. Success.
    if (isDuplicateOrderError(errorOf(last))) {
      return { result: onDuplicate(last), attempts: attempt, dedupedAsSuccess: true }
    }
    if (!isRetryable(last) || attempt >= attempts) {
      return { result: last, attempts: attempt, dedupedAsSuccess: false }
    }
    await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)])
  }
}
