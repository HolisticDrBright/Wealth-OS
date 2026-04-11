/**
 * Unified predictor facade.
 * Combines Kronos (quantitative OHLCV forecasting) and MiroFish
 * (qualitative multi-agent scenario simulation) into a single signal.
 */

export { kronosPredict, kronosPredictBatch } from './kronos'
export type { KronosPrediction } from './kronos'

export { miroFishPredict, blendSignals } from './mirofish'
export type { MiroFishScenario, MiroFishInput } from './mirofish'

import type { PriceBar } from '@/lib/backtester'
import { kronosPredict } from './kronos'
import { miroFishPredict, blendSignals, type MiroFishInput } from './mirofish'

export interface CombinedSignal {
  symbol: string
  /** Final blended score [-1, 1]; positive = long bias */
  score: number
  /** Kronos direction vote */
  kronos_direction: 1 | -1 | 0
  /** Kronos expected return over horizon */
  kronos_expected_return: number
  /** MiroFish outlook if available */
  miro_outlook: 'bullish' | 'bearish' | 'neutral' | null
  /** Which backends were available */
  sources: string[]
}

/**
 * Get a combined Kronos + MiroFish signal for a symbol.
 *
 * @param symbol    Ticker
 * @param bars      Historical OHLCV (sorted ascending, min 20 bars)
 * @param miroInput Optional seed material for MiroFish scenario generation
 * @param horizon   Kronos forecast horizon in bars (default 5)
 */
export async function getCombinedSignal(
  symbol: string,
  bars: PriceBar[],
  miroInput?: Omit<MiroFishInput, 'symbol'>,
  horizon = 5
): Promise<CombinedSignal> {
  const [kronos, miro] = await Promise.all([
    kronosPredict(symbol, bars, horizon),
    miroInput ? miroFishPredict({ symbol, ...miroInput }) : Promise.resolve(null),
  ])

  const score = blendSignals(
    kronos.expected_return,
    miro?.sentiment_score ?? null,
    miro?.confidence ?? null
  )

  return {
    symbol,
    score,
    kronos_direction: kronos.direction,
    kronos_expected_return: kronos.expected_return,
    miro_outlook: miro?.outlook ?? null,
    sources: [kronos.source, ...(miro ? [miro.source] : [])],
  }
}
