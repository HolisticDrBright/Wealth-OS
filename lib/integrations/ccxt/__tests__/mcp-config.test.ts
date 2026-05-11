import { describe, it, expect } from 'vitest'
import { ALLOWED_TOOLS, buildClient } from '../mcp-config'

const WRITE_TOOLS = ['createOrder', 'cancelOrder', 'editOrder', 'withdraw', 'transfer', 'createDepositAddress']

describe('CCXT MCP config', () => {
  it('ALLOWED_TOOLS contains no write tools', () => {
    for (const w of WRITE_TOOLS) {
      expect(ALLOWED_TOOLS as readonly string[]).not.toContain(w)
    }
  })

  it('buildClient() returns the typed tool name for every allowed tool', () => {
    for (const tool of ALLOWED_TOOLS) {
      expect(buildClient(tool)).toBe(tool)
    }
  })

  it('buildClient() throws with "write tool" message on explicitly blocked tools', () => {
    for (const w of WRITE_TOOLS) {
      expect(() => buildClient(w)).toThrow(/write tool|blocked/i)
    }
  })

  it('buildClient() throws on tools that are neither allowed nor explicitly blocked', () => {
    expect(() => buildClient('unknownTool')).toThrow()
    expect(() => buildClient('placeOrder')).toThrow()
    expect(() => buildClient('')).toThrow()
  })
})
