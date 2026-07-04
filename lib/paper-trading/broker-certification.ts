/**
 * Broker sandbox certification matrix (upgrade item 5) — pure builder.
 *
 * INVARIANT: certification rows NEVER flip liveReady. liveReady comes only
 * from the adapter's compiled capabilities (a reviewed code change). This
 * matrix just shows how far each broker's sandbox evidence has progressed.
 */

export const CERTIFICATION_CHECKS = [
  'tested_order_placement',
  'tested_cancel',
  'tested_status',
  'tested_partial_fill',
  'tested_rejection',
  'tested_bracket_oco',
  'tested_reconciliation',
  'tested_quantity_conversion',
] as const
export type CertificationCheck = (typeof CERTIFICATION_CHECKS)[number]

export interface CertificationRow {
  broker: string
  environment: string
  tested_order_placement: boolean
  tested_cancel: boolean
  tested_status: boolean
  tested_partial_fill: boolean
  tested_rejection: boolean
  tested_bracket_oco: boolean
  tested_reconciliation: boolean
  tested_quantity_conversion: boolean
  evidence_notes: string | null
  certified_by: string | null
  certified_at: string | null
  expires_at: string | null
}

export type CertificationStatus = 'not_certified' | 'in_progress' | 'certified_sandbox' | 'expired'

export interface BrokerReadinessRow {
  broker: string
  displayName: string
  configured: boolean
  /** From adapter capabilities ONLY — never derived from certification. */
  liveReady: boolean
  checksPassed: number
  checksTotal: number
  status: CertificationStatus
  certifiedBy: string | null
  certifiedAt: string | null
  notes: string | null
}

export function certificationStatusOf(cert: CertificationRow | null, now = new Date()): {
  status: CertificationStatus
  checksPassed: number
} {
  if (!cert) return { status: 'not_certified', checksPassed: 0 }
  const passed = CERTIFICATION_CHECKS.filter(c => cert[c] === true).length
  if (cert.expires_at && new Date(cert.expires_at) < now) {
    return { status: 'expired', checksPassed: passed }
  }
  if (passed === CERTIFICATION_CHECKS.length && cert.certified_at && cert.certified_by) {
    return { status: 'certified_sandbox', checksPassed: passed }
  }
  return { status: passed > 0 ? 'in_progress' : 'not_certified', checksPassed: passed }
}

export function buildReadinessMatrix(
  adapters: Array<{ id: string; displayName: string; configured: boolean; liveReady: boolean }>,
  certs: CertificationRow[],
  now = new Date()
): BrokerReadinessRow[] {
  const certByBroker = new Map(certs.map(c => [c.broker, c]))
  return adapters.map(a => {
    const cert = certByBroker.get(a.id) ?? null
    const { status, checksPassed } = certificationStatusOf(cert, now)
    return {
      broker: a.id,
      displayName: a.displayName,
      configured: a.configured,
      // NEVER cert-derived: even a fully certified broker stays liveReady:false
      // until the reviewed code change flips the adapter capability.
      liveReady: a.liveReady,
      checksPassed,
      checksTotal: CERTIFICATION_CHECKS.length,
      status,
      certifiedBy: cert?.certified_by ?? null,
      certifiedAt: cert?.certified_at ?? null,
      notes: cert?.evidence_notes ?? null,
    }
  })
}
