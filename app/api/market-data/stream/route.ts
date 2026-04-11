/**
 * GET /api/market-data/stream?symbols=AAPL,MSFT,NVDA
 *
 * Server-Sent Events endpoint. Polls Alpaca/Finnhub for quotes at ~5s intervals
 * and streams price updates to the client.
 *
 * For a true WebSocket push, wire up the Alpaca WebSocket in a background
 * worker (see lib/market-data/alpaca-ws.ts) and have it write to Supabase
 * Realtime; this SSE route is a simple polling bridge that works on any
 * serverless deployment without persistent connections.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getQuotes } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(req.url)
  const rawSymbols = searchParams.get('symbols') ?? ''
  const symbols = rawSymbols
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20) // cap at 20 symbols per stream

  if (!symbols.length) {
    return new Response('symbols parameter required', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      // Initial snapshot
      const quotes = await getQuotes(symbols)
      send({ type: 'snapshot', quotes: Object.fromEntries(quotes), ts: Date.now() })

      // Poll every 5 seconds (free tier friendly)
      let running = true
      req.signal.addEventListener('abort', () => { running = false })

      while (running) {
        await new Promise(r => setTimeout(r, 5_000))
        if (!running) break
        try {
          const updated = await getQuotes(symbols)
          send({ type: 'update', quotes: Object.fromEntries(updated), ts: Date.now() })
        } catch {
          // network hiccup — keep going
        }
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
