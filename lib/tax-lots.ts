/**
 * Tax-lot selection engine.
 * Supports: HIFO (highest cost first), LIFO, FIFO, specific identification.
 *
 * Given a set of open tax lots and a sell quantity/proceeds,
 * returns the optimal lots to close and the resulting gain/loss.
 */

export type LotMethod = 'hifo' | 'lifo' | 'fifo' | 'specific'

export interface TaxLot {
  id: string
  symbol: string
  quantity: number        // shares/units in lot
  costBasis: number       // per-unit cost basis (USD)
  acquiredDate: string    // YYYY-MM-DD
  /** Whether this lot is long-term (held > 1 year) */
  isLongTerm?: boolean
}

export interface LotSelection {
  lotId: string
  symbol: string
  quantityToClose: number
  costBasis: number
  proceeds: number
  gainLoss: number
  isLongTerm: boolean
  acquiredDate: string
}

export interface TaxLotResult {
  selections: LotSelection[]
  totalGainLoss: number
  shortTermGainLoss: number
  longTermGainLoss: number
  totalProceeds: number
  totalCostBasis: number
  /** Whether any selection triggers a wash-sale risk (sold within 30 days of similar buy) */
  washSaleRisk: boolean
}

// ─── Helpers ─────────────────────────────────────────────

function isLongTerm(acquiredDate: string, saleDate: string): boolean {
  const acquired = new Date(acquiredDate)
  const sale = new Date(saleDate)
  const diffMs = sale.getTime() - acquired.getTime()
  return diffMs > 365.25 * 24 * 60 * 60 * 1000
}

function costPerUnit(lot: TaxLot): number {
  return lot.costBasis
}

// ─── Lot selection algorithms ─────────────────────────────

function selectLots(
  lots: TaxLot[],
  quantityToSell: number,
  method: LotMethod,
  preferredLotIds?: string[]
): Array<{ lot: TaxLot; qty: number }> {
  if (!lots.length || quantityToSell <= 0) return []

  let ordered: TaxLot[]

  switch (method) {
    case 'hifo':
      ordered = [...lots].sort((a, b) => costPerUnit(b) - costPerUnit(a))
      break
    case 'lifo':
      ordered = [...lots].sort((a, b) => b.acquiredDate.localeCompare(a.acquiredDate))
      break
    case 'fifo':
      ordered = [...lots].sort((a, b) => a.acquiredDate.localeCompare(b.acquiredDate))
      break
    case 'specific':
      if (preferredLotIds?.length) {
        const preferred = lots.filter(l => preferredLotIds.includes(l.id))
        const rest = lots.filter(l => !preferredLotIds.includes(l.id))
        ordered = [...preferred, ...rest]
      } else {
        ordered = [...lots].sort((a, b) => costPerUnit(b) - costPerUnit(a)) // default to HIFO
      }
      break
  }

  const selected: Array<{ lot: TaxLot; qty: number }> = []
  let remaining = quantityToSell

  for (const lot of ordered) {
    if (remaining <= 0) break
    const qty = Math.min(lot.quantity, remaining)
    selected.push({ lot, qty })
    remaining -= qty
  }

  return selected
}

// ─── Public API ───────────────────────────────────────────

/**
 * Select tax lots for a sale and compute gain/loss.
 *
 * @param lots          All open lots for the symbol
 * @param quantityToSell  Units to sell
 * @param salePrice     Per-unit sale price
 * @param method        Lot selection method
 * @param saleDate      Date of sale (YYYY-MM-DD), defaults to today
 * @param preferredLotIds  For specific ID method
 */
export function selectTaxLots(
  lots: TaxLot[],
  quantityToSell: number,
  salePrice: number,
  method: LotMethod = 'hifo',
  saleDate?: string,
  preferredLotIds?: string[]
): TaxLotResult {
  const date = saleDate ?? new Date().toISOString().slice(0, 10)
  const selected = selectLots(lots, quantityToSell, method, preferredLotIds)

  const selections: LotSelection[] = selected.map(({ lot, qty }) => {
    const proceeds = qty * salePrice
    const basis = qty * lot.costBasis
    const longTerm = lot.isLongTerm ?? isLongTerm(lot.acquiredDate, date)
    return {
      lotId: lot.id,
      symbol: lot.symbol,
      quantityToClose: qty,
      costBasis: basis,
      proceeds,
      gainLoss: proceeds - basis,
      isLongTerm: longTerm,
      acquiredDate: lot.acquiredDate,
    }
  })

  const totalGainLoss = selections.reduce((s, sel) => s + sel.gainLoss, 0)
  const shortTermGainLoss = selections.filter(s => !s.isLongTerm).reduce((s, sel) => s + sel.gainLoss, 0)
  const longTermGainLoss = selections.filter(s => s.isLongTerm).reduce((s, sel) => s + sel.gainLoss, 0)
  const totalProceeds = selections.reduce((s, sel) => s + sel.proceeds, 0)
  const totalCostBasis = selections.reduce((s, sel) => s + sel.costBasis, 0)

  // Wash-sale risk: loss sale where a similar lot was acquired within 30 days
  const lossSales = selections.filter(s => s.gainLoss < 0)
  const washSaleRisk = lossSales.some(ls => {
    const saleMs = new Date(date).getTime()
    return lots.some(lot => {
      if (lot.id === ls.lotId) return false
      const lotMs = new Date(lot.acquiredDate).getTime()
      return Math.abs(saleMs - lotMs) <= 30 * 24 * 60 * 60 * 1000
    })
  })

  return {
    selections,
    totalGainLoss: Math.round(totalGainLoss * 100) / 100,
    shortTermGainLoss: Math.round(shortTermGainLoss * 100) / 100,
    longTermGainLoss: Math.round(longTermGainLoss * 100) / 100,
    totalProceeds: Math.round(totalProceeds * 100) / 100,
    totalCostBasis: Math.round(totalCostBasis * 100) / 100,
    washSaleRisk,
  }
}

/**
 * Identify tax-loss harvesting candidates across all positions.
 * Returns lots with unrealized losses sorted by potential tax savings.
 */
export function findHarvestCandidates(
  lots: TaxLot[],
  currentPrices: Map<string, number>,
  minLossThreshold = 100
): Array<{
  symbol: string
  lot: TaxLot
  currentPrice: number
  unrealizedLoss: number
  isLongTerm: boolean
}> {
  const today = new Date().toISOString().slice(0, 10)
  const candidates = []

  for (const lot of lots) {
    const price = currentPrices.get(lot.symbol)
    if (!price) continue
    const currentValue = lot.quantity * price
    const basis = lot.quantity * lot.costBasis
    const unrealizedLoss = currentValue - basis
    if (unrealizedLoss < -minLossThreshold) {
      candidates.push({
        symbol: lot.symbol,
        lot,
        currentPrice: price,
        unrealizedLoss: Math.round(unrealizedLoss * 100) / 100,
        isLongTerm: lot.isLongTerm ?? isLongTerm(lot.acquiredDate, today),
      })
    }
  }

  return candidates.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss)
}
