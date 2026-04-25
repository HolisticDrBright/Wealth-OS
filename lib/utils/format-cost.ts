/**
 * Cost formatting utilities.
 * All inputs are integer cents (no floating-point drift).
 */

/**
 * Format an integer cent value to a USD string.
 * formatCostCents(450) → '$4.50'
 * formatCostCents(123456) → '$1,234.56'
 */
export function formatCostCents(cents: number): string {
  const dollars = cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars)
}

/**
 * Format a low–high cost range in cents to a human-readable monthly estimate.
 * formatCostRange(1500, 4500) → '$15-45/mo'
 * formatCostRange(300, 800) → '$3-8/mo'
 */
export function formatCostRange(lowCents: number, highCents: number): string {
  const lo = Math.round(lowCents / 100)
  const hi = Math.round(highCents / 100)

  if (lo === hi) return `$${lo}/mo`

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`

  return `${fmt(lo)}-${fmt(hi)}/mo`
}

/**
 * Short human-readable cents (no /mo).
 * shortCents(0) → 'Free'
 * shortCents(50) → '$0.50'
 * shortCents(100) → '$1'
 */
export function shortCents(cents: number): string {
  if (cents === 0) return 'Free'
  const dollars = cents / 100
  return dollars % 1 === 0
    ? `$${dollars.toFixed(0)}`
    : `$${dollars.toFixed(2)}`
}
