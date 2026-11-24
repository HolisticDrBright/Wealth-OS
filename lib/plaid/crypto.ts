/**
 * Access-token encryption (roadmap #2) — AES-256-GCM with a key that lives
 * only in the server environment (PLAID_TOKEN_KEY, 32 random bytes, base64).
 * The database holds ciphertext only. A missing or malformed key FAILS
 * CLOSED: nothing is linked or synced without it.
 *
 * Format: "v1:<iv base64>:<auth tag base64>:<ciphertext base64>".
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

export const TOKEN_KEY_VERSION = 1

function key(): Buffer {
  const raw = process.env.PLAID_TOKEN_KEY
  if (!raw) throw new Error('PLAID_TOKEN_KEY is not set — account linking is disabled')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('PLAID_TOKEN_KEY must be 32 bytes, base64-encoded')
  return buf
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

export function decryptToken(blob: string): string {
  const [v, iv, tag, ct] = blob.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unrecognized token format')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
