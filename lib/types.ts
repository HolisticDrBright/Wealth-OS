export interface User {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
}

export interface NetWorthEntry {
  id: string
  user_id: string
  date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
}

export interface Asset {
  id: string
  user_id: string
  name: string
  category: 'stock' | 'crypto' | 'real_estate' | 'cash' | 'bond' | 'other'
  symbol?: string
  quantity?: number
  current_value: number
  purchase_price?: number
  purchase_date?: string
  notes?: string
}

export interface Transaction {
  id: string
  user_id: string
  date: string
  description: string
  amount: number
  category: string
  type: 'income' | 'expense'
  account?: string
}

export interface Budget {
  id: string
  user_id: string
  category: string
  monthly_limit: number
  spent: number
  month: string
}

export interface Goal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date: string
  category: 'retirement' | 'home' | 'education' | 'emergency' | 'vacation' | 'other'
  notes?: string
}

export interface TaxStrategy {
  id: string
  title: string
  description: string
  potential_savings: number
  category: 'deduction' | 'credit' | 'account' | 'investment' | 'timing'
  priority: 'high' | 'medium' | 'low'
  action_items: string[]
}
