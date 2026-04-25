/**
 * StrategyRegistry — holds all 38 BasePipelineStrategy instances.
 *
 * Usage:
 *   const strat = strategyRegistry.get('vcp_minervini')
 *   const enabled = await strategyRegistry.getEnabledForUser(userId, supabase)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { StrategyKey, AssetClass } from './strategy-registry'
import type { BasePipelineStrategy } from './BasePipelineStrategy'

export class StrategyRegistry {
  private readonly strategies = new Map<StrategyKey, BasePipelineStrategy>()

  register(strategy: BasePipelineStrategy): void {
    this.strategies.set(strategy.key, strategy)
  }

  get(key: StrategyKey): BasePipelineStrategy {
    const s = this.strategies.get(key)
    if (!s) throw new Error(`Strategy not registered: ${key}`)
    return s
  }

  getByAsset(assetClass: AssetClass): BasePipelineStrategy[] {
    return [...this.strategies.values()].filter(s => s.assetClass === assetClass)
  }

  getAll(): BasePipelineStrategy[] {
    return [...this.strategies.values()]
  }

  /**
   * Returns strategies the user has explicitly enabled in user_enabled_strategies.
   * Falls back to all registered strategies if the table is absent / empty.
   */
  async getEnabledForUser(
    userId: string,
    supabase: SupabaseClient
  ): Promise<BasePipelineStrategy[]> {
    const { data, error } = await supabase
      .from('user_enabled_strategies')
      .select('strategy_key, is_enabled')
      .eq('user_id', userId)
      .eq('is_enabled', true)

    if (error || !data || data.length === 0) {
      return this.getAll()
    }

    const keys = new Set(data.map(r => r.strategy_key as StrategyKey))
    return [...this.strategies.values()].filter(s => keys.has(s.key))
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const strategyRegistry = new StrategyRegistry()
