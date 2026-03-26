import { Asset, Transaction, Budget, Goal, TaxStrategy, NetWorthEntry } from './types'

export const mockNetWorthHistory: NetWorthEntry[] = [
  { id: '1', user_id: 'demo', date: '2025-09', total_assets: 380000, total_liabilities: 210000, net_worth: 170000 },
  { id: '2', user_id: 'demo', date: '2025-10', total_assets: 392000, total_liabilities: 208000, net_worth: 184000 },
  { id: '3', user_id: 'demo', date: '2025-11', total_assets: 405000, total_liabilities: 205000, net_worth: 200000 },
  { id: '4', user_id: 'demo', date: '2025-12', total_assets: 415000, total_liabilities: 203000, net_worth: 212000 },
  { id: '5', user_id: 'demo', date: '2026-01', total_assets: 428000, total_liabilities: 201000, net_worth: 227000 },
  { id: '6', user_id: 'demo', date: '2026-02', total_assets: 441000, total_liabilities: 199000, net_worth: 242000 },
  { id: '7', user_id: 'demo', date: '2026-03', total_assets: 458000, total_liabilities: 197000, net_worth: 261000 },
]

export const mockAssets: Asset[] = [
  { id: '1', user_id: 'demo', name: 'Apple Inc.', category: 'stock', symbol: 'AAPL', quantity: 50, current_value: 9850, purchase_price: 7500, purchase_date: '2023-01-15' },
  { id: '2', user_id: 'demo', name: 'S&P 500 ETF', category: 'stock', symbol: 'VOO', quantity: 30, current_value: 16200, purchase_price: 12000, purchase_date: '2022-06-10' },
  { id: '3', user_id: 'demo', name: 'Bitcoin', category: 'crypto', symbol: 'BTC', quantity: 0.5, current_value: 45000, purchase_price: 20000, purchase_date: '2023-03-20' },
  { id: '4', user_id: 'demo', name: 'Ethereum', category: 'crypto', symbol: 'ETH', quantity: 5, current_value: 12500, purchase_price: 8000, purchase_date: '2023-05-01' },
  { id: '5', user_id: 'demo', name: 'Primary Home', category: 'real_estate', current_value: 320000, purchase_price: 280000, purchase_date: '2021-08-15' },
  { id: '6', user_id: 'demo', name: 'Savings Account', category: 'cash', current_value: 25000 },
  { id: '7', user_id: 'demo', name: 'Emergency Fund', category: 'cash', current_value: 15000 },
  { id: '8', user_id: 'demo', name: 'Treasury Bonds', category: 'bond', current_value: 10000, purchase_price: 9800 },
  { id: '9', user_id: 'demo', name: 'Microsoft Corp.', category: 'stock', symbol: 'MSFT', quantity: 20, current_value: 8200, purchase_price: 6000, purchase_date: '2023-02-28' },
  { id: '10', user_id: 'demo', name: 'Google (Alphabet)', category: 'stock', symbol: 'GOOGL', quantity: 15, current_value: 2550, purchase_price: 2000, purchase_date: '2023-04-10' },
]

export const mockTransactions: Transaction[] = [
  { id: '1', user_id: 'demo', date: '2026-03-25', description: 'Monthly Salary', amount: 8500, category: 'Income', type: 'income' },
  { id: '2', user_id: 'demo', date: '2026-03-24', description: 'Rent / Mortgage', amount: 2200, category: 'Housing', type: 'expense' },
  { id: '3', user_id: 'demo', date: '2026-03-23', description: 'Whole Foods', amount: 185, category: 'Groceries', type: 'expense' },
  { id: '4', user_id: 'demo', date: '2026-03-22', description: 'Electric Bill', amount: 120, category: 'Utilities', type: 'expense' },
  { id: '5', user_id: 'demo', date: '2026-03-21', description: 'Netflix', amount: 18, category: 'Entertainment', type: 'expense' },
  { id: '6', user_id: 'demo', date: '2026-03-20', description: 'Dinner Out', amount: 92, category: 'Dining', type: 'expense' },
  { id: '7', user_id: 'demo', date: '2026-03-19', description: 'Freelance Income', amount: 1200, category: 'Income', type: 'income' },
  { id: '8', user_id: 'demo', date: '2026-03-18', description: 'Gym Membership', amount: 45, category: 'Health & Fitness', type: 'expense' },
  { id: '9', user_id: 'demo', date: '2026-03-17', description: 'Car Insurance', amount: 150, category: 'Insurance', type: 'expense' },
  { id: '10', user_id: 'demo', date: '2026-03-16', description: 'Amazon', amount: 78, category: 'Shopping', type: 'expense' },
  { id: '11', user_id: 'demo', date: '2026-03-15', description: 'Gas Station', amount: 65, category: 'Transportation', type: 'expense' },
  { id: '12', user_id: 'demo', date: '2026-03-14', description: 'Dividend Income', amount: 340, category: 'Investment', type: 'income' },
  { id: '13', user_id: 'demo', date: '2026-03-13', description: 'Coffee Shop', amount: 28, category: 'Dining', type: 'expense' },
  { id: '14', user_id: 'demo', date: '2026-03-12', description: 'Spotify', amount: 11, category: 'Entertainment', type: 'expense' },
  { id: '15', user_id: 'demo', date: '2026-03-10', description: 'Dentist Visit', amount: 200, category: 'Healthcare', type: 'expense' },
]

export const mockBudgets: Budget[] = [
  { id: '1', user_id: 'demo', category: 'Housing', monthly_limit: 2200, spent: 2200, month: '2026-03' },
  { id: '2', user_id: 'demo', category: 'Groceries', monthly_limit: 400, spent: 185, month: '2026-03' },
  { id: '3', user_id: 'demo', category: 'Dining', monthly_limit: 300, spent: 120, month: '2026-03' },
  { id: '4', user_id: 'demo', category: 'Entertainment', monthly_limit: 100, spent: 29, month: '2026-03' },
  { id: '5', user_id: 'demo', category: 'Transportation', monthly_limit: 200, spent: 65, month: '2026-03' },
  { id: '6', user_id: 'demo', category: 'Healthcare', monthly_limit: 250, spent: 200, month: '2026-03' },
  { id: '7', user_id: 'demo', category: 'Shopping', monthly_limit: 200, spent: 78, month: '2026-03' },
  { id: '8', user_id: 'demo', category: 'Utilities', monthly_limit: 150, spent: 120, month: '2026-03' },
]

export const mockGoals: Goal[] = [
  { id: '1', user_id: 'demo', name: 'Retirement Fund', target_amount: 1000000, current_amount: 125000, target_date: '2045-01-01', category: 'retirement', notes: 'Max out 401k and IRA annually' },
  { id: '2', user_id: 'demo', name: 'Down Payment - Vacation Home', target_amount: 80000, current_amount: 32000, target_date: '2028-06-01', category: 'home', notes: 'Beach house in Florida' },
  { id: '3', user_id: 'demo', name: "Children's Education Fund", target_amount: 120000, current_amount: 28000, target_date: '2035-09-01', category: 'education', notes: '529 plan contributions' },
  { id: '4', user_id: 'demo', name: 'Emergency Fund (6 months)', target_amount: 50000, current_amount: 40000, target_date: '2026-12-01', category: 'emergency' },
  { id: '5', user_id: 'demo', name: 'Europe Trip', target_amount: 12000, current_amount: 7500, target_date: '2026-08-01', category: 'vacation' },
]

export const mockTaxStrategies: TaxStrategy[] = [
  {
    id: '1',
    title: 'Maximize 401(k) Contributions',
    description: 'You are currently contributing $12,000/year to your 401(k). Increasing to the 2026 limit of $23,500 could save you significant taxes now while growing tax-deferred.',
    potential_savings: 4025,
    category: 'account',
    priority: 'high',
    action_items: [
      'Increase 401(k) contribution to $23,500 for 2026',
      'If age 50+, add $7,500 catch-up contribution',
      'Consider Roth 401(k) vs traditional based on current tax bracket',
    ],
  },
  {
    id: '2',
    title: 'Open a Health Savings Account (HSA)',
    description: 'If you have a high-deductible health plan, an HSA offers a triple tax advantage: contributions are pre-tax, growth is tax-free, and qualified withdrawals are tax-free.',
    potential_savings: 1200,
    category: 'account',
    priority: 'high',
    action_items: [
      'Verify eligibility with your HDHP',
      'Contribute $4,300 (individual) or $8,550 (family) for 2026',
      'Invest HSA funds in low-cost index funds for long-term growth',
    ],
  },
  {
    id: '3',
    title: 'Tax-Loss Harvesting on Crypto',
    description: 'Your crypto portfolio has unrealized losses in certain positions. Selling these to offset gains elsewhere can reduce your taxable income while maintaining your overall market exposure.',
    potential_savings: 2800,
    category: 'timing',
    priority: 'high',
    action_items: [
      'Identify crypto assets with unrealized losses',
      'Sell losers to realize tax losses',
      'Wait 30 days before repurchasing to avoid wash-sale rules (note: wash-sale rules may not apply to crypto)',
      'Reinvest in similar but not identical assets',
    ],
  },
  {
    id: '4',
    title: 'Qualified Opportunity Zone Investment',
    description: 'Investing capital gains in a Qualified Opportunity Fund (QOF) can defer and potentially reduce taxes on those gains while investing in economically distressed communities.',
    potential_savings: 3500,
    category: 'investment',
    priority: 'medium',
    action_items: [
      'Identify realized capital gains eligible for QOZ deferral',
      'Research reputable Qualified Opportunity Funds in your area',
      'Invest within 180 days of recognizing the gain',
      'Consult a tax advisor to ensure compliance',
    ],
  },
  {
    id: '5',
    title: 'Maximize IRA Contributions',
    description: 'Contributing to a Traditional IRA (if deductible) or Roth IRA can grow your retirement savings tax-advantaged. The 2026 limit is $7,000 ($8,000 if age 50+).',
    potential_savings: 1540,
    category: 'account',
    priority: 'medium',
    action_items: [
      'Contribute $7,000 to Traditional or Roth IRA',
      'Determine deductibility based on income and workplace plan',
      'Consider backdoor Roth IRA if income exceeds limits',
    ],
  },
  {
    id: '6',
    title: 'Deduct Home Office Expenses',
    description: 'If you work from home as a freelancer or self-employed individual, you can deduct home office expenses including a portion of rent/mortgage, utilities, and internet.',
    potential_savings: 950,
    category: 'deduction',
    priority: 'medium',
    action_items: [
      'Calculate dedicated workspace square footage',
      'Track all home-related expenses',
      'Use simplified method ($5/sq ft up to 300 sq ft) or actual expense method',
      'Keep records of all deductible expenses',
    ],
  },
  {
    id: '7',
    title: 'Charitable Donation Bunching',
    description: 'Bundle multiple years of charitable donations into a single year using a Donor Advised Fund (DAF) to exceed the standard deduction threshold and maximize your charitable tax deduction.',
    potential_savings: 1800,
    category: 'deduction',
    priority: 'low',
    action_items: [
      'Open a Donor Advised Fund (DAF) account',
      'Bundle 2-3 years of charitable giving into one year',
      'Donate appreciated securities instead of cash when possible',
      'Take itemized deductions in the bunching year',
    ],
  },
]

export const spendingByCategory = [
  { name: 'Housing', value: 2200, fill: '#6366f1' },
  { name: 'Groceries', value: 185, fill: '#8b5cf6' },
  { name: 'Dining', value: 120, fill: '#ec4899' },
  { name: 'Transportation', value: 65, fill: '#f59e0b' },
  { name: 'Healthcare', value: 200, fill: '#10b981' },
  { name: 'Entertainment', value: 29, fill: '#3b82f6' },
  { name: 'Shopping', value: 78, fill: '#f97316' },
  { name: 'Utilities', value: 120, fill: '#14b8a6' },
]

export const portfolioAllocation = [
  { name: 'Stocks', value: 36800, percentage: 8.0, fill: '#6366f1' },
  { name: 'Crypto', value: 57500, percentage: 12.5, fill: '#f59e0b' },
  { name: 'Real Estate', value: 320000, percentage: 69.9, fill: '#10b981' },
  { name: 'Cash', value: 40000, percentage: 8.7, fill: '#3b82f6' },
  { name: 'Bonds', value: 10000, percentage: 2.2, fill: '#ec4899' },
]
