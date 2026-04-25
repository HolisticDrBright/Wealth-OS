import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createVibeTradingClient } from '@/lib/integrations/vibe-trading/VibeTradingClient'
import { VIBE_TRADING_TOOLS } from '@/lib/integrations/vibe-trading/mcp-config'
import type { VibeTradingTool } from '@/lib/integrations/vibe-trading/mcp-config'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> }
) {
  const { tool } = await params
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const toolManifest = VIBE_TRADING_TOOLS.find(t => t.name === tool)
  if (!toolManifest) {
    return NextResponse.json(
      { error: `Unknown tool: ${tool}. Available: ${VIBE_TRADING_TOOLS.map(t => t.name).join(', ')}` },
      { status: 400 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const client = createVibeTradingClient(supabase, user.id)

  let result
  switch (tool as VibeTradingTool) {
    case 'backtest':
      result = await client.backtest(body as Parameters<typeof client.backtest>[0])
      break
    case 'factor_analysis':
      result = await client.factorAnalysis(body as Parameters<typeof client.factorAnalysis>[0])
      break
    case 'pattern_recognition':
      result = await client.patternRecognition(body as Parameters<typeof client.patternRecognition>[0])
      break
    case 'analyze_options':
      result = await client.analyzeOptions(body as Parameters<typeof client.analyzeOptions>[0])
      break
    default:
      return NextResponse.json(
        { error: `Tool '${tool}' is not yet wired into the API. Implement in VibeTradingClient.` },
        { status: 501 }
      )
  }

  return NextResponse.json(result)
}

export async function GET() {
  return NextResponse.json({
    tools: VIBE_TRADING_TOOLS,
    serverUrl: process.env.VIBE_TRADING_MCP_URL ?? 'http://localhost:8765 (default)',
  })
}
