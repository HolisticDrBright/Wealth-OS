/**
 * Push notification system via Resend (email).
 * Set: RESEND_API_KEY, NOTIFICATIONS_FROM_EMAIL (e.g. alerts@wealthos.app)
 *
 * All send functions are fire-and-forget — they return a result but never throw.
 * If Resend is not configured, they silently no-op.
 */
import { Resend } from 'resend'

let resend: Resend | null = null
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY)
  return resend
}

const FROM = process.env.NOTIFICATIONS_FROM_EMAIL ?? 'Wealth OS <alerts@wealthos.app>'

export interface NotificationResult {
  sent: boolean
  id?: string
  error?: string
}

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<NotificationResult> {
  const client = getResend()
  if (!client) return { sent: false, error: 'RESEND_API_KEY not configured' }
  try {
    const { data, error } = await client.emails.send({ from: FROM, to, subject, html })
    if (error) return { sent: false, error: error.message }
    return { sent: true, id: data?.id }
  } catch (err) {
    return { sent: false, error: String(err) }
  }
}

// ─── Email templates ─────────────────────────────────────

function baseTemplate(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, sans-serif; background: #0a0b0f; color: #e5e7eb; margin: 0; padding: 24px; }
  .card { background: #13141a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; max-width: 480px; margin: 0 auto; }
  h2 { color: #fff; margin: 0 0 16px; font-size: 18px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
  .badge-red { background: rgba(239,68,68,0.15); color: #f87171; }
  .badge-green { background: rgba(34,197,94,0.15); color: #4ade80; }
  .badge-yellow { background: rgba(234,179,8,0.15); color: #facc15; }
  .badge-blue { background: rgba(99,102,241,0.15); color: #818cf8; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 14px; }
  .label { color: #9ca3af; }
  .value { color: #fff; font-weight: 500; }
  .footer { margin-top: 20px; font-size: 12px; color: #6b7280; }
  a { color: #818cf8; }
</style></head>
<body><div class="card">
  <h2>${title}</h2>
  ${body}
  <div class="footer">Wealth OS · <a href="#">Manage notifications</a></div>
</div></body>
</html>`
}

// ─── Notification senders ─────────────────────────────────

/** Drawdown breach — sleeve or portfolio hit max drawdown threshold */
export async function sendDrawdownAlert(
  email: string,
  opts: { sleeveName: string; drawdownPct: number; thresholdPct: number; currentValue: number }
): Promise<NotificationResult> {
  return sendEmail(
    email,
    `⚠️ Drawdown Alert: ${opts.sleeveName} hit ${opts.drawdownPct.toFixed(1)}%`,
    baseTemplate('Drawdown Breach', `
      <span class="badge badge-red">HALTED</span>
      <br><br>
      <div class="row"><span class="label">Sleeve</span><span class="value">${opts.sleeveName}</span></div>
      <div class="row"><span class="label">Current Drawdown</span><span class="value" style="color:#f87171">${opts.drawdownPct.toFixed(2)}%</span></div>
      <div class="row"><span class="label">Threshold</span><span class="value">${opts.thresholdPct.toFixed(2)}%</span></div>
      <div class="row"><span class="label">Current Value</span><span class="value">$${opts.currentValue.toLocaleString()}</span></div>
      <br><p style="color:#9ca3af;font-size:14px">Trading on this sleeve has been halted. Review and resume in the Sleeves dashboard.</p>
    `)
  )
}

/** Approval request — trade needs human sign-off */
export async function sendApprovalRequest(
  email: string,
  opts: {
    sleeveName: string
    symbol: string
    action: string
    notional: number
    requestId: string
    expiresAt: string
  }
): Promise<NotificationResult> {
  return sendEmail(
    email,
    `Action Required: Approve ${opts.action.toUpperCase()} ${opts.symbol} ($${opts.notional.toLocaleString()})`,
    baseTemplate('Trade Approval Required', `
      <span class="badge badge-yellow">PENDING APPROVAL</span>
      <br><br>
      <div class="row"><span class="label">Sleeve</span><span class="value">${opts.sleeveName}</span></div>
      <div class="row"><span class="label">Trade</span><span class="value">${opts.action.toUpperCase()} ${opts.symbol}</span></div>
      <div class="row"><span class="label">Notional</span><span class="value">$${opts.notional.toLocaleString()}</span></div>
      <div class="row"><span class="label">Expires</span><span class="value">${new Date(opts.expiresAt).toLocaleString()}</span></div>
      <br><p style="color:#9ca3af;font-size:14px">Log in to Wealth OS to approve or reject this trade before it expires.</p>
    `)
  )
}

/** Order filled notification */
export async function sendOrderFilled(
  email: string,
  opts: { symbol: string; side: string; quantity: number; fillPrice: number; notional: number }
): Promise<NotificationResult> {
  const isBuy = opts.side === 'buy'
  return sendEmail(
    email,
    `Order Filled: ${opts.side.toUpperCase()} ${opts.quantity} ${opts.symbol} @ $${opts.fillPrice}`,
    baseTemplate('Order Filled', `
      <span class="badge ${isBuy ? 'badge-green' : 'badge-red'}">${opts.side.toUpperCase()}</span>
      <br><br>
      <div class="row"><span class="label">Symbol</span><span class="value">${opts.symbol}</span></div>
      <div class="row"><span class="label">Quantity</span><span class="value">${opts.quantity}</span></div>
      <div class="row"><span class="label">Fill Price</span><span class="value">$${opts.fillPrice.toLocaleString()}</span></div>
      <div class="row"><span class="label">Notional</span><span class="value">$${opts.notional.toLocaleString()}</span></div>
    `)
  )
}

/** Price alert */
export async function sendPriceAlert(
  email: string,
  opts: { symbol: string; condition: string; targetPrice: number; currentPrice: number }
): Promise<NotificationResult> {
  return sendEmail(
    email,
    `Price Alert: ${opts.symbol} ${opts.condition} $${opts.targetPrice}`,
    baseTemplate('Price Alert Triggered', `
      <span class="badge badge-blue">PRICE ALERT</span>
      <br><br>
      <div class="row"><span class="label">Symbol</span><span class="value">${opts.symbol}</span></div>
      <div class="row"><span class="label">Condition</span><span class="value">${opts.condition} $${opts.targetPrice}</span></div>
      <div class="row"><span class="label">Current Price</span><span class="value">$${opts.currentPrice.toLocaleString()}</span></div>
    `)
  )
}

/** Weekly portfolio summary */
export async function sendWeeklySummary(
  email: string,
  opts: {
    netWorth: number
    weeklyChange: number
    weeklyChangePct: number
    topGainer: string
    topLoser: string
  }
): Promise<NotificationResult> {
  const isPositive = opts.weeklyChange >= 0
  return sendEmail(
    email,
    `Weekly Summary: ${isPositive ? '+' : ''}${opts.weeklyChangePct.toFixed(2)}% this week`,
    baseTemplate('Weekly Portfolio Summary', `
      <div class="row"><span class="label">Net Worth</span><span class="value">$${opts.netWorth.toLocaleString()}</span></div>
      <div class="row">
        <span class="label">Weekly Change</span>
        <span class="value" style="color:${isPositive ? '#4ade80' : '#f87171'}">
          ${isPositive ? '+' : ''}$${Math.abs(opts.weeklyChange).toLocaleString()} (${isPositive ? '+' : ''}${opts.weeklyChangePct.toFixed(2)}%)
        </span>
      </div>
      <div class="row"><span class="label">Top Gainer</span><span class="value" style="color:#4ade80">${opts.topGainer}</span></div>
      <div class="row"><span class="label">Top Loser</span><span class="value" style="color:#f87171">${opts.topLoser}</span></div>
    `)
  )
}
