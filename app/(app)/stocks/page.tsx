import { AssetStrategyPanel } from '@/components/trading/AssetStrategyPanel'

export default function StocksPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Stocks</h1>
        <p className="text-sm text-gray-500 mt-1">
          Momentum, value, dividend, sector rotation, earnings drift, merger arb, and spinoff strategies
        </p>
      </div>
      <AssetStrategyPanel assetClasses={['stocks']} />
    </div>
  )
}
