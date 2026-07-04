/**
 * Year-round tax & wealth planning calendar (upgrade item 4) — pure
 * generator. Dates derive from statute-shaped rules; every LIMIT comes from
 * the seeded tax_constants/kb_parameters passed in (never hardcoded here).
 * Educational planning — deadlines shift for weekends/holidays and state
 * rules; verify with a CPA.
 */

export interface TaxCalendarInputs {
  today: Date
  /** Seeded constants (tax_constants); null when unavailable. */
  constants: Record<string, number> | null
  ageSelf: number | null
  isBusinessOwner: boolean | null
  onHdhp: boolean | null
  ytdIraContributionUsd: number | null
  ytdHsaContributionUsd: number | null
  ytd401kEmployeeUsd: number | null
  filingStatus: string | null
  /** Active wash-sale windows (symbol + when they end). */
  washSaleWindows: Array<{ symbol: string; blockedUntil: string }>
  /** Pending TLH candidates count (for the review-window detail). */
  harvestCandidates: number
}

export type CalendarStatus = 'upcoming' | 'soon' | 'past' | 'needs_data'

export interface CalendarEntry {
  id: string
  /** ISO date of the deadline / review point. */
  date: string
  title: string
  category: 'contribution' | 'tax' | 'harvesting' | 'review' | 'business' | 'placeholder'
  detail: string
  status: CalendarStatus
  daysAway: number | null
  missingInputs: string[]
}

const SOON_DAYS = 30

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function entry(
  today: Date,
  id: string,
  date: string,
  title: string,
  category: CalendarEntry['category'],
  detail: string,
  missingInputs: string[] = []
): CalendarEntry {
  const days = Math.ceil((new Date(date).getTime() - today.getTime()) / 86_400_000)
  const status: CalendarStatus = missingInputs.length > 0 ? 'needs_data'
    : days < 0 ? 'past'
    : days <= SOON_DAYS ? 'soon'
    : 'upcoming'
  return { id, date, title, category, detail, status, daysAway: missingInputs.length ? null : days, missingInputs }
}

export function generateTaxCalendar(i: TaxCalendarInputs): CalendarEntry[] {
  const y = i.today.getUTCFullYear()
  const c = i.constants
  const out: CalendarEntry[] = []
  const fmt = (v: number | undefined | null) =>
    v != null ? `$${Math.round(v).toLocaleString()}` : 'limit unavailable — seed tax_constants'

  // ── Contribution deadlines (prior-year window runs to Apr 15) ──────────────
  const iraDeadline = new Date(i.today) < new Date(iso(y, 4, 15))
    ? iso(y, 4, 15) : iso(y + 1, 4, 15)
  const iraRemaining = c?.ira_limit != null && i.ytdIraContributionUsd != null
    ? Math.max(0, c.ira_limit - i.ytdIraContributionUsd) : null
  out.push(entry(i.today, 'ira_deadline', iraDeadline,
    'IRA contribution deadline', 'contribution',
    `Limit ${fmt(c?.ira_limit)}${iraRemaining != null ? `; ~$${Math.round(iraRemaining).toLocaleString()} headroom left` : ''}. Prior-year contributions close with the filing deadline.`,
    i.ytdIraContributionUsd == null ? ['YTD IRA contributions'] : []))

  out.push(entry(i.today, 'roth_review', iso(y, 12, 1),
    'Roth / backdoor Roth review', 'review',
    'Confirm the MAGI path (direct vs backdoor) before year-end; backdoor conversions and pro-rata cleanup are much harder after Dec 31. Requires CPA review.',
    i.filingStatus == null ? ['filing status', 'MAGI estimate'] : []))

  const hsaLimitKey = i.filingStatus === 'mfj' ? 'hsa_limit_family' : 'hsa_limit_single'
  out.push(entry(i.today, 'hsa_deadline', iraDeadline,
    'HSA contribution deadline', 'contribution',
    i.onHdhp === false
      ? 'Not on an HDHP — no HSA eligibility this year.'
      : `Limit ${fmt(c?.[hsaLimitKey])}. Same deadline as the IRA.`,
    i.onHdhp == null ? ['health plan type'] : []))

  // ── 401(k) pacing — employee deferrals close Dec 31 ────────────────────────
  const k401Limit = c?.solo401k_employee
  const pacing = k401Limit != null && i.ytd401kEmployeeUsd != null
    ? `${Math.round((i.ytd401kEmployeeUsd / k401Limit) * 100)}% of the ${fmt(k401Limit)} employee limit used`
    : `Employee limit ${fmt(k401Limit)}`
  out.push(entry(i.today, '401k_pacing', iso(y, 12, 31),
    '401(k) contribution pacing (payroll deadline Dec 31)', 'contribution',
    `${pacing}. Deferrals only happen through payroll — under-pacing cannot be fixed in late December.`,
    i.ytd401kEmployeeUsd == null ? ['YTD 401(k) employee contributions'] : []))

  // ── Estimated taxes (business/self-employment income) ──────────────────────
  const estDates = [iso(y, 4, 15), iso(y, 6, 15), iso(y, 9, 15), iso(y + 1, 1, 15)]
  for (const [idx, d] of estDates.entries()) {
    out.push(entry(i.today, `est_tax_q${idx + 1}`, d,
      `Estimated tax payment Q${idx + 1}`, 'tax',
      i.isBusinessOwner
        ? 'Self-employment/business income requires quarterly estimates — underpayment accrues penalties.'
        : 'Applies to self-employment, large capital gains, or under-withholding. Skip if withholding covers you.',
      i.isBusinessOwner == null ? ['business entity / income type'] : []))
  }

  // ── Tax-loss harvesting review windows ──────────────────────────────────────
  for (const [q, d] of [iso(y, 3, 31), iso(y, 6, 30), iso(y, 9, 30)].entries()) {
    out.push(entry(i.today, `tlh_q${q + 1}`, d,
      `Tax-loss harvesting review (Q${q + 1})`, 'harvesting',
      `Quarterly sweep for harvestable losses.${i.harvestCandidates > 0 ? ` ${i.harvestCandidates} candidate(s) pending now.` : ''}`))
  }
  out.push(entry(i.today, 'tlh_december', iso(y, 12, 15),
    'Year-end harvesting window', 'harvesting',
    'Final window — settlements must clear by year-end, and wash-sale windows lock repurchases for 30 days.'))

  // ── Wash-sale expirations (from the live blocklist) ────────────────────────
  for (const w of i.washSaleWindows) {
    out.push(entry(i.today, `wash_${w.symbol}`, w.blockedUntil.slice(0, 10),
      `Wash-sale window ends: ${w.symbol}`, 'harvesting',
      `Repurchasing ${w.symbol} before this date disallows the harvested loss.`))
  }

  // ── Charitable / DAF review ─────────────────────────────────────────────────
  out.push(entry(i.today, 'charitable_review', iso(y, 11, 30),
    'Charitable giving / DAF review', 'review',
    'Bunching, appreciated-stock gifts, and DAF funding must complete (and clear) before Dec 31 to count this year.'))

  // ── RMD placeholder — needs age data ────────────────────────────────────────
  if (i.ageSelf == null) {
    out.push(entry(i.today, 'rmd', iso(y, 12, 31),
      'Required minimum distributions', 'placeholder',
      'RMDs apply from age 73 (SECURE 2.0). Add your age to know whether this applies.',
      ['age']))
  } else if (i.ageSelf >= 73) {
    out.push(entry(i.today, 'rmd', iso(y, 12, 31),
      'Required minimum distribution deadline', 'tax',
      'RMDs from pre-tax retirement accounts must complete by Dec 31 — a missed RMD carries a 25% excise tax. Verify amounts with your custodian and CPA.'))
  }

  // ── Business-owner entity reminders ────────────────────────────────────────
  if (i.isBusinessOwner !== false) {
    out.push(entry(i.today, 'scorp_election', iso(y, 3, 15),
      'S-corp election deadline (Form 2553)', 'business',
      'Election for the current tax year is generally due 2 months 15 days into the year. Requires CPA review.',
      i.isBusinessOwner == null ? ['business entity type'] : []))
  }

  // ── Year-end planning review ────────────────────────────────────────────────
  out.push(entry(i.today, 'year_end_review', iso(y, 12, 15),
    'Year-end income & tax planning review', 'review',
    'Income timing, bracket management, Roth conversion sizing, gains/losses netting — the last practical window before Dec 31.'))

  return out.sort((a, b) => a.date.localeCompare(b.date))
}
