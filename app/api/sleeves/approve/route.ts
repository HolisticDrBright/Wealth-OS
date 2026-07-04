import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { submitOrder } from '@/lib/broker-adapters/router'
import { preExecutionGuard, DEFAULT_MANUAL_EDGE, costVenueOf } from '@/lib/broker-adapters/execution-guard'
import { sendDrawdownAlert } from '@/lib/notifications'
import { logAudit, extractRequestMeta } from '@/lib/audit-log'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { request_id, action, review_notes } = await req.json().catch(() => ({}))
  if (!request_id) return apiError('request_id is required')
  if (!['approved', 'rejected'].includes(action)) return apiError('action must be approved or rejected')

  // Fetch the approval request
  const { data: request } = await supabase
    .from('sleeve_approval_requests')
    .select('*, sleeve:portfolio_sleeves(*)')
    .eq('id', request_id)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .single()

  if (!request) return apiError('Approval request not found or already resolved', 404)

  if (new Date(request.expires_at) < new Date()) {
    await supabase.from('sleeve_approval_requests')
      .update({ status: 'expired' }).eq('id', request_id)
    return apiError('Approval request has expired', 410)
  }

  // Update status
  await supabase.from('sleeve_approval_requests').update({
    status: action,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    review_notes: review_notes ?? null,
  }).eq('id', request_id)

  // If approved and it's a trade request, execute via broker
  let brokerResult = null
  if (action === 'approved' && request.request_type === 'trade') {
    const sleeve = request.sleeve
    if (sleeve?.halted) {
      return apiError('Sleeve is halted — resume before executing trades', 409)
    }

    if (request.symbol && request.action && request.notional_usd) {
      // Pre-execution guard: kill switch + sleeve halts + cost gate. Blocked → 423 + audit.
      const guard = await preExecutionGuard({
        supabase,
        userId: user.id,
        sleeveId: request.sleeve_id as string | undefined,
        expectedReturn: DEFAULT_MANUAL_EDGE,
        assetClass: costVenueOf(request.sleeve?.approved_asset_classes?.[0] ?? 'stock'),
      })
      if (!guard.ok) {
        await supabase.from('audit_logs').insert({
          user_id: user.id, strategy_key: 'sleeve_approval', symbol: request.symbol,
          decision: 'block', size_fraction: 0, mirofish_used: false, kronos_used: false,
          decided_at: new Date().toISOString(),
          metadata: { blocked_by: 'pre_execution_guard', reason: guard.reason, route: '/api/sleeves/approve' },
        }).then(() => {}, () => {})
        return apiError(`blocked: ${guard.reason}`, 423)
      }
      brokerResult = await submitOrder({
        symbol: request.symbol,
        asset_class: sleeve?.approved_asset_classes?.[0] ?? 'stock',
        side: request.action === 'buy' ? 'buy' : 'sell',
        order_type: (request.order_type ?? 'market') as 'market' | 'limit',
        notional_usd: request.notional_usd,
        jurisdiction: 'US',
      }, guard.token)

      // Write order record
      await supabase.from('orders').insert({
        user_id: user.id,
        symbol: request.symbol,
        asset_class: sleeve?.approved_asset_classes?.[0] ?? 'stock',
        side: request.action === 'buy' ? 'buy' : 'sell',
        order_type: 'market',
        notional_usd: request.notional_usd,
        time_in_force: 'day',
        status: brokerResult.status === 'failed' ? 'rejected' : brokerResult.status,
        broker: brokerResult.broker,
        broker_order_id: brokerResult.broker_order_id,
        source: 'rule',
        source_ref_id: request_id,
        submitted_at: new Date().toISOString(),
        filled_qty: 0,
        metadata: { sleeve_id: sleeve?.id },
      })

      // Check drawdown breach — halt sleeve if exceeded
      if (sleeve?.halt_on_breach && sleeve?.max_drawdown_pct) {
        if (sleeve.performance_ytd_pct && Math.abs(sleeve.performance_ytd_pct) > sleeve.max_drawdown_pct) {
          await supabase.from('portfolio_sleeves').update({
            halted: true,
            halted_reason: `Max drawdown ${sleeve.max_drawdown_pct}% breached`,
          }).eq('id', sleeve.id)

          await supabase.from('alerts').insert({
            user_id: user.id,
            type: 'risk_breach',
            title: `Sleeve "${sleeve.name}" halted`,
            body: `Max drawdown threshold breached. All future trades require manual review.`,
            severity: 'critical',
            is_read: false,
            metadata: { sleeve_id: sleeve.id },
          })

          // Email notification
          const { data: profile } = await supabase.from('profiles').select('email').eq('id', user.id).single()
          if (profile?.email) {
            await sendDrawdownAlert(profile.email, {
              sleeveName: sleeve.name,
              drawdownPct: Math.abs(sleeve.performance_ytd_pct ?? 0),
              thresholdPct: sleeve.max_drawdown_pct,
              currentValue: sleeve.current_value_usd ?? 0,
            })
          }
        }
      }
    }
  }

  // Audit log
  await logAudit({
    user_id: user.id,
    action: action === 'approved' ? 'approval.approved' : 'approval.rejected',
    resource: 'sleeve_approval_request',
    resource_id: request_id,
    metadata: { sleeve_id: request.sleeve?.id, symbol: request.symbol, notional: request.notional_usd },
    ...extractRequestMeta(req),
  })

  return apiSuccess({
    status: action,
    broker: brokerResult,
    broker_order_placed: brokerResult != null && (brokerResult.status === 'open' || brokerResult.status === 'submitted'),
  })
}
